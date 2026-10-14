#!/usr/bin/env bash
# Start WhisperLiveKit for the "Local server" provider (see README.md here).
# Extra arguments go to the server, e.g. ./server/run.sh --model base
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
venv="$here/.venv"
if [[ ! -x "$venv/bin/whisperlivekit-server" ]]; then
  echo "Run $here/setup.sh first." >&2
  exit 1
fi
# faster-whisper (CTranslate2) is built against CUDA 12; torch ships CUDA 13.
nvidia="$("$venv/bin/python" -c 'import nvidia, os; print(os.path.dirname(nvidia.__path__[0]))')/nvidia"
export LD_LIBRARY_PATH="$nvidia/cublas/lib:$nvidia/cudnn/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$venv/bin/python" "$here/serve.py" --model small --lan auto --port 8000 "$@"
