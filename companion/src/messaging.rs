//! Firefox's native-messaging framing: each message is a native-endian u32
//! length followed by that many bytes of JSON, on stdin and stdout.

use base64::prelude::{BASE64_STANDARD, Engine};
use serde_json::{Value, json};
use std::io::{self, Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

/// Writes one message. Stdout's lock keeps messages from different threads whole.
pub fn send(message: &Value) {
    let data = message.to_string();
    let mut out = io::stdout().lock();
    // If Firefox is gone there's nobody to tell; the read loop ends on its own.
    let _ = out
        .write_all(&(data.len() as u32).to_ne_bytes())
        .and_then(|()| out.write_all(data.as_bytes()))
        .and_then(|()| out.flush());
}

/// The next message, or None once Firefox has closed the port.
pub fn receive() -> Option<Value> {
    let mut input = io::stdin().lock();
    let mut header = [0; 4];
    input.read_exact(&mut header).ok()?;
    let mut body = vec![0; u32::from_ne_bytes(header) as usize];
    input.read_exact(&mut body).ok()?;
    Some(serde_json::from_slice(&body).unwrap_or(Value::Null))
}

/// Wall-clock milliseconds since the epoch, the timeline the extension places audio on.
pub fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// `pcm`: 16 kHz mono Int16 little-endian. `ended_at`: when its last sample was recorded.
pub fn audio(pcm: &[u8], ended_at: f64) {
    send(&json!({ "type": "audio", "pcm": BASE64_STANDARD.encode(pcm), "t": ended_at }));
}

pub fn status(message: &str) {
    send(&json!({ "type": "status", "message": message }));
}

pub fn error(message: &str) {
    send(&json!({ "type": "error", "message": message }));
}
