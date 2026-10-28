// crates/gbf-core/src/lib.rs
pub mod catalog;
pub mod dsl;
pub mod evaluator;
pub mod jst;
pub mod launcher;
pub mod motor;
pub mod telemetry;

use std::slice;

/// Returns ABI version `100` (v1.0.0) for runtime health check.
#[no_mangle]
pub extern "C" fn gbf_core_version() -> u32 {
    100
}

#[no_mangle]
pub extern "C" fn gbf_sample_gaussian(mean: f64, std_dev: f64) -> f64 {
    motor::sample_gaussian(mean, std_dev)
}

#[no_mangle]
pub extern "C" fn gbf_log_normal_delay(
    median_ms: f64,
    shape: f64,
    speed_profile: u8,
    is_production: u8,
) -> u32 {
    motor::sample_log_normal_delay(median_ms, shape, speed_profile, is_production != 0)
}

#[no_mangle]
pub extern "C" fn gbf_inter_run_delay(speed_profile: u8, is_production: u8) -> u32 {
    motor::sample_inter_run_delay(speed_profile, is_production != 0)
}

#[no_mangle]
pub unsafe extern "C" fn gbf_evaluate_cubic_bezier(
    p0x: f64,
    p0y: f64,
    p1x: f64,
    p1y: f64,
    p2x: f64,
    p2y: f64,
    p3x: f64,
    p3y: f64,
    t: f64,
    out_xy: *mut f64,
) {
    if out_xy.is_null() {
        return;
    }
    let (x, y) = motor::evaluate_cubic_bezier(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, t);
    *out_xy = x;
    *out_xy.add(1) = y;
}

#[no_mangle]
pub unsafe extern "C" fn gbf_sample_target_coord(
    bx: f64,
    by: f64,
    bw: f64,
    bh: f64,
    out_xy: *mut f64,
) {
    if out_xy.is_null() {
        return;
    }
    let (x, y) = motor::sample_target_coordinate(bx, by, bw, bh);
    *out_xy = x;
    *out_xy.add(1) = y;
}

#[no_mangle]
pub unsafe extern "C" fn gbf_compute_bezier_trajectory(
    start_x: f64,
    start_y: f64,
    target_x: f64,
    target_y: f64,
    speed_profile: u8,
    out_buf: *mut f64,
    out_cap: usize,
) -> u32 {
    if out_buf.is_null() || out_cap < 3 {
        return 0;
    }
    let slice = slice::from_raw_parts_mut(out_buf, out_cap);
    motor::compute_bezier_trajectory(start_x, start_y, target_x, target_y, speed_profile, slice)
        as u32
}

#[no_mangle]
pub unsafe extern "C" fn gbf_scan_payload_flags(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let bytes = slice::from_raw_parts(ptr, len);
    telemetry::scan_payload_flags(bytes)
}

