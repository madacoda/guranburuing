// crates/gbf-core/src/jst.rs

const JST_OFFSET_MS: i64 = 9 * 3600 * 1000;
const GBF_RESET_OFFSET_MS: i64 = 5 * 3600 * 1000; // 05:00 JST daily server boundary
const MS_PER_DAY: i64 = 86_400_000;

/// Computes the exact UTC epoch timestamp (in milliseconds) of the next scheduled
/// GBF Peak-Hour Daily Reset (`target_hour_jst:00:buffer_seconds` JST, default `21:00:15` JST).
/// Zero heap allocations (`< 10ns`).
#[inline]
pub fn compute_next_daily_reset_utc_ms(
    reference_utc_ms: i64,
    target_hour_jst: u32,
    buffer_seconds: u32,
) -> i64 {
    let now_jst_ms = reference_utc_ms + JST_OFFSET_MS;
    let day_index = now_jst_ms.div_euclid(MS_PER_DAY);
    let start_of_jst_day_ms = day_index * MS_PER_DAY;

    let target_offset_ms =
        (target_hour_jst.min(23) as i64) * 3_600_000 + (buffer_seconds.min(3599) as i64) * 1_000;
    let mut next_reset_jst_ms = start_of_jst_day_ms + target_offset_ms;

    if now_jst_ms >= next_reset_jst_ms {
        next_reset_jst_ms += MS_PER_DAY;
    }

    next_reset_jst_ms - JST_OFFSET_MS
}

/// Converts a UTC millisecond epoch into the GBF Server Day (`YYYYMMDD` integer, e.g. `20261027`)
/// where each GBF day starts at `05:00 JST`.
/// Uses Howard Hinnant's civil-from-days algorithm in pure integer math (zero string allocations).
#[inline]
pub fn compute_gbf_server_day_ymd(utc_ms: i64) -> u32 {
    let gbf_shifted_ms = utc_ms + JST_OFFSET_MS - GBF_RESET_OFFSET_MS;
    let days_since_epoch = gbf_shifted_ms.div_euclid(MS_PER_DAY);

    // Howard Hinnant's civil_from_days algorithm
    let z = days_since_epoch + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (if m <= 2 { y + 1 } else { y }) as u32;

    year * 10_000 + m * 100 + d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_next_daily_reset_calculation() {
        // 2026-03-15 11:00:00 UTC = 2026-03-15 20:00:00 JST (1h 0m 15s before 21:00:15 JST)
        let ref_utc_ms = 1_773_572_400_000_i64;
        let next_utc = compute_next_daily_reset_utc_ms(ref_utc_ms, 21, 15);
        assert_eq!(next_utc - ref_utc_ms, 3_615_000);

        // If already past 21:00:15 JST, rolls over to next day (+24h)
        let after_utc_ms = next_utc + 1_000;
        let tomorrow_utc = compute_next_daily_reset_utc_ms(after_utc_ms, 21, 15);
        assert_eq!(tomorrow_utc - next_utc, 86_400_000);
    }

    #[test]
    fn test_gbf_server_day_boundary_0500_jst() {
        // 2026-03-15 19:59:59 UTC = 2026-03-16 04:59:59 JST -> Still 2026-03-15 GBF day!
        let before_5am_jst = 1_773_604_799_000_i64;
        assert_eq!(compute_gbf_server_day_ymd(before_5am_jst), 20260315);

        // 2026-03-15 20:00:01 UTC = 2026-03-16 05:00:01 JST -> Now 2026-03-16 GBF day!
        let after_5am_jst = 1_773_604_801_000_i64;
        assert_eq!(compute_gbf_server_day_ymd(after_5am_jst), 20260316);
    }
}
