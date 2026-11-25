# Privacy policy — Captions

*Last updated: 2026-11-25*

Captions shows live captions for videos by sending their audio to a speech-to-text
service **that you choose and configure**. It has no server of its own and
collects nothing for its developer.

## What is processed, and where it goes

- **Video audio.** Only while you have captions turned on, on the tab where you
  turned them on, the extension sends that video's audio (16 kHz mono) to the
  provider selected in the settings:
  - **Deepgram (cloud)**: sent to `api.deepgram.com` with your own API key.
    Deepgram's handling of it is governed by
    [Deepgram's privacy policy](https://deepgram.com/privacy) and your account
    with them.
  - **Local server**: sent to the address you enter (by default `localhost`,
    your own computer).
  - **Test signal**: not sent anywhere; it only measures the volume.
- **Transcripts** come back from that provider and are shown on the page. They
  are kept in memory for the current page only, so rewinding replays them, and
  are discarded when the page closes.
- **Settings and API keys** are saved in the browser's extension storage
  (`storage.local`), on your device only. They are not synced or sent anywhere,
  except the API key, which goes to the provider it belongs to.

## The system-audio companion

The optional companion app (for DRM-protected videos) runs on your computer. It
records Firefox's sound output only while captions are on and hands it to the
extension, which treats it like any other audio above. It makes no network
connections.

## What is not collected

No analytics, telemetry, browsing history, identifiers or advertising. Page
content other than the audio of the video you caption is not read or sent.

## Contact

Questions: open an issue at <https://github.com/Josueccc/captions/issues>.
