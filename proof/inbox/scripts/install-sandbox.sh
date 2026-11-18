#!/usr/bin/env bash
# Installs the proof code + workflows into the DISPOSABLE sandbox repo only. Refuses any other repo.
set -euo pipefail
REPO="The-Artificer-of-Ciphers-LLC/warden-p0-sandbox"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$HERE/proof-config.json" ] || { echo "run: node src/cli.ts setup  (creates proof-config.json)"; exit 1; }
LOGIN="${WARDEN_P0_LOGIN:-trek-e}"
INBOX="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).inbox)' "$HERE/proof-config.json")"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
gh repo clone "$REPO" "$TMP/sb" -- --quiet
mkdir -p "$TMP/sb/proof/inbox" "$TMP/sb/.github/workflows"
rm -rf "$TMP/sb/proof/inbox/src"
cp -R "$HERE/src" "$TMP/sb/proof/inbox/src"; cp "$HERE/package.json" "$HERE/proof-config.json" "$TMP/sb/proof/inbox/"
for w in p0-writer p0-overlap; do sed -e "s/__INBOX__/$INBOX/g" -e "s/__LOGIN__/$LOGIN/g" "$HERE/workflows/$w.yml" > "$TMP/sb/.github/workflows/$w.yml"; done
cd "$TMP/sb"
git add -A
if git diff --cached --quiet; then echo "sandbox already up to date"; else
  git -c user.name="warden-p0-proof" -c user.email="proof@example.invalid" commit -q -m "p0 proof: install writer/overlap workflows and proof sources"
  git push -q origin HEAD:main; echo "pushed: $(git rev-parse --short HEAD)"; fi
