#!/usr/bin/env python3
"""Native-messaging host: streams Firefox's own audio output to the extension.

DRM-protected videos (Netflix, Disney+, Prime) can't be captured from the page:
mozCaptureStream() on an encrypted <video> yields silence. The decoded audio
still reaches PipeWire on its way to the speakers, so this host records it
there with pw-record and sends it back as 16 kHz mono Int16 PCM.

Firefox starts it (see install.sh) and talks over stdin/stdout:

  extension -> host  {"type": "start", "source": "tab" | "system", "title": "..."}
                     {"type": "title", "title": "..."}
  host -> extension  {"type": "audio", "pcm": base64, "t": ms since epoch when the chunk ended}
                     {"type": "status", "message": "..."}
                     {"type": "error", "message": "..."}

"tab" records the Firefox playback stream of the tab (PipeWire names each one
after the page title), "system" records everything the default output plays.
Only Python's standard library is used.
"""
import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import threading
import time

SAMPLE_RATE = 16000
CHUNK_BYTES = SAMPLE_RATE // 10 * 2  # 100 ms of Int16
POLL_SECONDS = 1.0
UNTITLED = {'', 'AudioStream'}

out_lock = threading.Lock()


def send(message):
    data = json.dumps(message).encode()
    with out_lock:
        sys.stdout.buffer.write(struct.pack('=I', len(data)) + data)
        sys.stdout.buffer.flush()


def receive():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack('=I', header)
    return json.loads(sys.stdin.buffer.read(length))


def pw_dump():
    try:
        return json.loads(subprocess.run(['pw-dump'], capture_output=True, check=True, timeout=5).stdout)
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError):
        return []


def default_sink(objects):
    for obj in objects:
        if obj.get('type') == 'PipeWire:Interface:Metadata' and (obj.get('props') or {}).get('metadata.name') == 'default':
            for entry in obj.get('metadata') or []:
                if entry.get('key') == 'default.audio.sink':
                    value = entry.get('value')
                    return value.get('name') if isinstance(value, dict) else None
    return None


def firefox_streams(objects):
    """Firefox playback streams, limited to the Firefox that started us when we can tell."""
    streams = []
    for obj in objects:
        info = obj.get('info') or {}
        props = info.get('props') or {}
        if props.get('media.class') != 'Stream/Output/Audio':
            continue
        binary = (props.get('application.process.binary') or '').lower()
        name = (props.get('application.name') or '').lower()
        if 'firefox' in binary or 'firefox' in name or 'librewolf' in binary:
            streams.append({
                'id': obj.get('id', 0),
                'serial': str(props.get('object.serial', obj.get('id'))),
                'pid': str(props.get('application.process.id', '')),
                'title': props.get('media.name') or '',
                'running': info.get('state') == 'running',
            })
    ours = [s for s in streams if s['pid'] == str(os.getppid())]
    # PIDs don't match inside a sandbox (Flatpak/Snap); fall back to every Firefox.
    return ours or streams


def score(stream, title):
    # Firefox names a tab's stream after the page, except for DRM audio, which plays
    # through a generic "AudioStream". A stream named after another page isn't ours.
    if title and stream['title'] == title:
        named = 2
    elif stream['title'] in UNTITLED:
        named = 1
    else:
        named = 0
    return (named, stream['running'])


class Recorder:
    """One pw-record process; restarted whenever the target changes."""

    def __init__(self):
        self.proc = None
        self.target = None

    def start(self, target, capture_sink):
        self.stop()
        cmd = ['pw-record', '--raw', '--format', 's16', '--rate', str(SAMPLE_RATE), '--channels', '1',
               '--latency', '20ms', '--target', target,
               '-P', '{ node.name = "captions-companion" node.dont-reconnect = true node.dont-fallback = true'
               + (' stream.capture.sink = true' if capture_sink else '') + ' }',
               '-']
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.target = target
        threading.Thread(target=self.pump, args=(self.proc,), daemon=True).start()

    def pump(self, proc):
        while True:
            chunk = proc.stdout.read(CHUNK_BYTES)
            if not chunk:
                break
            send({'type': 'audio', 'pcm': base64.b64encode(chunk).decode(), 't': time.time() * 1000})
        err = proc.stderr.read().decode(errors='replace').strip()
        if proc is self.proc and proc.wait() not in (0, -15):
            send({'type': 'error', 'message': f'pw-record failed: {err or proc.returncode}'})

    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self.proc = None
        self.target = None


def run(source, state):
    recorder = Recorder()
    current = None  # stream we're recording in tab mode
    waiting_reported = False
    try:
        while not state['stopped']:
            objects = pw_dump()
            if source == 'system':
                sink = default_sink(objects)
                if sink and (sink != recorder.target or not recorder.alive()):
                    recorder.start(sink, capture_sink=True)
                    send({'type': 'status', 'message': 'Capturing all system audio'})
            else:
                streams = firefox_streams(objects)
                title = state['title']
                best = max(streams, key=lambda s: (score(s, title), s['id']), default=None)
                current = next((s for s in streams if current and s['serial'] == current['serial']), None)
                switch = best and (current is None or not recorder.alive() or score(best, title) > score(current, title))
                if switch:
                    current = best
                    recorder.start(best['serial'], capture_sink=False)
                    waiting_reported = False
                    send({'type': 'status', 'message': f'Capturing Firefox audio: {best["title"]}'})
                elif not streams and not waiting_reported:
                    recorder.stop()
                    current = None
                    waiting_reported = True
                    send({'type': 'status', 'message': 'Waiting for the tab to play audio…'})
            time.sleep(POLL_SECONDS)
    finally:
        recorder.stop()


def main():
    if not shutil.which('pw-record') or not shutil.which('pw-dump'):
        send({'type': 'error', 'message': 'pw-record/pw-dump not found: the companion needs PipeWire.'})
        return
    state = {'title': '', 'stopped': False}
    worker = None
    while True:
        msg = receive()
        if msg is None:  # Firefox closed the port.
            break
        if msg.get('type') == 'start' and worker is None:
            state['title'] = msg.get('title') or ''
            source = 'system' if msg.get('source') == 'system' else 'tab'
            worker = threading.Thread(target=run, args=(source, state), daemon=True)
            worker.start()
        elif msg.get('type') == 'title':
            state['title'] = msg.get('title') or ''
    state['stopped'] = True
    if worker:
        worker.join(timeout=POLL_SECONDS * 2)


if __name__ == '__main__':
    main()
