use crate::{motor, telemetry};
use memchr::memmem;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CdpTargetDescriptor {
    #[serde(default)]
    pub id: String,
    #[serde(rename = "type", default)]
    pub target_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl", default)]
    pub web_socket_debugger_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameClassification {
    /// Frame is a JSON-RPC response containing `"id":`
    RpcResponse,
    /// Frame is a CDP event matching the awaited network URL substring
    MatchedNetworkEvent,
    /// Frame contains combat telemetry / CAPTCHA / drop markers worth inspecting
    CombatTelemetryEvent { flags: u32 },
    /// High-volume CDP chatter (DOM/Network extra info) safely skipped with zero JSON allocation
    IgnoredNoise,
}

/// Zero-allocation byte-level pre-filter for raw CDP WebSocket frames.
/// Avoids `serde_json::from_slice` heap allocations on ~98% of noisy Chromium DevTools events.
pub fn classify_raw_cdp_frame(
    raw: &[u8],
    wait_network_substr: Option<&str>,
) -> FrameClassification {
    if raw.is_empty() {
        return FrameClassification::IgnoredNoise;
    }

    // 1. Fast check for JSON-RPC response (`"id":`)
    if memmem::find(raw, b"\"id\":").is_some() {
        return FrameClassification::RpcResponse;
    }

    // 2. Check if awaiting a specific network URL (e.g. `ability_result.json`, `normal_attack_result.json`)
    if let Some(needle) = wait_network_substr {
        if !needle.is_empty() && memmem::find(raw, needle.as_bytes()).is_some() {
            return FrameClassification::MatchedNetworkEvent;
        }
    }

    // 3. SIMD Aho-Corasick telemetry scan for Gold Bar, Blue Chest, Boss HP, CAPTCHA, or Result markers
    let flags = telemetry::scan_payload_flags(raw);
    if flags != 0 {
        return FrameClassification::CombatTelemetryEvent { flags };
    }

    FrameClassification::IgnoredNoise
}

fn raw_http_request(port: u16, method: &str, path: &str, timeout_ms: u64) -> Result<(u16, String), String> {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);
    let timeout = Duration::from_millis(timeout_ms.clamp(50, 5000));
    let mut stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| format!("Failed to connect to CDP HTTP 127.0.0.1:{port}: {e}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("Failed to write HTTP request: {e}"))?;

    let mut resp = String::new();
    let _ = stream.read_to_string(&mut resp);
    let Some((headers, body)) = resp.split_once("\r\n\r\n") else {
        return Err("Malformed HTTP response from CDP endpoint".to_string());
    };
    let status_code = headers
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);
    Ok((status_code, body.to_string()))
}

/// Discovers an active Granblue Fantasy `page` target on `127.0.0.1:{port}` or opens a new tab.
pub fn discover_or_create_gbf_target(port: u16) -> Result<CdpTargetDescriptor, String> {
    let (status, body) = raw_http_request(port, "GET", "/json/list", 1500)?;
    if status != 200 {
        return Err(format!("CDP /json/list returned HTTP {status}"));
    }

    let targets: Vec<CdpTargetDescriptor> = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse /json/list JSON: {e}"))?;

    // 1. Prefer an existing Granblue Fantasy / Mobage page target
    if let Some(gbf_target) = targets.iter().find(|t| {
        t.target_type == "page"
            && (t.url.contains("granbluefantasy.jp")
                || t.url.contains("mbga.jp")
                || t.url.contains("mobage.jp"))
            && !t.web_socket_debugger_url.is_empty()
    }) {
        return Ok(gbf_target.clone());
    }

    // 2. Fallback to any existing `page` target (e.g. `about:blank` standby tab)
    if let Some(any_page) = targets
        .iter()
        .find(|t| t.target_type == "page" && !t.web_socket_debugger_url.is_empty())
    {
        return Ok(any_page.clone());
    }

    // 3. Create a new page target via PUT /json/new
    let (new_code, new_body) =
        raw_http_request(port, "PUT", "/json/new?https://game.granbluefantasy.jp/#mypage", 2000)
            .or_else(|_| {
                raw_http_request(
                    port,
                    "GET",
                    "/json/new?https://game.granbluefantasy.jp/#mypage",
                    2000,
                )
            })?;

    if (200..300).contains(&new_code) {
        if let Ok(created) = serde_json::from_str::<CdpTargetDescriptor>(&new_body) {
            if !created.web_socket_debugger_url.is_empty() {
                return Ok(created);
            }
        }
    }

    Err("No usable Chrome page target found on CDP port".to_string())
}

