use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{OnceLock, RwLock};

#[derive(Debug, Clone, Deserialize)]
struct RawRaidCatalog {
    #[serde(default)]
    raids: Vec<RawRaidEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawRaidEntry {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(rename = "commonName", default)]
    common_name: String,
    #[serde(rename = "japaneseName", default)]
    japanese_name: String,
    #[serde(default)]
    nickname: String,
    #[serde(rename = "questId", default)]
    quest_id: String,
    #[serde(rename = "blueChest", default)]
    blue_chest: Option<RawBlueChest>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawBlueChest {
    #[serde(rename = "thresholdHonors", default)]
    threshold_honors: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawOmenCatalog {
    #[serde(default)]
    omens: Vec<serde::de::IgnoredAny>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawSelectorsCatalog {
    #[serde(default)]
    selectors: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct CompactRaidRecord {
    pub id_lower: String,
    pub name_lower: String,
    pub common_lower: String,
    pub jp_lower: String,
    pub nick_lower: String,
    pub quest_id: u32,
    pub blue_chest_honors: u32,
}

#[derive(Default)]
pub struct CatalogIndex {
    pub loaded: bool,
    pub raids: Vec<CompactRaidRecord>,
    pub raid_by_exact_key: HashMap<String, usize>,
    pub omen_count: u32,
    pub selector_count: u32,
}

static GLOBAL_CATALOG: OnceLock<RwLock<CatalogIndex>> = OnceLock::new();

fn catalog_lock() -> &'static RwLock<CatalogIndex> {
    GLOBAL_CATALOG.get_or_init(|| RwLock::new(CatalogIndex::default()))
}

fn count_selector_leaves(val: &serde_json::Value) -> u32 {
    match val {
        serde_json::Value::Object(map) => map.values().map(count_selector_leaves).sum(),
        serde_json::Value::String(_) => 1,
        _ => 0,
    }
}

/// Loads and indexes the static `data/` directory into compact Rust structures.
/// Returns the total number of indexed entities (`raids + omens + selectors`).
pub fn load_catalog_dir(data_dir: &str) -> u32 {
    let base = Path::new(data_dir);
    let mut index = CatalogIndex {
        loaded: true,
        ..CatalogIndex::default()
    };

    // 1. Raids catalog
    let raids_path = base.join("raids").join("raids.catalog.json");
    if let Ok(raw) = fs::read_to_string(&raids_path) {
        if let Ok(parsed) = serde_json::from_str::<RawRaidCatalog>(&raw) {
            for r in parsed.raids {
                let quest_id = r.quest_id.parse::<u32>().unwrap_or(0);
                let blue_chest_honors = r
                    .blue_chest
                    .and_then(|b| b.threshold_honors)
                    .unwrap_or(0);
                let rec = CompactRaidRecord {
                    id_lower: r.id.to_lowercase(),
                    name_lower: r.name.to_lowercase(),
                    common_lower: r.common_name.to_lowercase(),
                    jp_lower: r.japanese_name.to_lowercase(),
                    nick_lower: r.nickname.to_lowercase(),
                    quest_id,
                    blue_chest_honors,
                };
                let idx = index.raids.len();
                if !rec.id_lower.is_empty() {
                    index.raid_by_exact_key.insert(rec.id_lower.clone(), idx);
                }
                if !r.quest_id.is_empty() {
                    index.raid_by_exact_key.insert(r.quest_id.clone(), idx);
                }
                if !rec.name_lower.is_empty() {
                    index.raid_by_exact_key.insert(rec.name_lower.clone(), idx);
                }
                if !rec.common_lower.is_empty() {
                    index.raid_by_exact_key.insert(rec.common_lower.clone(), idx);
                }
                index.raids.push(rec);
            }
        }
    }

    // 2. Omens count
    let omens_path = base.join("combat").join("omens.catalog.json");
    if let Ok(raw) = fs::read_to_string(&omens_path) {
        if let Ok(parsed) = serde_json::from_str::<RawOmenCatalog>(&raw) {
            index.omen_count = parsed.omens.len() as u32;
        }
    }

    // 3. UI Selectors count
    let selectors_path = base.join("ui").join("selectors.catalog.json");
    if let Ok(raw) = fs::read_to_string(&selectors_path) {
        if let Ok(parsed) = serde_json::from_str::<RawSelectorsCatalog>(&raw) {
            index.selector_count = parsed
                .selectors
                .values()
                .map(count_selector_leaves)
                .sum();
        }
    }

    let total = (index.raids.len() as u32) + index.omen_count + index.selector_count;
    if let Ok(mut guard) = catalog_lock().write() {
        *guard = index;
    }
    total
}

/// Looks up a raid by ID, questId, name, commonName, japaneseName, or nickname.
/// Returns `(quest_id, blue_chest_honors)` or `(0, 0)` if not found.
pub fn lookup_raid(query: &str) -> (u32, u32) {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return (0, 0);
    }

    let Ok(guard) = catalog_lock().read() else {
        return (0, 0);
    };

    if let Some(&idx) = guard.raid_by_exact_key.get(&q) {
        let r = &guard.raids[idx];
        return (r.quest_id, r.blue_chest_honors);
    }

    for r in &guard.raids {
        if r.name_lower.contains(&q)
            || r.common_lower.contains(&q)
            || r.jp_lower.contains(&q)
            || r.nick_lower.contains(&q)
        {
            return (r.quest_id, r.blue_chest_honors);
        }
    }

    (0, 0)
}

/// Returns the GBF supporter tab attribute / optimal element code (`1=fire, 2=water, 3=earth, 4=wind, 5=light, 6=dark`)
/// against a given boss element string.
pub fn lookup_optimal_element_code(boss_element: &str) -> u32 {
    let b = boss_element.trim().to_ascii_lowercase();
    if b.starts_with("fire") {
        2 // water
    } else if b.starts_with("water") {
        3 // earth
    } else if b.starts_with("earth") {
        4 // wind
    } else if b.starts_with("wind") {
        1 // fire
    } else if b.starts_with("light") {
        6 // dark
    } else if b.starts_with("dark") {
        5 // light
    } else {
        6 // default dark burst for plain/null/multi
    }
}

pub fn catalog_counts() -> (u32, u32, u32) {
    let Ok(guard) = catalog_lock().read() else {
        return (0, 0, 0);
    };
    (
        guard.raids.len() as u32,
        guard.omen_count,
        guard.selector_count,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_optimal_element_lookup() {
        assert_eq!(lookup_optimal_element_code("fire"), 2);
        assert_eq!(lookup_optimal_element_code("Water"), 3);
        assert_eq!(lookup_optimal_element_code("earth"), 4);
        assert_eq!(lookup_optimal_element_code("wind"), 1);
        assert_eq!(lookup_optimal_element_code("light"), 6);
        assert_eq!(lookup_optimal_element_code("Dark / All"), 5);
    }
}
