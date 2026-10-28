use serde::Deserialize;
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;

#[cfg(windows)]
#[repr(C)]
struct CryptoApiBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

#[cfg(windows)]
#[link(name = "crypt32")]
extern "system" {
    fn CryptUnprotectData(
        p_data_in: *const CryptoApiBlob,
        ppsz_data_descr: *mut *mut u16,
        p_optional_entropy: *const CryptoApiBlob,
        pv_reserved: *mut core::ffi::c_void,
        p_prompt_struct: *const core::ffi::c_void,
        dw_flags: u32,
        p_data_out: *mut CryptoApiBlob,
    ) -> i32;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(h_mem: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
}

/// Ultra-fast native TCP socket probe for local Chrome DevTools Protocol (CDP) port readiness.
/// Avoids full HTTP/fetch overhead when checking if a browser profile is listening.
pub fn probe_cdp_port(port: u16, timeout_ms: u32) -> bool {
    if port == 0 {
        return false;
    }
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);
    let timeout = Duration::from_millis(timeout_ms.clamp(10, 5000) as u64);
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

/// Cleans stale Chromium Singleton lock files (`SingletonLock`, `SingletonCookie`, `SingletonSocket`)
/// inside a profile directory before launching a new browser process.
/// Returns the number of lock artifacts removed.
pub fn clean_profile_locks(profile_dir: &str) -> u32 {
    let base = Path::new(profile_dir);
    if !base.exists() {
        return 0;
    }
    let mut removed = 0;
    for lock_name in ["SingletonLock", "SingletonCookie", "SingletonSocket"] {
        let lock_path = base.join(lock_name);
        if lock_path.exists() || lock_path.is_symlink() {
            if fs::remove_file(&lock_path).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

/// Patches Chromium's `{profile_dir}/Default/Preferences` JSON in `< 0.5ms` to:
/// 1. Allow third-party cookies for Mobage & Granblue Fantasy (`cookie_controls_mode = 0`, `block_third_party_cookies = false`)
/// 2. Mark `exit_type = "Normal"` and `exited_cleanly = true` to suppress crash-restore bubbles
/// 3. Disable password manager prompts (`credentials_enable_service = false`)
pub fn patch_chrome_preferences(profile_dir: &str) -> bool {
    let default_dir = Path::new(profile_dir).join("Default");
    if fs::create_dir_all(&default_dir).is_err() {
        return false;
    }
    let pref_path = default_dir.join("Preferences");
    let mut root: Value = if let Ok(raw) = fs::read_to_string(&pref_path) {
        serde_json::from_str(&raw).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    let Some(root_obj) = root.as_object_mut() else {
        return false;
    };

    root_obj.insert("credentials_enable_service".to_string(), json!(false));

    let profile_entry = root_obj
        .entry("profile".to_string())
        .or_insert_with(|| json!({}));
    if !profile_entry.is_object() {
        *profile_entry = json!({});
    }
    if let Some(prof) = profile_entry.as_object_mut() {
        prof.insert("cookie_controls_mode".to_string(), json!(0));
        prof.insert("block_third_party_cookies".to_string(), json!(false));
        prof.insert("exit_type".to_string(), json!("Normal"));
        prof.insert("exited_cleanly".to_string(), json!(true));
        prof.insert("password_manager_enabled".to_string(), json!(false));

        let cs = prof
            .entry("content_settings".to_string())
            .or_insert_with(|| json!({}));
        if !cs.is_object() {
            *cs = json!({});
        }
        if let Some(cs_obj) = cs.as_object_mut() {
            let exc = cs_obj
                .entry("exceptions".to_string())
                .or_insert_with(|| json!({}));
            if !exc.is_object() {
                *exc = json!({});
            }
            if let Some(exc_obj) = exc.as_object_mut() {
                let cookies = exc_obj
                    .entry("cookies".to_string())
                    .or_insert_with(|| json!({}));
                if !cookies.is_object() {
                    *cookies = json!({});
                }
                if let Some(c_obj) = cookies.as_object_mut() {
                    for pattern in [
                        "https://[*.]mbga.jp,*",
                        "https://[*.]mobage.jp,*",
                        "https://[*.]granbluefantasy.jp,*",
                    ] {
                        c_obj.insert(
                            pattern.to_string(),
                            json!({ "expiration": "0", "model": 0, "setting": 1 }),
                        );
                    }
                }
            }
        }
    }

    if let Ok(serialized) = serde_json::to_vec(&root) {
        fs::write(&pref_path, serialized).is_ok()
    } else {
        false
    }
}

#[derive(Deserialize)]
struct CdpTargetInfo {
    #[serde(default)]
    id: String,
    #[serde(rename = "type", default)]
    target_type: String,
    #[serde(default)]
    url: String,
}

fn cdp_http_request(port: u16, method: &str, path: &str, timeout_ms: u64) -> Option<(u16, String)> {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);
    let timeout = Duration::from_millis(timeout_ms.clamp(25, 3000));
    let mut stream = TcpStream::connect_timeout(&addr, timeout).ok()?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).ok()?;

    let mut resp = String::new();
    let _ = stream.read_to_string(&mut resp);
    let (headers, body) = resp.split_once("\r\n\r\n")?;
    let status_line = headers.lines().next()?;
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())?;
    Some((status_code, body.to_string()))
}

/// Puts a Chrome CDP port into zero-CPU `about:blank` standby over raw TCP HTTP/1.1 (`< 2ms` local).
/// Returns the number of GBF tabs closed (`>= 0`), or `-1` if the CDP port is unreachable.
pub fn put_port_on_standby_http(port: u16, preserve_verification: bool) -> i32 {
    if port == 0 {
        return -1;
    }
    let Some((status, body)) = cdp_http_request(port, "GET", "/json/list", 400) else {
        return -1;
    };
    if status != 200 {
        return -1;
    }
    let Ok(targets) = serde_json::from_str::<Vec<CdpTargetInfo>>(&body) else {
        return -1;
    };

    let pages: Vec<&CdpTargetInfo> = targets
        .iter()
        .filter(|t| t.target_type == "page")
        .collect();

    if preserve_verification {
        let has_captcha = pages.iter().any(|t| {
            let u = t.url.to_ascii_lowercase();
            u.contains("recaptcha") || u.contains("challenge") || u.contains("captcha")
        });
        if has_captcha {
            return 0;
        }
    }

    let gbf_pages: Vec<&CdpTargetInfo> = pages
        .iter()
        .copied()
        .filter(|t| {
            t.url.contains("granbluefantasy.jp")
                || t.url.contains("mbga.jp")
                || t.url.contains("mobage.jp")
        })
        .collect();

    if gbf_pages.is_empty() {
        return 0;
    }

    let has_blank = pages.iter().any(|t| t.url == "about:blank");
    if !has_blank && pages.len() <= gbf_pages.len() {
        let put_ok = cdp_http_request(port, "PUT", "/json/new?about:blank", 400)
            .map(|(code, _)| (200..300).contains(&code))
            .unwrap_or(false);
        if !put_ok {
            let _ = cdp_http_request(port, "GET", "/json/new?about:blank", 400);
        }
    }

    let mut closed = 0;
    for page in gbf_pages {
        if !page.id.is_empty() {
            let close_path = format!("/json/close/{}", page.id);
            if cdp_http_request(port, "GET", &close_path, 400).is_some() {
                closed += 1;
            }
        }
    }
    closed
}

/// Ultra-fast 64-bit strided FNV-1a hash for screencast JPEG/WebP frame buffers.
/// Hashes frame length, header/trailer slices, and up to 512 evenly spaced sample bytes in `< 1µs`
/// so duplicate idle frames can be skipped without full-buffer hashing or base64 allocation.
pub fn hash_frame_bytes(bytes: &[u8]) -> u64 {
    let len = bytes.len();
    if len == 0 {
        return 0;
    }
    let mut hash: u64 = 0xcbf29ce484222325 ^ (len as u64);
    hash = hash.wrapping_mul(0x100000001b3);

    let head_end = len.min(64);
    for &b in &bytes[..head_end] {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }

    let stride = (len / 512).max(1);
    let mut idx = head_end;
    while idx < len {
        hash ^= bytes[idx] as u64;
        hash = hash.wrapping_mul(0x100000001b3);
        idx += stride;
    }

    let tail_start = len.saturating_sub(64);
    for &b in &bytes[tail_start..] {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Copies a file even when locked exclusively by a running Chromium instance on Windows
/// using `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE` (`share_mode(7)`).
/// Replaces spawning a 75 MB `powershell.exe` process in `scripts/extract-any-browser.ts`.
pub fn copy_locked_file(src_path: &str, dst_path: &str) -> bool {
    let src = Path::new(src_path);
    let dst = Path::new(dst_path);
    if !src.exists() {
        return false;
    }

    #[cfg(windows)]
    let open_res = OpenOptions::new()
        .read(true)
        .share_mode(0x00000001 | 0x00000002 | 0x00000004) // FILE_SHARE_READ | WRITE | DELETE
        .open(src);

    #[cfg(not(windows))]
    let open_res = OpenOptions::new().read(true).open(src);

    let Ok(mut reader) = open_res else {
        return false;
    };
    let Ok(mut writer) = File::create(dst) else {
        return false;
    };

    io::copy(&mut reader, &mut writer).is_ok()
}

/// Decrypts a Windows DPAPI-protected blob (such as Chrome's `Local State` `os_crypt.encrypted_key`)
/// directly via Win32 `CryptUnprotectData` (`crypt32.dll`) in `< 20µs` without spawning `powershell.exe`.
#[cfg(windows)]
pub fn dpapi_unprotect(encrypted: &[u8]) -> Option<Vec<u8>> {
    if encrypted.is_empty() {
        return None;
    }
    let mut in_blob = CryptoApiBlob {
        cb_data: encrypted.len() as u32,
        pb_data: encrypted.as_ptr() as *mut u8,
    };
    let mut out_blob = CryptoApiBlob {
        cb_data: 0,
        pb_data: core::ptr::null_mut(),
    };

    // CRYPTPROTECT_UI_FORBIDDEN = 0x1
    let ok = unsafe {
        CryptUnprotectData(
            &mut in_blob,
            core::ptr::null_mut(),
            core::ptr::null(),
            core::ptr::null_mut(),
            core::ptr::null(),
            0x1,
            &mut out_blob,
        )
    };

    if ok == 0 || out_blob.pb_data.is_null() {
        return None;
    }

    let decrypted =
        unsafe { core::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize).to_vec() };
    unsafe {
        LocalFree(out_blob.pb_data as *mut core::ffi::c_void);
    }
    Some(decrypted)
}

#[cfg(not(windows))]
pub fn dpapi_unprotect(_encrypted: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const CryptoApiBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const CryptoApiBlob,
            pv_reserved: *mut core::ffi::c_void,
            p_prompt_struct: *const core::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut CryptoApiBlob,
        ) -> i32;
    }

    #[test]
    fn test_copy_locked_file_and_clean_locks() {
        let tmp_dir = std::env::temp_dir().join("gbf_rust_launcher_test");
        let _ = fs::create_dir_all(&tmp_dir);
        let lock_file = tmp_dir.join("SingletonLock");
        fs::write(&lock_file, b"lock").unwrap();

        let src_file = tmp_dir.join("Cookies_test.db");
        let dst_file = tmp_dir.join("Cookies_copy.db");
        fs::write(&src_file, b"sqlite_cookie_payload_123").unwrap();

        assert!(copy_locked_file(
            src_file.to_str().unwrap(),
            dst_file.to_str().unwrap()
        ));
        assert_eq!(
            fs::read(&dst_file).unwrap(),
            b"sqlite_cookie_payload_123"
        );

        let removed = clean_profile_locks(tmp_dir.to_str().unwrap());
        assert_eq!(removed, 1);
        assert!(!lock_file.exists());

        assert!(patch_chrome_preferences(tmp_dir.to_str().unwrap()));
        let prefs_raw = fs::read_to_string(tmp_dir.join("Default").join("Preferences")).unwrap();
        assert!(prefs_raw.contains("cookie_controls_mode"));
        assert!(prefs_raw.contains("mbga.jp"));

        let _ = fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_hash_frame_bytes() {
        let f1 = vec![0xab_u8; 4096];
        let mut f2 = f1.clone();
        assert_eq!(hash_frame_bytes(&f1), hash_frame_bytes(&f2));
        f2[2048] = 0xcd;
        assert_ne!(hash_frame_bytes(&f1), hash_frame_bytes(&f2));
    }

    #[cfg(windows)]
    #[test]
    fn test_dpapi_roundtrip_win32() {
        let secret = b"gbf_master_key_aes256_secret_32b";
        let in_blob = CryptoApiBlob {
            cb_data: secret.len() as u32,
            pb_data: secret.as_ptr() as *mut u8,
        };
        let mut enc_blob = CryptoApiBlob {
            cb_data: 0,
            pb_data: core::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &in_blob,
                core::ptr::null(),
                core::ptr::null(),
                core::ptr::null_mut(),
                core::ptr::null(),
                0x1,
                &mut enc_blob,
            )
        };
        assert_ne!(ok, 0);
        let encrypted = unsafe {
            core::slice::from_raw_parts(enc_blob.pb_data, enc_blob.cb_data as usize).to_vec()
        };
        unsafe {
            LocalFree(enc_blob.pb_data as *mut core::ffi::c_void);
        }

        let decrypted = dpapi_unprotect(&encrypted).expect("DPAPI unprotect should succeed");
        assert_eq!(decrypted.as_slice(), secret);
    }
}