/// Extracts `(port, path)` from a `ws://127.0.0.1:9222/devtools/page/...` URL.
pub fn parse_ws_debugger_url(ws_url: &str, default_port: u16) -> (u16, String) {
    let stripped = ws_url
        .strip_prefix("ws://")
        .or_else(|| ws_url.strip_prefix("wss://"))
        .unwrap_or(ws_url);
    if let Some((host_port, path_part)) = stripped.split_once('/') {
        let port = host_port
            .split_once(':')
            .and_then(|(_, p)| p.parse::<u16>().ok())
            .unwrap_or(default_port);
        (port, format!("/{path_part}"))
    } else {
        (default_port, "/".to_string())
    }
}

/// Pure-Rust, zero-bloat RFC 6455 WebSocket client for localhost Chrome DevTools Protocol (CDP).
pub struct CdpWsClient {
    stream: TcpStream,
    rx_buf: Vec<u8>,
    rx_pos: usize,
    next_rpc_id: u32,
    pub last_telemetry_flags: u32,
    pub last_honors: f64,
    pub last_boss_hp_pct: f64,
    pub last_turn: f64,
}

impl CdpWsClient {
    /// Connects to `127.0.0.1:{port}` and performs the RFC 6455 WebSocket upgrade handshake for `ws_path`.
    pub fn connect(port: u16, ws_path: &str, timeout_ms: u64) -> Result<Self, String> {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);
        let timeout = Duration::from_millis(timeout_ms.clamp(100, 10_000));
        let mut stream = TcpStream::connect_timeout(&addr, timeout)
            .map_err(|e| format!("CDP WebSocket TCP connect failed (127.0.0.1:{port}): {e}"))?;
        let _ = stream.set_nodelay(true);
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));

        let handshake = format!(
            "GET {ws_path} HTTP/1.1\r\n\
             Host: 127.0.0.1:{port}\r\n\
             Upgrade: websocket\r\n\
             Connection: Upgrade\r\n\
             Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
             Sec-WebSocket-Version: 13\r\n\r\n"
        );
        stream
            .write_all(handshake.as_bytes())
            .map_err(|e| format!("CDP WebSocket handshake write failed: {e}"))?;

        let mut buf = Vec::with_capacity(8192);
        let mut temp = [0u8; 2048];
        let header_end = loop {
            let n = stream
                .read(&mut temp)
                .map_err(|e| format!("CDP WebSocket handshake read failed: {e}"))?;
            if n == 0 {
                return Err("CDP WebSocket closed during handshake".to_string());
            }
            buf.extend_from_slice(&temp[..n]);
            if let Some(pos) = memmem::find(&buf, b"\r\n\r\n") {
                break pos + 4;
            }
            if buf.len() > 16384 {
                return Err("CDP WebSocket handshake headers exceeded 16 KB".to_string());
            }
        };

        let header_str = String::from_utf8_lossy(&buf[..header_end]);
        if !header_str.starts_with("HTTP/1.1 101") {
            return Err(format!(
                "CDP WebSocket upgrade rejected: {}",
                header_str.lines().next().unwrap_or("Unknown")
            ));
        }

        let leftover = buf[header_end..].to_vec();
        Ok(Self {
            stream,
            rx_buf: leftover,
            rx_pos: 0,
            next_rpc_id: 1,
            last_telemetry_flags: 0,
            last_honors: 0.0,
            last_boss_hp_pct: 100.0,
            last_turn: 1.0,
        })
    }

    /// Connects directly to the active GBF page target on `port`.
    pub fn connect_to_gbf_page(port: u16, timeout_ms: u64) -> Result<(Self, CdpTargetDescriptor), String> {
        let target = discover_or_create_gbf_target(port)?;
        let (ws_port, ws_path) = parse_ws_debugger_url(&target.web_socket_debugger_url, port);
        let client = Self::connect(ws_port, &ws_path, timeout_ms)?;
        Ok((client, target))
    }

    pub fn next_id(&mut self) -> u32 {
        let id = self.next_rpc_id;
        self.next_rpc_id = self.next_rpc_id.wrapping_add(1).max(1);
        id
    }

    fn ensure_bytes(&mut self, needed: usize) -> io::Result<()> {
        while self.rx_buf.len().saturating_sub(self.rx_pos) < needed {
            if self.rx_pos > 0 && self.rx_pos == self.rx_buf.len() {
                self.rx_buf.clear();
                self.rx_pos = 0;
            } else if self.rx_pos > 65536 {
                self.rx_buf.drain(..self.rx_pos);
                self.rx_pos = 0;
            }
            let mut chunk = [0u8; 8192];
            let n = self.stream.read(&mut chunk)?;
            if n == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "CDP WebSocket stream closed by peer",
                ));
            }
            self.rx_buf.extend_from_slice(&chunk[..n]);
        }
        Ok(())
    }

    fn consume_bytes(&mut self, count: usize) -> Vec<u8> {
        let end = self.rx_pos + count;
        let out = self.rx_buf[self.rx_pos..end].to_vec();
        self.rx_pos = end;
        if self.rx_pos == self.rx_buf.len() {
            self.rx_buf.clear();
            self.rx_pos = 0;
        }
        out
    }

    /// Writes a masked RFC 6455 frame (`opcode = 0x1` for text, `0xA` for pong).
    pub fn write_masked_frame(&mut self, opcode: u8, payload: &[u8]) -> Result<(), String> {
        let len = payload.len();
        let mut frame = Vec::with_capacity(len + 14);
        frame.push(0x80 | (opcode & 0x0F)); // FIN = 1

        if len < 126 {
            frame.push(0x80 | (len as u8));
        } else if len <= 65535 {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            frame.push(0x80 | 127);
            frame.extend_from_slice(&(len as u64).to_be_bytes());
        }

        // Fixed fast deterministic mask key (localhost loopback RFC 6455 compliance)
        let mask: [u8; 4] = [0x37, 0xFA, 0x21, 0x3D];
        frame.extend_from_slice(&mask);

        for (i, &b) in payload.iter().enumerate() {
            frame.push(b ^ mask[i & 3]);
        }

        self.stream
            .write_all(&frame)
            .map_err(|e| format!("Failed to write WebSocket frame: {e}"))
    }

    pub fn send_text(&mut self, text: &str) -> Result<(), String> {
        self.write_masked_frame(0x1, text.as_bytes())
    }

    pub fn send_json(&mut self, val: &Value) -> Result<(), String> {
        let serialized =
            serde_json::to_vec(val).map_err(|e| format!("JSON serialize error: {e}"))?;
        self.write_masked_frame(0x1, &serialized)
    }

    /// Reads one complete RFC 6455 message (handling fragmented continuation frames and Ping/Pong).
    pub fn read_message(&mut self, timeout_ms: u64) -> Result<Vec<u8>, String> {
        let _ = self
            .stream
            .set_read_timeout(Some(Duration::from_millis(timeout_ms.clamp(20, 30_000))));

        let mut assembled = Vec::new();
        loop {
            self.ensure_bytes(2)
                .map_err(|e| format!("WebSocket read header error: {e}"))?;
            let head = self.consume_bytes(2);
            let fin = (head[0] & 0x80) != 0;
            let opcode = head[0] & 0x0F;
            let masked = (head[1] & 0x80) != 0;
            let mut payload_len = (head[1] & 0x7F) as usize;

            if payload_len == 126 {
                self.ensure_bytes(2)
                    .map_err(|e| format!("WebSocket read 16-bit len error: {e}"))?;
                let ext = self.consume_bytes(2);
                payload_len = u16::from_be_bytes([ext[0], ext[1]]) as usize;
            } else if payload_len == 127 {
                self.ensure_bytes(8)
                    .map_err(|e| format!("WebSocket read 64-bit len error: {e}"))?;
                let ext = self.consume_bytes(8);
                payload_len = u64::from_be_bytes([
                    ext[0], ext[1], ext[2], ext[3], ext[4], ext[5], ext[6], ext[7],
                ]) as usize;
            }

            let mask_key = if masked {
                self.ensure_bytes(4)
                    .map_err(|e| format!("WebSocket read mask error: {e}"))?;
                let m = self.consume_bytes(4);
                Some([m[0], m[1], m[2], m[3]])
            } else {
                None
            };

            self.ensure_bytes(payload_len)
                .map_err(|e| format!("WebSocket read payload error: {e}"))?;
            let mut data = self.consume_bytes(payload_len);

            if let Some(mask) = mask_key {
                for (i, b) in data.iter_mut().enumerate() {
                    *b ^= mask[i & 3];
                }
            }

            match opcode {
                0x8 => {
                    return Err("CDP WebSocket closed by browser (opcode 0x8)".to_string());
                }
                0x9 => {
                    // Ping -> immediately send Pong
                    let _ = self.write_masked_frame(0xA, &data);
                    continue;
                }
                0xA => {
                    // Pong -> ignore
                    continue;
                }
                0x0 | 0x1 | 0x2 => {
                    assembled.extend_from_slice(&data);
                    if fin {
                        return Ok(assembled);
                    }
                }
                _ => {
                    if fin {
                        return Ok(assembled);
                    }
                }
            }
        }
    }

    fn update_telemetry_from_raw(&mut self, raw: &[u8], flags: u32) {
        self.last_telemetry_flags |= flags;
        let mut metrics = [0.0_f64; 6];
        if telemetry::extract_combat_metrics(raw, &mut metrics) {
            if metrics[0] >= 0.0 && metrics[0] <= 100.0 {
                self.last_boss_hp_pct = metrics[0];
            }
            if metrics[3] > self.last_honors {
                self.last_honors = metrics[3];
            }
            if metrics[4] >= 1.0 {
                self.last_turn = metrics[4];
            }
        }
    }

    /// Sends a CDP JSON-RPC command and awaits the matching `"id": rpc_id` response,
    /// using zero-allocation byte filtering to skip unrelated CDP events while still updating SIMD telemetry.
    pub fn call(&mut self, method: &str, params: Value, timeout_ms: u64) -> Result<Value, String> {
        let rpc_id = self.next_id();
        let req = json!({
            "id": rpc_id,
            "method": method,
            "params": params
        });
        self.send_json(&req)?;

        let deadline = Instant::now() + Duration::from_millis(timeout_ms.clamp(50, 30_000));
        loop {
            let now = Instant::now();
            if now >= deadline {
                return Err(format!("CDP call '{method}' (id={rpc_id}) timed out after {timeout_ms}ms"));
            }
            let rem_ms = deadline.duration_since(now).as_millis() as u64;
            let raw = self.read_message(rem_ms.max(25))?;

            match classify_raw_cdp_frame(&raw, None) {
                FrameClassification::RpcResponse => {
                    if let Ok(parsed) = serde_json::from_slice::<Value>(&raw) {
                        if parsed.get("id").and_then(|v| v.as_u64()) == Some(rpc_id as u64) {
                            if let Some(err) = parsed.get("error") {
                                return Err(format!("CDP '{method}' error: {err}"));
                            }
                            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
                        }
                    }
                }
                FrameClassification::CombatTelemetryEvent { flags } => {
                    self.update_telemetry_from_raw(&raw, flags);
                }
                FrameClassification::MatchedNetworkEvent | FrameClassification::IgnoredNoise => {}
            }
        }
    }

    /// Evaluates a JavaScript expression in the page context (`returnByValue: true, awaitPromise: true`).
    pub fn eval_js(&mut self, expression: &str, timeout_ms: u64) -> Result<Value, String> {
        let res = self.call(
            "Runtime.evaluate",
            json!({
                "expression": expression,
                "returnByValue": true,
                "awaitPromise": true
            }),
            timeout_ms,
        )?;
        Ok(res
            .get("result")
            .and_then(|r| r.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }

    /// Waits up to `timeout_ms` for a CDP network event whose payload contains `url_substring`
    /// (e.g. `"ability_result.json"`, `"normal_attack_result.json"`, `"summon_result.json"`).
    pub fn wait_for_network_substr(&mut self, url_substring: &str, timeout_ms: u64) -> bool {
        if url_substring.is_empty() {
            return true;
        }
        let deadline = Instant::now() + Duration::from_millis(timeout_ms.clamp(50, 15_000));
        while Instant::now() < deadline {
            let rem_ms = deadline
                .saturating_duration_since(Instant::now())
                .as_millis() as u64;
            let Ok(raw) = self.read_message(rem_ms.clamp(25, 500)) else {
                continue;
            };
            match classify_raw_cdp_frame(&raw, Some(url_substring)) {
                FrameClassification::MatchedNetworkEvent => {
                    let flags = telemetry::scan_payload_flags(&raw);
                    if flags != 0 {
                        self.update_telemetry_from_raw(&raw, flags);
                    }
                    return true;
                }
                FrameClassification::CombatTelemetryEvent { flags } => {
                    self.update_telemetry_from_raw(&raw, flags);
                }
                FrameClassification::RpcResponse | FrameClassification::IgnoredNoise => {}
            }
        }
        false
    }

    /// Dispatches a humanized `Input.dispatchTouchEvent` (`touchStart` + `touchEnd`) inside the given bounding box.
    pub fn dispatch_humanized_tap(
        &mut self,
        box_x: f64,
        box_y: f64,
        box_w: f64,
        box_h: f64,
    ) -> Result<(f64, f64), String> {
        let (tx, ty) = motor::sample_target_coordinate(box_x, box_y, box_w, box_h);
        let rx = (tx * 10.0).round() / 10.0;
        let ry = (ty * 10.0).round() / 10.0;

        self.call(
            "Input.dispatchTouchEvent",
            json!({
                "type": "touchStart",
                "touchPoints": [{
                    "x": rx,
                    "y": ry,
                    "radiusX": 4.0,
                    "radiusY": 4.0,
                    "force": 0.85
                }]
            }),
            1500,
        )?;
        self.call(
            "Input.dispatchTouchEvent",
            json!({
                "type": "touchEnd",
                "touchPoints": []
            }),
            1500,
        )?;
        Ok((rx, ry))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn test_classify_raw_cdp_frame_zero_alloc() {
        let rpc = br#"{"id":42,"result":{"result":{"type":"boolean","value":true}}}"#;
        assert_eq!(
            classify_raw_cdp_frame(rpc, None),
            FrameClassification::RpcResponse
        );

        let net_hit = br#"{"method":"Network.responseReceived","params":{"response":{"url":"https://game.granbluefantasy.jp/rest/multiraid/ability_result.json"}}}"#;
        assert_eq!(
            classify_raw_cdp_frame(net_hit, Some("ability_result.json")),
            FrameClassification::MatchedNetworkEvent
        );

        let noise = br#"{"method":"DOM.childNodeCountUpdated","params":{"nodeId":123,"childNodeCount":5}}"#;
        assert_eq!(
            classify_raw_cdp_frame(noise, Some("ability_result.json")),
            FrameClassification::IgnoredNoise
        );
    }

    #[test]
    fn test_mock_cdp_websocket_handshake_and_rpc_roundtrip() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let server_handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut req_buf = [0u8; 1024];
            let n = stream.read(&mut req_buf).unwrap();
            let req_str = String::from_utf8_lossy(&req_buf[..n]);
            assert!(req_str.contains("Upgrade: websocket"));

            let resp = "HTTP/1.1 101 Switching Protocols\r\n\
                        Upgrade: websocket\r\n\
                        Connection: Upgrade\r\n\
                        Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n";
            stream.write_all(resp.as_bytes()).unwrap();

            // Read 1 masked client frame
            let mut hdr = [0u8; 2];
            stream.read_exact(&mut hdr).unwrap();
            let len = (hdr[1] & 0x7F) as usize;
            let mut mask = [0u8; 4];
            stream.read_exact(&mut mask).unwrap();
            let mut payload = vec![0u8; len];
            stream.read_exact(&mut payload).unwrap();
            for (i, b) in payload.iter_mut().enumerate() {
                *b ^= mask[i & 3];
            }

            let client_json: Value = serde_json::from_slice(&payload).unwrap();
            let rpc_id = client_json["id"].as_u64().unwrap();

            // First send a noisy DOM event (should be ignored by zero-alloc filter)
            let noise_msg = br#"{"method":"DOM.documentUpdated","params":{}}"#;
            let mut noise_frame = vec![0x81, noise_msg.len() as u8];
            noise_frame.extend_from_slice(noise_msg);
            stream.write_all(&noise_frame).unwrap();

            // Then send the actual RPC response
            let reply = json!({
                "id": rpc_id,
                "result": {
                    "result": {
                        "type": "string",
                        "value": "#raid_multi/42337095880"
                    }
                }
            });
            let reply_bytes = serde_json::to_vec(&reply).unwrap();
            let mut reply_frame = vec![0x81, reply_bytes.len() as u8];
            reply_frame.extend_from_slice(&reply_bytes);
            stream.write_all(&reply_frame).unwrap();
        });

        let mut client = CdpWsClient::connect(port, "/devtools/page/mock1", 2000).unwrap();
        let val = client.eval_js("window.location.hash", 2000).unwrap();
        assert_eq!(val.as_str().unwrap(), "#raid_multi/42337095880");

        server_handle.join().unwrap();
    }
}
