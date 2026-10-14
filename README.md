# Captions

Firefox extension that shows live captions transcribed from the video's actual
audio, so the text matches what's said word for word (unlike platform subtitles,
which are often translated separately from a dub).

## Develop

```sh
npm install
npm run watch      # rebuild into dist/ on change
npm run dev        # in another terminal: launches Firefox with the extension, auto-reloads
npm run typecheck
npm run lint
```

Or load it manually: `about:debugging` → This Firefox → Load Temporary Add-on →
`dist/manifest.json`.

## Use

1. Open the extension's settings, pick the audio language and a provider:
   - **Deepgram (cloud)**: fastest (~0.6 s behind the audio); needs an API key.
   - **Local server (WhisperLiveKit)**: Whisper on your own GPU/CPU, free and
     private but slower (1–4 s). See [server/README.md](server/README.md).
2. On a page with a video, click the toolbar icon → **Start captions**, or press
   **Alt+Shift+C**.

Use the **Test signal** provider to check that audio capture works on a site
without spending API credit: it shows the loudness instead of text. DRM sites
(Netflix, Disney+, Prime) give silence; they'll need the system-audio companion.

## End-to-end harness

`e2e/harness.py` drives headless Firefox with `dist/` loaded: it starts captions
on a page, prints the caption text and measured latency as they change, and
saves screenshots to `e2e/shots/`.

```sh
python3 -m venv e2e/.venv && e2e/.venv/bin/pip install -r e2e/requirements.txt
./e2e/make-test-video.sh                 # local test video (needs ffmpeg)
npm run build
e2e/.venv/bin/python e2e/harness.py      # test-signal provider on the local video
e2e/.venv/bin/python e2e/harness.py --provider deepgram --lang fr --seconds 60 \
  --url 'https://www.youtube.com/watch?v=...'
./e2e/download-clips.sh                  # speech clips, for repeatable comparisons
e2e/.venv/bin/python e2e/harness.py --provider local-server --lang fr --seconds 45 \
  --url 'http://127.0.0.1:8765/index.html?src=fr.webm'
```

Deepgram runs read `DEEPGRAM_API_KEY` from the environment or `e2e/.env`
(gitignored). The **Show caption latency** setting (forced on by the harness)
reports how long after a word is spoken it first appears on screen.

## Architecture

```
content script (per tab)                    background                    provider
┌──────────────────────────┐   port    ┌────────────────────┐        ┌──────────────┐
│ AudioCapture             │ ────────► │ Session            │ ─────► │ Deepgram WS  │
│  mozCaptureStream →      │  audio +  │  MediaClock:       │  PCM   │ WhisperLive- │
│  worklet → 16k Int16     │  mediaTime│  stream → video t  │ ◄───── │  Kit (local) │
│ CaptionStore (per video) │ ◄──────── │                    │segments│ companion …  │
│ Overlay (shadow DOM)     │  segments └────────────────────┘        └──────────────┘
└──────────────────────────┘
```

- `src/providers/` — each provider implements `Transcriber` (`types.ts`) and is
  listed in `registry.ts`; its `fields` drive the options form automatically.
  `deepgram-stream.ts` speaks the Deepgram live protocol, which both Deepgram
  and the local WhisperLiveKit server use.
- The manifest sets its own CSP: MV3's default adds `upgrade-insecure-requests`,
  which silently turns `ws://localhost` into `wss://` and breaks the local server.
- Providers report times in *stream* seconds; `MediaClock` maps them to
  `video.currentTime` using the media time + playback rate attached to every
  audio chunk, so seeking, pausing and slow playback keep captions in sync, and
  rewinding replays cached lines.
