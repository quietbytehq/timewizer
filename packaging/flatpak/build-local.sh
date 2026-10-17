#!/usr/bin/env bash
# Builds and runs the Flatpak from this working tree (not from the tagged git source), to try it
# before sending it to Flathub.
#   bash packaging/flatpak/build-local.sh
# Needs: flatpak, flatpak-builder, and the GNOME runtime/SDK plus the rust-stable and node22 extensions
# (flatpak-builder --install-deps-from=flathub fetches them).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
trap 'rm -rf "${OUT:?}"' EXIT
python3 - "$OUT" <<'PY'
import sys, yaml
m = yaml.safe_load(open("packaging/flatpak/io.github.quietbytehq.timewizer.yml"))
src = m["modules"][0]["sources"]
src[0] = {"type": "dir", "path": "../../..", "skip": [".git", "node_modules", "dist", "src-tauri/target", "release"]}
yaml.safe_dump(m, open(sys.argv[1] + "/manifest.yml", "w"), sort_keys=False)
PY
cp packaging/flatpak/cargo-sources.json packaging/flatpak/node-sources.json "$OUT"/
# the "dir" source path is relative to the manifest, so point it at this tree
sed -i "s|path: ../../..|path: $(pwd)|" "$OUT/manifest.yml"
flatpak-builder --user --install --force-clean --install-deps-from=flathub "$OUT/build" "$OUT/manifest.yml"
echo "Installed. Run it with: flatpak run io.github.quietbytehq.timewizer"
