//! Linux: each Firefox tab that plays sound is a PipeWire output stream named
//! after the page title. pw-record records the tab's stream ("tab"), or the
//! default sink's monitor ("system"), as 16 kHz mono Int16.

use crate::{CHUNK_BYTES, SAMPLE_RATE, Source, State, messaging};
use serde_json::Value;
use std::env;
use std::io::Read;
use std::os::unix::process::ExitStatusExt;
use std::path::Path;
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const POLL: Duration = Duration::from_secs(1);
/// Firefox names a tab's stream after the page, except for DRM audio, which plays
/// through a generic "AudioStream".
const UNTITLED: [&str; 2] = ["", "AudioStream"];

/// The PipeWire tools the companion runs.
pub fn check_requirements() -> Result<(), String> {
    for tool in ["pw-record", "pw-dump"] {
        let found = env::var_os("PATH")
            .is_some_and(|path| env::split_paths(&path).any(|dir| Path::new(&dir).join(tool).is_file()));
        if !found {
            return Err(format!("{tool} not found: the companion needs PipeWire (pipewire-tools/pipewire-bin)."));
        }
    }
    Ok(())
}

pub fn run(source: Source, state: &State) {
    if let Err(message) = check_requirements() {
        messaging::error(&message);
        return;
    }
    let mut recorder = Recorder::default();
    let mut current: Option<String> = None; // serial of the stream we're recording in tab mode
    let mut waiting_reported = false;
    while !state.stopped.load(Ordering::Relaxed) {
        let objects = pw_dump();
        match source {
            Source::System => {
                if let Some(sink) = default_sink(&objects)
                    && (recorder.target.as_deref() != Some(sink.as_str()) || !recorder.alive())
                {
                    recorder.start(&sink, true);
                    messaging::status("Capturing all system audio");
                }
            }
            Source::Tab => {
                let streams = firefox_streams(&objects, &std::os::unix::process::parent_id().to_string());
                let title = state.title.lock().unwrap().clone();
                let best = streams.iter().max_by_key(|s| (score(s, &title), s.id));
                let playing = streams.iter().find(|s| current.as_ref() == Some(&s.serial));
                if let Some(best) = best {
                    let switch = match playing {
                        Some(playing) => !recorder.alive() || score(best, &title) > score(playing, &title),
                        None => true,
                    };
                    if switch {
                        current = Some(best.serial.clone());
                        recorder.start(&best.serial, false);
                        waiting_reported = false;
                        messaging::status(&format!("Capturing Firefox audio: {}", best.title));
                    }
                } else if !waiting_reported {
                    recorder.stop();
                    current = None;
                    waiting_reported = true;
                    messaging::status("Waiting for the tab to play audio…");
                }
            }
        }
        thread::sleep(POLL);
    }
}

fn pw_dump() -> Vec<Value> {
    Command::new("pw-dump")
        .stderr(Stdio::null())
        .output()
        .ok()
        .and_then(|out| serde_json::from_slice(&out.stdout).ok())
        .and_then(|dump: Value| match dump {
            Value::Array(objects) => Some(objects),
            _ => None,
        })
        .unwrap_or_default()
}

/// A string, or a number written as one (serials and PIDs are numbers in pw-dump).
fn text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn default_sink(objects: &[Value]) -> Option<String> {
    objects
        .iter()
        .filter(|o| o["type"] == "PipeWire:Interface:Metadata" && o["props"]["metadata.name"] == "default")
        .flat_map(|o| o["metadata"].as_array().into_iter().flatten())
        .find(|entry| entry["key"] == "default.audio.sink")
        .and_then(|entry| entry["value"]["name"].as_str().map(String::from))
}

#[derive(Debug, Clone)]
struct Stream {
    id: u64,
    serial: String,
    title: String,
    running: bool,
}

/// Firefox playback streams, limited to the Firefox that started us (`parent_pid`) when we can tell.
fn firefox_streams(objects: &[Value], parent_pid: &str) -> Vec<Stream> {
    let mut ours = Vec::new();
    let mut all = Vec::new();
    for obj in objects {
        let info = &obj["info"];
        let props = &info["props"];
        if props["media.class"] != "Stream/Output/Audio" {
            continue;
        }
        let binary = text(&props["application.process.binary"]).to_lowercase();
        let name = text(&props["application.name"]).to_lowercase();
        if !(binary.contains("firefox") || name.contains("firefox") || binary.contains("librewolf")) {
            continue;
        }
        let id = obj["id"].as_u64().unwrap_or(0);
        let serial = match text(&props["object.serial"]) {
            s if s.is_empty() => id.to_string(),
            s => s,
        };
        let stream = Stream { id, serial, title: text(&props["media.name"]), running: info["state"] == "running" };
        if text(&props["application.process.id"]) == parent_pid {
            ours.push(stream.clone());
        }
        all.push(stream);
    }
    // PIDs don't match inside a sandbox (Flatpak/Snap); fall back to every Firefox.
    if ours.is_empty() { all } else { ours }
}

/// A stream titled like the tab first, then an untitled (DRM) one; a stream named
/// after another page isn't ours. Ties go to the one that's playing.
fn score(stream: &Stream, title: &str) -> (u8, bool) {
    let named = if !title.is_empty() && stream.title == title {
        2
    } else if UNTITLED.contains(&stream.title.as_str()) {
        1
    } else {
        0
    };
    (named, stream.running)
}

