use std::fs::{self, File, OpenOptions};
use std::io;
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

        let _ = fs::remove_dir_all(&tmp_dir);
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
