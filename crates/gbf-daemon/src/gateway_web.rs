use crate::runner::ProcessOrchestrator;
use gbf_core::launcher;
use serde_json::json;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// Pure-Rust SHA-1 implementation for RFC 6455 WebSocket handshake (`Sec-WebSocket-Accept`).
fn sha1_digest(data: &[u8]) -> [u8; 20] {
    let mut h0: u32 = 0x67452301;
    let mut h1: u32 = 0xEFCDAB89;
    let mut h2: u32 = 0x98BADCFE;
    let mut h3: u32 = 0x10325476;
    let mut h4: u32 = 0xC3D2E1F0;

    let bit_len = (data.len() as u64) * 8;
    let mut padded = data.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 80];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let mut a = h0;
        let mut b = h1;
        let mut c = h2;
        let mut d = h3;
        let mut e = h4;

        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    out[0..4].copy_from_slice(&h0.to_be_bytes());
    out[4..8].copy_from_slice(&h1.to_be_bytes());
    out[8..12].copy_from_slice(&h2.to_be_bytes());
    out[12..16].copy_from_slice(&h3.to_be_bytes());
    out[16..20].copy_from_slice(&h4.to_be_bytes());
    out
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Computes the RFC 6455 `Sec-WebSocket-Accept` header value for a given `Sec-WebSocket-Key`.
pub fn compute_ws_accept_key(sec_websocket_key: &str) -> String {
    let mut combined = String::with_capacity(sec_websocket_key.len() + WS_GUID.len());
    combined.push_str(sec_websocket_key.trim());
    combined.push_str(WS_GUID);
    let digest = sha1_digest(combined.as_bytes());
    base64_encode(&digest)
}

/// Encodes a UTF-8 text payload into an unmasked server-to-client RFC 6455 WebSocket frame.
pub fn encode_ws_text_frame(payload: &str) -> Vec<u8> {
    let bytes = payload.as_bytes();
    let len = bytes.len();
    let mut frame = Vec::with_capacity(len + 10);
    frame.push(0x81); // FIN + Text opcode (0x1)
    if len < 126 {
        frame.push(len as u8);
    } else if len <= 65535 {
        frame.push(126);
        frame.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        frame.push(127);
        frame.extend_from_slice(&(len as u64).to_be_bytes());
    }
    frame.extend_from_slice(bytes);
    frame
}

pub struct ScreencastBroadcaster {
    last_frame_hash: u64,
    last_frame_ws_bytes: Option<Vec<u8>>,
    clients: Vec<TcpStream>,
}

impl Default for ScreencastBroadcaster {
    fn default() -> Self {
        Self::new()
    }
}

impl ScreencastBroadcaster {
    pub fn new() -> Self {
        Self {
            last_frame_hash: 0,
            last_frame_ws_bytes: None,
            clients: Vec::new(),
        }
    }

    pub fn add_client(&mut self, mut stream: TcpStream) {
        if let Some(cached) = &self.last_frame_ws_bytes {
            let _ = stream.write_all(cached);
        }
        self.clients.push(stream);
    }

    /// Broadcasts a base64 JPEG screencast frame to all connected WebSocket clients if and only if
    /// its 64-bit strided FNV-1a hash differs from the previous frame (`true` if broadcast, `false` if deduplicated).
    pub fn broadcast_jpeg_base64(&mut self, base64_jpeg: &str, timestamp_ms: u64) -> bool {
        let hash = launcher::hash_frame_bytes(base64_jpeg.as_bytes());
        if hash != 0 && hash == self.last_frame_hash {
            return false;
        }
        self.last_frame_hash = hash;

        let msg = json!({
            "type": "EVENT_SCREENCAST_FRAME",
            "data": format!("data:image/jpeg;base64,{base64_jpeg}"),
            "timestamp": timestamp_ms
        })
        .to_string();
        let ws_frame = encode_ws_text_frame(&msg);
        self.last_frame_ws_bytes = Some(ws_frame.clone());

        self.clients
            .retain_mut(|client| client.write_all(&ws_frame).is_ok());
        true
    }
}

