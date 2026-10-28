use gbf_core::jst;

const JST_OFFSET_MS: i64 = 9 * 3600 * 1000;
const DAY_MS: i64 = 86_400 * 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchedulerAction {
    /// Sleep until the next scheduled JST milestone (`ms` clamped to a safe wakeup window).
    SleepMs(u64),
    /// Fire the 20:55 JST 5-minute pre-flight warning for the given JST calendar day (`YYYYMMDD`).
    FireWarning { day_ymd: u32 },
    /// Fire the 21:00 JST Peak-Hour daily routine for the given JST calendar day (`YYYYMMDD`).
    FirePeakRoutine { day_ymd: u32, preset: String },
}

#[derive(Debug, Clone)]
pub struct PeakScheduler {
    pub enabled: bool,
    pub target_preset: String,
    pub last_warn_day_ymd: u32,
    pub last_run_day_ymd: u32,
}

impl Default for PeakScheduler {
    fn default() -> Self {
        Self {
            enabled: false,
            target_preset: "siete".to_string(),
            last_warn_day_ymd: 0,
            last_run_day_ymd: 0,
        }
    }
}

/// Computes the exact milliseconds from `now_utc_ms` until the next occurrence of `(hour_jst, minute_jst, second_jst)` in JST (`UTC+9`).
pub fn compute_ms_until_next_jst_hms(
    now_utc_ms: i64,
    hour_jst: u32,
    minute_jst: u32,
    second_jst: u32,
) -> u64 {
    let jst_ms = now_utc_ms + JST_OFFSET_MS;
    let time_of_day_ms = jst_ms.rem_euclid(DAY_MS);
    let target_tod_ms = ((hour_jst.min(23) as i64) * 3600
        + (minute_jst.min(59) as i64) * 60
        + (second_jst.min(59) as i64))
        * 1000;

    let delta = if time_of_day_ms < target_tod_ms {
        target_tod_ms - time_of_day_ms
    } else {
        DAY_MS - time_of_day_ms + target_tod_ms
    };
    delta.max(1) as u64
}

/// Computes the JST calendar date (`YYYYMMDD`, switching at `00:00 JST`) for a UTC timestamp.
pub fn compute_jst_calendar_ymd(now_utc_ms: i64) -> u32 {
    // Shift +5h relative to 05:00 JST reset so `compute_gbf_server_day_ymd` yields 00:00 JST calendar day
    jst::compute_gbf_server_day_ymd(now_utc_ms + 5 * 3600 * 1000)
}

impl PeakScheduler {
    pub fn new(enabled: bool, target_preset: impl Into<String>) -> Self {
        Self {
            enabled,
            target_preset: target_preset.into(),
            last_warn_day_ymd: 0,
            last_run_day_ymd: 0,
        }
    }

    /// Evaluates the current UTC timestamp (`now_utc_ms`) and returns either an immediate action
    /// (`FireWarning` at `20:55 JST` or `FirePeakRoutine` at `21:00 JST`) or the exact `SleepMs`
    /// duration until the next milestone (zero-polling design).
    pub fn poll_or_next_sleep(&mut self, now_utc_ms: i64) -> SchedulerAction {
        if !self.enabled {
            return SchedulerAction::SleepMs(3_600_000);
        }

        let jst_ms = now_utc_ms + JST_OFFSET_MS;
        let tod_ms = jst_ms.rem_euclid(DAY_MS);
        let jst_hour = (tod_ms / 3_600_000) as u32;
        let jst_min = ((tod_ms % 3_600_000) / 60_000) as u32;
        let day_ymd = compute_jst_calendar_ymd(now_utc_ms);

        // 1. 20:55 JST -> 5-Minute Warning Window (20:55:00..20:59:59 JST)
        if jst_hour == 20 && (55..60).contains(&jst_min) && self.last_warn_day_ymd != day_ymd {
            self.last_warn_day_ymd = day_ymd;
            return SchedulerAction::FireWarning { day_ymd };
        }

        // 2. 21:00 JST -> Peak Hour Execution Window (21:00:00..21:04:59 JST)
        if jst_hour == 21 && jst_min < 5 && self.last_run_day_ymd != day_ymd {
            self.last_run_day_ymd = day_ymd;
            return SchedulerAction::FirePeakRoutine {
                day_ymd,
                preset: self.target_preset.clone(),
            };
        }

        // 3. Compute exact sleep duration until the next milestone (`20:55:05 JST` or `21:00:05 JST`)
        let ms_to_warn = compute_ms_until_next_jst_hms(now_utc_ms, 20, 55, 5);
        let ms_to_run = compute_ms_until_next_jst_hms(now_utc_ms, 21, 0, 5);
        let sleep_ms = ms_to_warn.min(ms_to_run);
        SchedulerAction::SleepMs(sleep_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zero_polling_peak_hour_schedule() {
        let mut sched = PeakScheduler::new(true, "siete");

        // 2026-03-31 11:50:00 UTC == 2026-03-31 20:50:00 JST (5m05s before 20:55:05 JST)
        let utc_20_50_jst = 1_774_957_800_000_i64;
        let act1 = sched.poll_or_next_sleep(utc_20_50_jst);
        assert_eq!(act1, SchedulerAction::SleepMs(305_000));

        // 2026-03-31 11:55:10 UTC == 2026-03-31 20:55:10 JST -> fires warning once
        let utc_20_55_jst = 1_774_958_110_000_i64;
        let act2 = sched.poll_or_next_sleep(utc_20_55_jst);
        assert_eq!(act2, SchedulerAction::FireWarning { day_ymd: 20260331 });

        // Calling again in the same 20:55 window sleeps until 21:00:05 JST (295_000 ms)
        let act3 = sched.poll_or_next_sleep(utc_20_55_jst);
        assert_eq!(act3, SchedulerAction::SleepMs(295_000));

        // 2026-03-31 12:00:10 UTC == 2026-03-31 21:00:10 JST -> fires peak routine once
        let utc_21_00_jst = 1_774_958_410_000_i64;
        let act4 = sched.poll_or_next_sleep(utc_21_00_jst);
        assert_eq!(
            act4,
            SchedulerAction::FirePeakRoutine {
                day_ymd: 20260331,
                preset: "siete".to_string()
            }
        );

        // Calling again in the same 21:00 window sleeps until tomorrow's 20:55:05 JST
        let act5 = sched.poll_or_next_sleep(utc_21_00_jst);
        if let SchedulerAction::SleepMs(ms) = act5 {
            assert!(ms > 80_000_000);
        } else {
            panic!("Expected SleepMs after peak routine fired");
        }
    }
}
