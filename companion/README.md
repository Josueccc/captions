# System-audio companion

DRM-protected videos (Netflix, Disney+, Prime…) can't be captured from the page:
Firefox's `mozCaptureStream()` returns silence for encrypted media. The decoded
audio still goes through the OS mixer on its way to the speakers, so this
native-messaging host records it there and streams it to the extension.
It only reads the sound output, like the OS-level live captions do; it doesn't
touch the video or its decryption. Firefox starts it when captions start on such
a video and stops it with them.

## Install

From the [releases](https://github.com/zerathul/captions/releases/latest):

- **Windows 10/11**: run `captions-companion-…-windows-x64-setup.exe` (per-user,
  no admin rights). Uninstall it from Settings → Apps. The `-portable.exe`
  works too: double-click it once and it installs itself the same way.
- **Linux** (PipeWire, with `pw-record` and `pw-dump`): unpack the tarball and run
  `./captions-companion install`. It copies itself to
  `~/.local/share/captions-companion/`, so the download can be deleted afterwards.
  `captions-companion uninstall` removes it.

From source (needs Rust): `./companion/install.sh` builds it and runs `install`;
`./companion/install.sh --uninstall` removes it. Rerun it after changing the code,
since Firefox starts the installed copy.

`install` registers the host for the extension ID `captions@zerathul.local`: a
manifest in `~/.mozilla/native-messaging-hosts/` on Linux, and on Windows a
manifest next to the executable plus the registry key
`HKCU\Software\Mozilla\NativeMessagingHosts\captions_companion`. Flatpak and Snap
builds of Firefox are sandboxed and may not be able to start it.

## What it records

The **Audio source** setting picks what's used:
- **Automatic** (default): the companion for videos with DRM (`video.mediaKeys`
  set), the page otherwise.
- **Companion: this tab's audio**
  - Linux: Firefox names each tab's PipeWire stream after the page title. The
    companion records a stream of the Firefox that started it, preferring the one
    titled like the tab, then an untitled one (DRM audio plays through a stream
    called `AudioStream`), then one that's playing. Other apps aren't heard.
  - Windows: process loopback on the Firefox that started it, so all of that
    Firefox's tabs but no other app. This needs Windows 10 build 20348 or later
    (in practice Windows 11); older versions fall back to all system audio.
- **Companion: all system audio**: everything the default output plays, for when
  the tab's stream can't be found.

The recording is post-volume: a muted tab gives silence. Audio is timestamped
on arrival and placed on the video timeline with the position the content
script reports four times a second, so pausing, seeking and playback speed
work as with page capture. Measured with Deepgram on the same clip (Linux):
0.74 s median lag through the companion, 0.72 s from the page.

## Develop

```sh
cd companion
cargo test
cargo clippy --all-targets
cargo clippy --target x86_64-pc-windows-gnu   # type-checks the Windows code from Linux
```

`src/main.rs` has the message protocol; `src/pipewire.rs` and `src/wasapi.rs`
are the Linux and Windows capture; `src/register.rs` is `install`/`uninstall`.
`packaging/windows/` is the Inno Setup installer built by CI.