/// One pw-record process; restarted whenever the target changes.
#[derive(Default)]
struct Recorder {
    child: Option<Arc<Mutex<Child>>>,
    target: Option<String>,
}

impl Recorder {
    fn start(&mut self, target: &str, capture_sink: bool) {
        self.stop();
        let props = format!(
            "{{ node.name = \"auris-companion\" node.dont-reconnect = true node.dont-fallback = true{} }}",
            if capture_sink { " stream.capture.sink = true" } else { "" }
        );
        let rate = SAMPLE_RATE.to_string();
        let spawned = Command::new("pw-record")
            .args(["--raw", "--format", "s16", "--rate", &rate, "--channels", "1", "--latency", "20ms"])
            .args(["--target", target, "-P", &props, "-"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(err) => {
                messaging::error(&format!("Could not start pw-record: {err}"));
                return;
            }
        };
        let (stdout, stderr) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
        let child = Arc::new(Mutex::new(child));
        self.child = Some(child.clone());
        self.target = Some(target.to_string());
        thread::spawn(move || pump(&child, stdout, stderr));
    }

    fn alive(&self) -> bool {
        self.child.as_ref().is_some_and(|child| matches!(child.lock().unwrap().try_wait(), Ok(None)))
    }

    fn stop(&mut self) {
        if let Some(child) = self.child.take() {
            let mut child = child.lock().unwrap();
            let _ = child.kill();
            let _ = child.wait();
        }
        self.target = None;
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.stop();
    }
}

fn pump(child: &Mutex<Child>, mut stdout: ChildStdout, mut stderr: ChildStderr) {
    let mut chunk = [0; CHUNK_BYTES];
    while stdout.read_exact(&mut chunk).is_ok() {
        messaging::audio(&chunk, messaging::now_ms());
    }
    let mut err = String::new();
    let _ = stderr.read_to_string(&mut err);
    // Killed by stop(): nothing to report. A clean exit means the stream went away,
    // and run() picks the next one.
    if let Ok(status) = child.lock().unwrap().wait()
        && !status.success()
        && status.signal().is_none()
    {
        let err = err.trim();
        messaging::error(&format!(
            "pw-record failed: {}",
            if err.is_empty() { status.to_string() } else { err.to_string() }
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stream_obj(id: u64, serial: u64, title: &str, pid: u64, state: &str) -> Value {
        json!({
            "id": id,
            "type": "PipeWire:Interface:Node",
            "info": {
                "state": state,
                "props": {
                    "media.class": "Stream/Output/Audio",
                    "application.name": "Firefox",
                    "application.process.binary": "firefox",
                    "application.process.id": pid,
                    "media.name": title,
                    "object.serial": serial,
                }
            }
        })
    }

    fn best(objects: &[Value], title: &str) -> String {
        let streams = firefox_streams(objects, "1880");
        streams.iter().max_by_key(|s| (score(s, title), s.id)).unwrap().serial.clone()
    }

    #[test]
    fn prefers_the_stream_titled_like_the_tab() {
        let objects = [
            stream_obj(86, 28941, "Some video - YouTube", 1880, "running"),
            stream_obj(74, 29414, "AudioStream", 1880, "running"),
        ];
        assert_eq!(best(&objects, "Some video - YouTube"), "28941");
    }

    #[test]
    fn drm_tab_gets_the_untitled_stream_over_another_tabs() {
        // Netflix's stream isn't named after the page; a paused YouTube tab still has one.
        let objects = [
            stream_obj(86, 28941, "Some video - YouTube", 1880, "running"),
            stream_obj(74, 29414, "AudioStream", 1880, "running"),
        ];
        assert_eq!(best(&objects, "Netflix"), "29414");
    }

    #[test]
    fn keeps_to_the_firefox_that_started_us() {
        let objects =
            [stream_obj(90, 1, "AudioStream", 999, "running"), stream_obj(74, 2, "AudioStream", 1880, "idle")];
        assert_eq!(best(&objects, "Netflix"), "2");
        // Sandboxed Firefox: no PID matches, so every Firefox stream is a candidate.
        assert_eq!(firefox_streams(&objects, "4242").len(), 2);
    }

    #[test]
    fn ignores_other_apps_and_capture_streams() {
        let mut other = stream_obj(5, 5, "Music", 1880, "running");
        other["info"]["props"]["application.name"] = json!("Spotify");
        other["info"]["props"]["application.process.binary"] = json!("spotify");
        let mut input = stream_obj(6, 6, "mic", 1880, "running");
        input["info"]["props"]["media.class"] = json!("Stream/Input/Audio");
        assert!(firefox_streams(&[other, input], "1880").is_empty());
    }

    #[test]
    fn finds_the_default_sink() {
        let objects = [json!({
            "type": "PipeWire:Interface:Metadata",
            "props": { "metadata.name": "default" },
            "metadata": [
                { "key": "default.audio.source", "value": { "name": "mic" } },
                { "key": "default.audio.sink", "value": { "name": "alsa_output.speakers" } },
            ]
        })];
        assert_eq!(default_sink(&objects).as_deref(), Some("alsa_output.speakers"));
    }
}
