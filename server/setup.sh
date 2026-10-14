#!/usr/bin/env bash
# Create server/.venv with WhisperLiveKit for the "Local server" provider.
# Uses uv (pacman -S uv) to get Python 3.12; ML wheels lag behind newer Pythons.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

uv="$(command -v uv || true)"
if [[ -z "$uv" ]]; then
  echo "uv not found; installing it into $here/.uv" >&2
  python3 -m venv "$here/.uv"
  "$here/.uv/bin/pip" install -q uv
  uv="$here/.uv/bin/uv"
fi

"$uv" venv --python 3.12 "$here/.venv"
# nvidia-*-cu12: faster-whisper's CTranslate2 needs CUDA 12 libraries, while
# torch brings CUDA 13 ones. run.sh puts them on LD_LIBRARY_PATH.
"$uv" pip install --python "$here/.venv" \
  whisperlivekit==0.2.26 faster-whisper==1.2.1 nvidia-cublas-cu12 'nvidia-cudnn-cu12==9.*'
echo "Done. Start the server with $here/run.sh"
