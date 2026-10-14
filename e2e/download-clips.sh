#!/usr/bin/env bash
# Download speech clips for repeatable runs: e2e/site/{ted,fr}.webm (needs yt-dlp).
# Use with: --url 'http://127.0.0.1:8765/index.html?src=fr.webm'
set -euo pipefail
cd "$(dirname "$0")/site"
get() { yt-dlp -q -f 'bv*[height<=360]+ba/b[height<=360]' --download-sections "*$2" --merge-output-format webm -o "$1.%(ext)s" "$3"; }
get ted 60-160 'https://www.youtube.com/watch?v=iG9CE55wbtY'   # English, TED (Ken Robinson)
get fr 120-220 'https://www.youtube.com/watch?v=2E_Kx-MBlEA'   # French, TEDxBrussels
