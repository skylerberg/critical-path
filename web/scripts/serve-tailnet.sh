#!/usr/bin/env bash
# Expose the built app to your Tailscale tailnet (tailnet-only, not the public
# internet). Rebuilds, restarts the preview server on 127.0.0.1:4173, and points
# `tailscale serve` at it. Requires the API running on :3001 (it is proxied).
#
# Usage:
#   ./scripts/serve-tailnet.sh            # HTTP (works today; no PWA install)
#   ./scripts/serve-tailnet.sh --https    # HTTPS (needs "HTTPS Certificates"
#                                          # enabled in the Tailscale admin
#                                          # console; enables PWA install)
set -euo pipefail
cd "$(dirname "$0")/.."

# Locate the Tailscale CLI (PATH, or the macOS app bundle).
TS="$(command -v tailscale || true)"
[ -z "$TS" ] && [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ] \
  && TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
[ -z "$TS" ] && { echo "Tailscale CLI not found." >&2; exit 1; }

curl -sf http://localhost:3001/health >/dev/null \
  || echo "Warning: API not reachable on :3001 — start it in critical-path-api (npm run dev) or the app's API calls will fail." >&2

echo "Building..."; npm run build >/dev/null

# Restart the preview server (localhost-bound; tailscale serve reaches it).
lsof -ti :4173 | xargs kill -9 2>/dev/null || true
nohup npm run preview >/tmp/critpath-preview.log 2>&1 &
sleep 3

if [ "${1:-}" = "--https" ]; then
  "$TS" serve --bg --https=443 http://127.0.0.1:4173
else
  "$TS" serve --bg --http=80 http://127.0.0.1:4173
fi
"$TS" serve status
echo "Done. Open the URL above on any device signed into your tailnet."