/// Evaluates an HTTP request path & method against the `ProcessOrchestrator` and returns `(status_code, content_type, body)`.
pub fn handle_http_route(
    method: &str,
    path: &str,
    orchestrator: &ProcessOrchestrator,
) -> (u16, &'static str, Vec<u8>) {
    if path == "/api/health" {
        let body = json!({ "ok": true, "service": "gbf-daemon", "version": "1.0.0" }).to_string();
        return (200, "application/json", body.into_bytes());
    }
    if path == "/api/status" {
        let st = orchestrator.status();
        let cdp_online = launcher::probe_cdp_port(st.cdp_port, 100);
        let body = json!({
            "ok": true,
            "status": st,
            "cdpOnline": cdp_online
        })
        .to_string();
        return (200, "application/json", body.into_bytes());
    }
    if path == "/api/logs" {
        let logs = orchestrator.recent_logs(50);
        let body = json!({ "ok": true, "logs": logs }).to_string();
        return (200, "application/json", body.into_bytes());
    }
    if path == "/api/stop" && (method == "POST" || method == "GET") {
        let stopped = orchestrator.stop_current_task();
        let body = json!({ "ok": true, "stopped": stopped }).to_string();
        return (200, "application/json", body.into_bytes());
    }
    if path == "/api/standby" && (method == "POST" || method == "GET") {
        let st = orchestrator.status();
        let closed = launcher::put_port_on_standby_http(st.cdp_port, true);
        let body = json!({ "ok": closed >= 0, "closedTabs": closed }).to_string();
        return (200, "application/json", body.into_bytes());
    }
    if let Some(preset) = path.strip_prefix("/api/run/") {
        let res = orchestrator.start_preset(preset, &[]);
        return match res {
            Ok(pid) => (
                200,
                "application/json",
                json!({ "ok": true, "preset": preset, "pid": pid })
                    .to_string()
                    .into_bytes(),
            ),
            Err(err) => (
                400,
                "application/json",
                json!({ "ok": false, "error": err })
                    .to_string()
                    .into_bytes(),
            ),
        };
    }

    // Static file fallback (`public/index.html`)
    let clean_rel = if path == "/" || path.is_empty() {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };
    if !clean_rel.contains("..") {
        let disk_path = Path::new("public").join(clean_rel);
        if let Ok(bytes) = fs::read(&disk_path) {
            let ctype = if clean_rel.ends_with(".html") {
                "text/html; charset=utf-8"
            } else if clean_rel.ends_with(".js") {
                "application/javascript; charset=utf-8"
            } else if clean_rel.ends_with(".css") {
                "text/css; charset=utf-8"
            } else {
                "application/octet-stream"
            };
            return (200, ctype, bytes);
        }
    }

    (
        404,
        "application/json",
        json!({ "ok": false, "error": "Not Found" })
            .to_string()
            .into_bytes(),
    )
}

pub fn serve_gateway_blocking(
    bind_addr: &str,
    orchestrator: ProcessOrchestrator,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(bind_addr)?;
    let broadcaster = Arc::new(Mutex::new(ScreencastBroadcaster::new()));

    for stream in listener.incoming().flatten() {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
        let orch = orchestrator.clone();
        let bcast = Arc::clone(&broadcaster);
        handle_client_stream(stream, &orch, &bcast);
    }
    Ok(())
}

fn handle_client_stream(
    mut stream: TcpStream,
    orchestrator: &ProcessOrchestrator,
    broadcaster: &Arc<Mutex<ScreencastBroadcaster>>,
) {
    let mut buf = [0u8; 4096];
    let Ok(n) = stream.read(&mut buf) else {
        return;
    };
    if n == 0 {
        return;
    }
    let req_str = String::from_utf8_lossy(&buf[..n]);
    let mut lines = req_str.lines();
    let Some(request_line) = lines.next() else {
        return;
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let path = parts.next().unwrap_or("/");

    // Check for WebSocket upgrade header
    let mut ws_key: Option<String> = None;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("Sec-WebSocket-Key") {
                ws_key = Some(v.trim().to_string());
            }
        }
    }

    if let Some(key) = ws_key {
        let accept = compute_ws_accept_key(&key);
        let handshake = format!(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
        );
        if stream.write_all(handshake.as_bytes()).is_ok() {
            if let Ok(mut guard) = broadcaster.lock() {
                guard.add_client(stream);
            }
        }
        return;
    }

    let (status, content_type, body) = handle_http_route(method, path, orchestrator);
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Not Found",
    };
    let header = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&body);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rfc6455_websocket_accept_vector() {
        // Official RFC 6455 Section 1.3 test vector
        let key = "dGhlIHNhbXBsZSBub25jZQ==";
        let accept = compute_ws_accept_key(key);
        assert_eq!(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    #[test]
    fn test_screencast_deduplication_and_routes() {
        let mut bcast = ScreencastBroadcaster::new();
        assert!(bcast.broadcast_jpeg_base64("AAAA_JPEG_FRAME_1", 1000));
        // Second identical frame must be deduplicated
        assert!(!bcast.broadcast_jpeg_base64("AAAA_JPEG_FRAME_1", 1800));
        // New frame content must broadcast
        assert!(bcast.broadcast_jpeg_base64("BBBB_JPEG_FRAME_2", 2600));

        let orch = ProcessOrchestrator::new("", 19222);
        let (code, ctype, body) = handle_http_route("GET", "/api/health", &orch);
        assert_eq!(code, 200);
        assert_eq!(ctype, "application/json");
        assert!(String::from_utf8_lossy(&body).contains("\"gbf-daemon\""));
    }
}
