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

## Install

- **Extension**: from addons.mozilla.org (Firefox 140 or later, desktop).
- **Companion app**, only for DRM-protected sites (Netflix, Disney+, Prime
  Video…): from the [latest release](https://github.com/Josueccc/captions/releases/latest).
  Windows 10/11 installer, or a Linux tarball (PipeWire); see
  [companion/README.md](companion/README.md). The extension's settings page
  shows whether it's installed and links to the right download.

To install a build of your own permanently instead, sign it privately
(unlisted) with AMO API credentials
(<https://addons.mozilla.org/developers/addon/api/key/>):

```sh
export WEB_EXT_API_KEY=user:12345:67   # JWT issuer
export WEB_EXT_API_SECRET=...          # JWT secret
npm run sign
```

and install the `.xpi` from `artifacts/` via `about:addons` → gear → Install
Add-on From File. Bump `version` in `src/manifest.json` first: AMO rejects a
version it has already signed.

## Use

1. Open the extension's settings, pick the audio language and a provider, and
   use **Test connection** to check it:
   - **Deepgram (cloud)**: fastest (~0.6 s behind the audio); needs an API key.
   - **Local server (WhisperLiveKit)**: Whisper on your own GPU/CPU, free and
     private but slower (1–4 s). See [server/README.md](server/README.md).
2. For DRM-protected sites (Netflix, Disney+, Prime), install the system-audio
   companion app once (see *Install*), or build it from source with
   `./companion/install.sh`. It's used automatically for videos with DRM; the
   settings page shows its status and the popup links to it when it's missing.
3. On a page with a video, click the toolbar icon → **Start captions**, or press
   **Alt+Shift+C**.

Use the **Test signal** provider to check that audio capture works on a site
without spending API credit: it shows the loudness instead of text. Reading a
DRM video from the page gives nothing; the companion route does.

## Release

1. Bump the version in `src/manifest.json`, `package.json` and
   `companion/Cargo.toml` (CI checks the three match the tag), and commit.
2. Push a `vX.Y.Z` tag. CI (`.github/workflows/build.yml`) builds the companion
   for Linux and Windows and creates a draft GitHub release with it and the
   notes in `.github/release-notes.md`.
3. Publish the draft. The extension links to
   `releases/latest/download/<asset>`, so asset names carry no version.
4. Submit the extension to addons.mozilla.org with `npm run submit`; see
   [amo/README.md](amo/README.md).

## Translations

UI strings are in `src/_locales/<lang>/messages.json` (English and Spanish), read
with `t()` from `src/shared/i18n.ts`; static markup uses `data-i18n="key"`. Firefox
picks the browser's language and falls back to English.

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
e2e/.venv/bin/python e2e/harness.py --audio-source tab   # through the companion
```

To keep the test browser quiet, send it to a null sink:
`pactl load-module module-null-sink sink_name=captions_test` and run the harness
with `PULSE_SINK=captions_test`.

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
│ CaptionStore (per video) │ ◄──────── │                    │segments│              │
│ Overlay (shadow DOM)     │  segments │  Companion ◄───────┼─ native messaging ─┐   │
└──────────────────────────┘           └────────────────────┘        └──────────│───┘
   DRM videos: no AudioCapture; the content script sends            companion/ (Rust): PipeWire
   clock marks (currentTime, rate, playing) instead                 or WASAPI loopback
```

- `src/providers/` — each provider implements `Transcriber` (`types.ts`) and is
  listed in `registry.ts`; its `fields` drive the options form automatically.
  `deepgram-stream.ts` speaks the Deepgram live protocol, which both Deepgram
  and the local WhisperLiveKit server use.
- The manifest sets its own CSP: MV3's default adds `upgrade-insecure-requests`,
  which silently turns `ws://localhost` into `wss://` and breaks the local server.
- DRM videos take the *system* route: the companion records Firefox's output
  (PipeWire on Linux, WASAPI on Windows) and the background places each chunk on the video timeline
  from its arrival time and the latest clock mark. The page's `<video>` is never
  touched there, since `mozCaptureStream()` would take its audio off the speakers.
- Providers report times in *stream* seconds; `MediaClock` maps them to
  `video.currentTime` using the media time + playback rate attached to every
  audio chunk, so seeking, pausing and slow playback keep captions in sync, and
  rewinding replays cached lines.

## License

[GPL-3.0-or-later](LICENSE): you may use, change and share this code, and
versions you distribute must stay under the same license with their source.
