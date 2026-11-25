## Auris companion

The **Auris** Firefox extension shows live captions transcribed from a video's
actual audio. It works on its own for most sites. **DRM-protected videos**
(Netflix, Disney+, Prime Video…) can't be read from the page, and need this
small companion app, installed once, outside the browser. It records only
Firefox's sound output, and only while captions are on.

Get the extension from addons.mozilla.org; its settings page shows whether the
companion is installed and links here.

| System | Download | How to install |
|---|---|---|
| Windows 10/11 (x64) | `auris-companion-windows-x64-setup.exe` | Run it. Per-user, no admin rights; uninstall from Settings → Apps. |
| Windows, portable | `auris-companion-windows-x64-portable.exe` | Double-click once: it installs itself the same way. |
| Linux x64 (PipeWire) | `auris-companion-linux-x64.tar.gz` | Unpack, run `./auris-companion install`. Needs `pw-record` and `pw-dump`. `auris-companion uninstall` removes it. |

macOS isn't supported yet. Flatpak/Snap builds of Firefox may not be able to
start it. Details: [companion/README.md](https://github.com/Josueccc/captions/blob/main/companion/README.md).

The Windows executables aren't code-signed, so SmartScreen may warn the first
time: *More info → Run anyway*.
