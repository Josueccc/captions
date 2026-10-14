#!/usr/bin/env bash
# Register the system-audio companion with Firefox (per user), see README.md here.
# ./companion/install.sh --uninstall removes it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# Firefox reads native hosts from ~/.mozilla even when its profiles live in
# ~/.config/mozilla (it only falls back to the old layout if ~/.mozilla/firefox exists).
dir="${MOZ_NATIVE_HOSTS_DIR:-$HOME/.mozilla/native-messaging-hosts}"
manifest="$dir/captions_companion.json"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$manifest"
  echo "Removed $manifest"
  exit 0
fi

for tool in python3 pw-record pw-dump; do
  command -v "$tool" >/dev/null || { echo "$tool not found; the companion needs it." >&2; exit 1; }
done

chmod +x "$here/captions_companion.py"
mkdir -p "$dir"
cat > "$manifest" <<JSON
{
  "name": "captions_companion",
  "description": "Captions: records Firefox's audio output for DRM-protected videos",
  "path": "$here/captions_companion.py",
  "type": "stdio",
  "allowed_extensions": ["captions@zerathul.local"]
}
JSON
echo "Installed $manifest"
