#!/usr/bin/env bash
# Build the companion from source and register it with Firefox (per user), see README.md here.
# ./companion/install.sh --uninstall removes it.
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --quiet
if [[ "${1:-}" == "--uninstall" ]]; then
  exec target/release/auris-companion uninstall
fi
exec target/release/auris-companion install
