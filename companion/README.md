# System-audio companion

DRM-protected videos (Netflix, Disney+, Prime…) can't be captured from the page:
Firefox's `mozCaptureStream()` returns silence for encrypted media. The decoded
audio still goes through PipeWire on its way to the speakers, so this
native-messaging host records it there and streams it to the extension.
It only reads the sound output, like the OS-level live captions do; it doesn't
touch the video or its decryption.

```sh
./companion/install.sh              # once; registers it in ~/.mozilla/native-messaging-hosts
./companion/install.sh --uninstall
```

Needs Linux with PipeWire (`pw-record`, `pw-dump`) and Python 3 (standard
library only). Firefox starts it when captions start and stops it with them.

The **Audio source** setting picks what's used:
- **Automatic** (default): the companion for videos with DRM (`video.mediaKeys`
  set), the page otherwise.
- **Companion: this tab's audio**: Firefox names each tab's PipeWire stream
  after the page title; the companion records the stream of the Firefox that
  started it, preferring the one titled like the tab, then one that's playing.
  Other apps, notifications and other Firefox windows aren't heard.
- **Companion: all system audio**: the default output's monitor, for when the
  tab's stream can't be found (everything that plays gets transcribed).

The recording is post-volume: a muted tab gives silence. Audio is timestamped
on arrival and placed on the video timeline with the position the content
script reports four times a second, so pausing, seeking and playback speed
work as with page capture. Measured with Deepgram on the same clip: 0.74 s
median lag through the companion, 0.72 s from the page.
