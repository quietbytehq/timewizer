#!/usr/bin/env bash
# Rebuilds cargo-sources.json and node-sources.json (the offline copies of every Rust crate and
# npm package the Flatpak needs). Run it after Cargo.lock or package-lock.json changed, then commit.
#   bash packaging/flatpak/update-sources.sh
# Needs: python3, git, node/npm, and network access.
set -euo pipefail
cd "$(dirname "$0")/../.."
TOOLS="$(mktemp -d)"
trap 'rm -rf "${TOOLS:?}"' EXIT
git clone -q --depth 1 https://github.com/flatpak/flatpak-builder-tools "$TOOLS/fbt"
python3 -m venv "$TOOLS/venv"
"$TOOLS/venv/bin/pip" install -q aiohttp tomlkit PyYAML "$TOOLS/fbt/node"

# 1. Rust crates
"$TOOLS/venv/bin/python" "$TOOLS/fbt/cargo/flatpak-cargo-generator.py" src-tauri/Cargo.lock -o packaging/flatpak/cargo-sources.json

# 2. npm packages: only what the page build needs (no test tools such as Playwright, which
#    downloads browsers). Same versions as package-lock.json.
B=packaging/flatpak/build
mkdir -p "$B"
cp package.json package-lock.json "$B"/
(cd "$B" && npm uninstall --package-lock-only --ignore-scripts @playwright/test oxlint @tauri-apps/cli >/dev/null)
(cd "$B" && "$TOOLS/venv/bin/flatpak-node-generator" --no-requests-cache npm package-lock.json -o ../node-sources)
mv packaging/flatpak/node-sources packaging/flatpak/node-sources.json
echo "Done. Commit packaging/flatpak/."
