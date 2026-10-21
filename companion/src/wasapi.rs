//! Windows: WASAPI loopback. "tab" uses process loopback on the Firefox that
//! started us, which hears all of that Firefox's tabs but nothing else; it
//! needs Windows 10 build 20348 or later, so older systems fall back to the
//! default output's loopback ("system"). WASAPI converts to 16 kHz mono Int16.

use crate::{CHUNK_BYTES, SAMPLE_RATE, Source, State, messaging};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use wasapi::{AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat, initialize_mta};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};

/// How long to wait for audio before checking whether we've been stopped.
const WAIT_MS: u32 = 250;
const BYTES_PER_MS: f64 = SAMPLE_RATE as f64 * 2.0 / 1000.0;

pub fn run(source: Source, state: &State) {
    if let Err(err) = initialize_mta().ok() {
        messaging::error(&format!("Could not initialise audio: {err}"));
        return;
    }
    let mut source = source;
    while !state.stopped.load(Ordering::Relaxed) {
        match open(source) {
            Ok((client, label)) => {
                messaging::status(label);
                if let Err(err) = record(&client, state) {
                    // Usually the output device changed; open the new one.
                    messaging::status(&format!("Audio capture interrupted ({err}), restarting"));
                    thread::sleep(Duration::from_secs(1));
                }
            }
            Err(err) if source == Source::Tab => {
                messaging::status(&format!("Can't capture Firefox alone ({err}); capturing all system audio instead"));
                source = Source::System;
            }
            Err(err) => {
                messaging::error(&format!("Could not capture system audio: {err}"));
                return;
            }
        }
    }
}

fn open(source: Source) -> Result<(AudioClient, &'static str), String> {
    let format = WaveFormat::new(16, 16, &SampleType::Int, SAMPLE_RATE as usize, 1, None);
    // autoconvert lets WASAPI resample and downmix to our format.
    let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 200_000 };
    let (mut client, label) = match source {
        Source::Tab => {
            let pid = firefox_pid().ok_or("Firefox's process not found")?;
            let client = AudioClient::new_application_loopback_client(pid, true).map_err(|e| e.to_string())?;
            (client, "Capturing Firefox audio")
        }
        Source::System => {
            let device = DeviceEnumerator::new()
                .and_then(|devices| devices.get_default_device(&Direction::Render))
                .map_err(|e| e.to_string())?;
            (device.get_iaudioclient().map_err(|e| e.to_string())?, "Capturing all system audio")
        }
    };
    client.initialize_client(&format, &Direction::Capture, &mode).map_err(|e| e.to_string())?;
    Ok((client, label))
}

fn record(client: &AudioClient, state: &State) -> Result<(), wasapi::WasapiError> {
    let event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;
    let mut queue = VecDeque::new();
    client.start_stream()?;
    while !state.stopped.load(Ordering::Relaxed) {
        // A timeout only means nothing is playing.
        let _ = event.wait_for_event(WAIT_MS);
        while capture.get_next_packet_size()?.unwrap_or(0) > 0 {
            let before = queue.len();
            let info = capture.read_from_device_to_deque(&mut queue)?;
            if info.flags.silent {
                queue.range_mut(before..).for_each(|byte| *byte = 0);
            }
        }
        // Packets can bunch up; date each chunk by how much audio is still queued behind it.
        let now = messaging::now_ms();
        while queue.len() >= CHUNK_BYTES {
            let chunk: Vec<u8> = queue.drain(..CHUNK_BYTES).collect();
            messaging::audio(&chunk, now - queue.len() as f64 / BYTES_PER_MS);
        }
    }
    client.stop_stream()?;
    Ok(())
}

/// The Firefox that started us: our parent, unless something like cmd.exe sits in between.
/// Process loopback with the tree included then covers its content and media processes.
fn firefox_pid() -> Option<u32> {
    let processes = processes();
    let mut pid = processes.get(&std::process::id())?.0;
    while let Some((parent, name)) = processes.get(&pid)
        && name.eq_ignore_ascii_case("cmd.exe")
    {
        pid = *parent;
    }
    Some(pid)
}

/// pid -> (parent pid, executable name)
fn processes() -> HashMap<u32, (u32, String)> {
    let mut processes = HashMap::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return processes;
        };
        let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut more = Process32FirstW(snapshot, &mut entry).is_ok();
        while more {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            processes.insert(entry.th32ProcessID, (entry.th32ParentProcessID, name));
            more = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
    }
    processes
}