#[no_mangle]
pub unsafe extern "C" fn gbf_extract_combat_metrics(
    ptr: *const u8,
    len: usize,
    out_metrics: *mut f64,
) -> u32 {
    if ptr.is_null() || len == 0 || out_metrics.is_null() {
        return 0;
    }
    let bytes = slice::from_raw_parts(ptr, len);
    let out_slice = slice::from_raw_parts_mut(out_metrics, 6);
    if telemetry::extract_combat_metrics(bytes, out_slice) {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn gbf_raid_velocity_record(
    id_ptr: *const u8,
    id_len: usize,
    hp_pct: f64,
    players: i32,
    now_ms: f64,
    ttl_ms: f64,
    out_metrics: *mut f64,
) {
    if out_metrics.is_null() {
        return;
    }
    let id_slice = if id_ptr.is_null() || id_len == 0 {
        &[][..]
    } else {
        slice::from_raw_parts(id_ptr, id_len)
    };
    let m = evaluator::record_observation(id_slice, hp_pct, players, now_ms, ttl_ms);
    let out = slice::from_raw_parts_mut(out_metrics, 6);
    out[0] = m.observations as f64;
    out[1] = m.elapsed_sec;
    out[2] = m.hp_burn_per_sec;
    out[3] = m.player_join_rate;
    out[4] = m.estimated_ttd_sec;
    out[5] = if m.is_stalled { 1.0 } else { 0.0 };
}

#[no_mangle]
pub unsafe extern "C" fn gbf_raid_velocity_get(
    id_ptr: *const u8,
    id_len: usize,
    now_ms: f64,
    ttl_ms: f64,
    out_metrics: *mut f64,
) -> u32 {
    if id_ptr.is_null() || id_len == 0 || out_metrics.is_null() {
        return 0;
    }
    let id_slice = slice::from_raw_parts(id_ptr, id_len);
    if let Some(m) = evaluator::get_observation_metrics(id_slice, now_ms, ttl_ms) {
        let out = slice::from_raw_parts_mut(out_metrics, 6);
        out[0] = m.observations as f64;
        out[1] = m.elapsed_sec;
        out[2] = m.hp_burn_per_sec;
        out[3] = m.player_join_rate;
        out[4] = m.estimated_ttd_sec;
        out[5] = if m.is_stalled { 1.0 } else { 0.0 };
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn gbf_raid_velocity_clear() {
    evaluator::clear_velocity_store();
}

#[no_mangle]
pub extern "C" fn gbf_raid_velocity_size() -> u32 {
    evaluator::velocity_store_size() as u32
}

#[no_mangle]
pub extern "C" fn gbf_next_daily_reset_utc_ms(
    reference_utc_ms: f64,
    target_hour_jst: u32,
    buffer_seconds: u32,
) -> f64 {
    jst::compute_next_daily_reset_utc_ms(
        reference_utc_ms as i64,
        target_hour_jst,
        buffer_seconds,
    ) as f64
}

#[no_mangle]
pub extern "C" fn gbf_server_day_ymd(utc_ms: f64) -> u32 {
    jst::compute_gbf_server_day_ymd(utc_ms as i64)
}

#[no_mangle]
pub unsafe extern "C" fn gbf_parse_dsl_line(
    ptr: *const u8,
    len: usize,
    out_ints: *mut i32,
) -> i32 {
    if out_ints.is_null() {
        return -1;
    }
    let bytes = if ptr.is_null() || len == 0 {
        &[][..]
    } else {
        slice::from_raw_parts(ptr, len)
    };
    let tok = dsl::parse_dsl_line(bytes);
    let out = slice::from_raw_parts_mut(out_ints, 5);
    out[0] = tok.opcode;
    out[1] = tok.arg1;
    out[2] = tok.arg2;
    out[3] = tok.arg3;
    out[4] = tok.arg4;
    tok.opcode
}

#[no_mangle]
pub unsafe extern "C" fn gbf_catalog_load(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let bytes = slice::from_raw_parts(ptr, len);
    let Ok(dir_str) = core::str::from_utf8(bytes) else {
        return 0;
    };
    catalog::load_catalog_dir(dir_str)
}

#[no_mangle]
pub unsafe extern "C" fn gbf_catalog_lookup_raid(
    ptr: *const u8,
    len: usize,
    out_ints: *mut u32,
) -> u32 {
    if ptr.is_null() || len == 0 || out_ints.is_null() {
        return 0;
    }
    let bytes = slice::from_raw_parts(ptr, len);
    let Ok(query) = core::str::from_utf8(bytes) else {
        return 0;
    };
    let (quest_id, blue_honors) = catalog::lookup_raid(query);
    let out = slice::from_raw_parts_mut(out_ints, 2);
    out[0] = quest_id;
    out[1] = blue_honors;
    quest_id
}

#[no_mangle]
pub unsafe extern "C" fn gbf_catalog_optimal_element(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return 6;
    }
    let bytes = slice::from_raw_parts(ptr, len);
    let Ok(elem) = core::str::from_utf8(bytes) else {
        return 6;
    };
    catalog::lookup_optimal_element_code(elem)
}

#[no_mangle]
pub unsafe extern "C" fn gbf_catalog_counts(out_ints: *mut u32) {
    if out_ints.is_null() {
        return;
    }
    let (raids, omens, selectors) = catalog::catalog_counts();
    let out = slice::from_raw_parts_mut(out_ints, 3);
    out[0] = raids;
    out[1] = omens;
    out[2] = selectors;
}

#[no_mangle]
pub extern "C" fn gbf_probe_cdp_port(port: u16, timeout_ms: u32) -> u32 {
    if launcher::probe_cdp_port(port, timeout_ms) {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn gbf_clean_profile_locks(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let bytes = slice::from_raw_parts(ptr, len);
    let Ok(dir_str) = core::str::from_utf8(bytes) else {
        return 0;
    };
    launcher::clean_profile_locks(dir_str)
}

#[no_mangle]
pub unsafe extern "C" fn gbf_copy_locked_file(
    src_ptr: *const u8,
    src_len: usize,
    dst_ptr: *const u8,
    dst_len: usize,
) -> u32 {
    if src_ptr.is_null() || src_len == 0 || dst_ptr.is_null() || dst_len == 0 {
        return 0;
    }
    let Ok(src_str) = core::str::from_utf8(slice::from_raw_parts(src_ptr, src_len)) else {
        return 0;
    };
    let Ok(dst_str) = core::str::from_utf8(slice::from_raw_parts(dst_ptr, dst_len)) else {
        return 0;
    };
    if launcher::copy_locked_file(src_str, dst_str) {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn gbf_dpapi_unprotect(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_cap: usize,
) -> u32 {
    if in_ptr.is_null() || in_len == 0 || out_ptr.is_null() || out_cap == 0 {
        return 0;
    }
    let in_bytes = slice::from_raw_parts(in_ptr, in_len);
    let Some(decrypted) = launcher::dpapi_unprotect(in_bytes) else {
        return 0;
    };
    if decrypted.len() > out_cap {
        return 0;
    }
    let out_slice = slice::from_raw_parts_mut(out_ptr, decrypted.len());
    out_slice.copy_from_slice(&decrypted);
    decrypted.len() as u32
}


#[no_mangle]
pub unsafe extern "C" fn gbf_patch_chrome_preferences(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let Ok(dir_str) = core::str::from_utf8(slice::from_raw_parts(ptr, len)) else {
        return 0;
    };
    if launcher::patch_chrome_preferences(dir_str) {
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn gbf_put_port_on_standby(port: u16, preserve_verification: u8) -> i32 {
    launcher::put_port_on_standby_http(port, preserve_verification != 0)
}

#[no_mangle]
pub unsafe extern "C" fn gbf_hash_frame_bytes(ptr: *const u8, len: usize) -> u64 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let bytes = slice::from_raw_parts(ptr, len);
    launcher::hash_frame_bytes(bytes)
}
