//! Native-messaging host: streams Firefox's own audio output to the extension.
//!
//! DRM-protected videos (Netflix, Disney+, Prime) can't be captured from the page:
//! mozCaptureStream() on an encrypted <video> yields silence. The decoded audio
//! still reaches the OS mixer on its way to the speakers, so this host records it
//! there (PipeWire on Linux, WASAPI on Windows) and sends it back as 16 kHz mono
//! Int16 PCM.
//!
//! Firefox starts it (see register.rs) and talks over stdin/stdout:
//!
//!   extension -> host  {"type": "hello"}
//!                      {"type": "start", "source": "tab" | "system", "title": "..."}
//!                      {"type": "title", "title": "..."}
//!   host -> extension  {"type": "hello", "version": "x.y.z", "os": "linux" | "windows"}
//!                      {"type": "audio", "pcm": base64, "t": ms since epoch when the chunk ended}
//!                      {"type": "status", "message": "..."}
//!                      {"type": "error", "message": "..."}
//!
//! "hello" lets the settings page check that the companion is installed and which
//! version it is; it starts nothing. "tab" records Firefox's own audio, "system" everything the default output plays.

mod messaging;
mod register;

#[cfg(target_os = "linux")]
#[path = "pipewire.rs"]
mod capture;
#[cfg(windows)]
#[path = "wasapi.rs"]
mod capture;
#[cfg(not(any(target_os = "linux", windows)))]
compile_error!("The companion supports Linux and Windows.");

use std::io::{self, IsTerminal};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::{env, thread};

pub const SAMPLE_RATE: u32 = 16000;
/// 100 ms of mono Int16.
pub const CHUNK_BYTES: usize = SAMPLE_RATE as usize / 10 * 2;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Tab,
    System,
}

/// Shared between the message loop and the capture thread.
pub struct State {
    /// The tab's page title, which names its audio stream on Linux.
    pub title: Mutex<String>,
    pub stopped: AtomicBool,
}

const USAGE: &str = "Captions companion: records Firefox's audio for the Captions extension.

Usage:
  captions-companion install     copy to a per-user folder and register with Firefox
  captions-companion uninstall   undo install
  captions-companion --version

Firefox starts it by itself once it's installed.";

fn main() -> ExitCode {
    let arg = env::args().nth(1);
    match arg.as_deref() {
        Some("install") => report(register::install()),
        Some("uninstall") => report(register::uninstall()),
        Some("--version" | "-V") => {
            println!("captions-companion {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        // Firefox runs it with pipes and passes the manifest path and extension id.
        _ if !io::stdin().is_terminal() => {
            host();
            ExitCode::SUCCESS
        }
        // Double-clicked in Explorer: install, and keep the window open to say so.
        #[cfg(windows)]
        None => {
            let code = report(register::install());
            println!("\nPress Enter to close.");
            let _ = io::stdin().read_line(&mut String::new());
            code
        }
        Some("--help" | "-h" | "help") => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("{USAGE}");
            ExitCode::FAILURE
        }
    }
}

fn report(result: Result<String, String>) -> ExitCode {
    match result {
        Ok(message) => {
            println!("{message}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("Error: {message}");
            ExitCode::FAILURE
        }
    }
}

/// The reply to "hello": what the settings page shows about the installed companion.
fn hello() -> serde_json::Value {
    serde_json::json!({ "type": "hello", "version": env!("CARGO_PKG_VERSION"), "os": env::consts::OS })
}

fn host() {
    let state = Arc::new(State { title: Mutex::new(String::new()), stopped: AtomicBool::new(false) });
    let mut worker = None;
    while let Some(msg) = messaging::receive() {
        let title = msg["title"].as_str().unwrap_or_default().to_string();
        match msg["type"].as_str() {
            Some("start") if worker.is_none() => {
                *state.title.lock().unwrap() = title;
                let source = if msg["source"] == "system" { Source::System } else { Source::Tab };
                let state = state.clone();
                worker = Some(thread::spawn(move || capture::run(source, &state)));
            }
            Some("hello") => messaging::send(&hello()),
            Some("title") => *state.title.lock().unwrap() = title,
            _ => {}
        }
    }
    // Firefox closed the port: stop recording before exiting, so no recorder outlives us.
    state.stopped.store(true, Ordering::Relaxed);
    if let Some(worker) = worker {
        let _ = worker.join();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_reports_version_and_os() {
        let reply = hello();
        assert_eq!(reply["type"], "hello");
        assert_eq!(reply["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(reply["os"], env::consts::OS);
    }
}
