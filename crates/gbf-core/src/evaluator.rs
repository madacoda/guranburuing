// crates/gbf-core/src/evaluator.rs
use rustc_hash::FxHashMap;
use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

const MAX_VELOCITY_ENTRIES: usize = 500;
const DEFAULT_TTL_MS: f64 = 180_000.0;

#[derive(Clone, Copy, Debug)]
#[repr(C)]
pub struct RaidVelocityEntry {
    pub first_seen_at: f64,
    pub last_seen_at: f64,
    pub initial_hp_pct: f64,
    pub last_hp_pct: f64,
    pub initial_players: i32,
    pub last_players: i32,
    pub observations: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VelocityMetrics {
    pub observations: u32,
    pub elapsed_sec: f64,
    pub hp_burn_per_sec: f64,
    pub player_join_rate: f64,
    pub estimated_ttd_sec: f64, // -1.0 when null
    pub is_stalled: bool,
}

struct VelocityStore {
    map: FxHashMap<u64, RaidVelocityEntry>,
    order: VecDeque<u64>,
}

impl VelocityStore {
    fn new() -> Self {
        Self {
            map: FxHashMap::with_capacity_and_hasher(MAX_VELOCITY_ENTRIES, Default::default()),
            order: VecDeque::with_capacity(MAX_VELOCITY_ENTRIES),
        }
    }

    fn prune(&mut self, now_ms: f64, ttl_ms: f64) {
        if self.map.is_empty() {
            return;
        }
        self.map.retain(|_, v| now_ms - v.last_seen_at <= ttl_ms);
        self.order.retain(|k| self.map.contains_key(k));

        while self.map.len() >= MAX_VELOCITY_ENTRIES {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            } else {
                break;
            }
        }
    }
}

static VELOCITY_STORE: LazyLock<Mutex<VelocityStore>> =
    LazyLock::new(|| Mutex::new(VelocityStore::new()));

#[inline]
fn round2(v: f64) -> f64 {
    ((v + f64::EPSILON) * 100.0).round() / 100.0
}

#[inline]
fn round1(v: f64) -> f64 {
    ((v + f64::EPSILON) * 10.0).round() / 10.0
}

/// Fast 64-bit FNV-1a hash of a raid ID byte slice (avoids heap `String` allocation).
#[inline]
pub fn hash_raid_id_bytes(raid_id: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in raid_id {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[inline]
fn compute_metrics(entry: &RaidVelocityEntry, now_ms: f64) -> VelocityMetrics {
    let elapsed_ms = (now_ms - entry.first_seen_at).max(0.0);
    let elapsed_sec = round2(elapsed_ms / 1000.0);
    let hp_lost = (entry.initial_hp_pct - entry.last_hp_pct).max(0.0);
    let player_delta = (entry.last_players - entry.initial_players) as f64;

    let hp_burn_per_sec = if elapsed_sec >= 0.4 {
        round2(hp_lost / elapsed_sec)
    } else {
        0.0
    };
    let player_join_rate = if elapsed_sec >= 0.4 {
        round2(player_delta / elapsed_sec)
    } else {
        0.0
    };
    let estimated_ttd_sec = if hp_burn_per_sec > 0.05 {
        round1(entry.last_hp_pct / hp_burn_per_sec)
    } else {
        -1.0
    };

    let is_stalled = entry.observations >= 2
        && elapsed_sec >= 3.5
        && hp_lost == 0.0
        && player_delta <= 0.0
        && entry.last_players <= 2;

    VelocityMetrics {
        observations: entry.observations,
        elapsed_sec,
        hp_burn_per_sec,
        player_join_rate,
        estimated_ttd_sec,
        is_stalled,
    }
}

pub fn record_observation(
    raid_id: &[u8],
    hp_pct: f64,
    players: i32,
    now_ms: f64,
    ttl_ms: f64,
) -> VelocityMetrics {
    if raid_id.is_empty() {
        return VelocityMetrics {
            observations: 1,
            elapsed_sec: 0.0,
            hp_burn_per_sec: 0.0,
            player_join_rate: 0.0,
            estimated_ttd_sec: -1.0,
            is_stalled: false,
        };
    }

    let key = hash_raid_id_bytes(raid_id);
    let effective_ttl = if ttl_ms > 0.0 { ttl_ms } else { DEFAULT_TTL_MS };
    let mut store = VELOCITY_STORE.lock().unwrap_or_else(|e| e.into_inner());
    store.prune(now_ms, effective_ttl);

    if let Some(existing) = store.map.get_mut(&key) {
        if now_ms - existing.last_seen_at >= 200.0
            || (existing.last_hp_pct - hp_pct).abs() > f64::EPSILON
            || existing.last_players != players
        {
            existing.observations += 1;
            existing.last_seen_at = now_ms;
            existing.last_hp_pct = hp_pct;
            existing.last_players = players;
        }
        return compute_metrics(existing, now_ms);
    }

    let entry = RaidVelocityEntry {
        first_seen_at: now_ms,
        last_seen_at: now_ms,
        initial_hp_pct: hp_pct,
        last_hp_pct: hp_pct,
        initial_players: players,
        last_players: players,
        observations: 1,
    };
    store.map.insert(key, entry);
    store.order.push_back(key);

    VelocityMetrics {
        observations: 1,
        elapsed_sec: 0.0,
        hp_burn_per_sec: 0.0,
        player_join_rate: 0.0,
        estimated_ttd_sec: -1.0,
        is_stalled: false,
    }
}

pub fn get_observation_metrics(
    raid_id: &[u8],
    now_ms: f64,
    ttl_ms: f64,
) -> Option<VelocityMetrics> {
    if raid_id.is_empty() {
        return None;
    }
    let key = hash_raid_id_bytes(raid_id);
    let effective_ttl = if ttl_ms > 0.0 { ttl_ms } else { DEFAULT_TTL_MS };
    let mut store = VELOCITY_STORE.lock().unwrap_or_else(|e| e.into_inner());
    let entry = store.map.get(&key).copied()?;
    if now_ms - entry.last_seen_at > effective_ttl {
        store.map.remove(&key);
        return None;
    }
    Some(compute_metrics(&entry, now_ms))
}

pub fn clear_velocity_store() {
    let mut store = VELOCITY_STORE.lock().unwrap_or_else(|e| e.into_inner());
    store.map.clear();
    store.order.clear();
}

pub fn velocity_store_size() -> usize {
    VELOCITY_STORE.lock().unwrap_or_else(|e| e.into_inner()).map.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_velocity_burn_and_stalled_detection() {
        clear_velocity_store();

        let m1 = record_observation(b"47019788714", 95.0, 2, 1000.0, 180_000.0);
        assert_eq!(m1.observations, 1);
        assert_eq!(m1.hp_burn_per_sec, 0.0);

        // 2 seconds later, HP dropped from 95% to 85% (5%/sec burn), players increased to 6 (+2/sec)
        let m2 = record_observation(b"47019788714", 85.0, 6, 3000.0, 180_000.0);
        assert_eq!(m2.observations, 2);
        assert_eq!(m2.elapsed_sec, 2.0);
        assert_eq!(m2.hp_burn_per_sec, 5.0);
        assert_eq!(m2.player_join_rate, 2.0);
        assert_eq!(m2.estimated_ttd_sec, 17.0);
        assert!(!m2.is_stalled);

        // Stalled room test
        let _ = record_observation(b"99999999999", 100.0, 1, 1000.0, 180_000.0);
        let stalled = record_observation(b"99999999999", 100.0, 1, 5000.0, 180_000.0);
        assert!(stalled.is_stalled);
    }
}
