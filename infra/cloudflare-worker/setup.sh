#!/usr/bin/env bash
# Cloudflare for SaaS — one-command setup for expadio forms routing.
# Usage:  CF_TOKEN=<your-token> bash setup.sh
set -euo pipefail

CF_TOKEN="${CF_TOKEN:?Set CF_TOKEN=<your-cloudflare-api-token>}"
ZONE_NAME="expadio.com"
FALLBACK_ORIGIN="forms.expadio.com"
WORKER_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Finding zone ID for $ZONE_NAME ..."
ZONE_ID=$(curl -sSf -X GET "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}&status=active" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  | python3 -c "import sys,json; z=json.load(sys.stdin)['result']; print(z[0]['id'] if z else '')")

if [ -z "$ZONE_ID" ]; then
  echo "ERROR: Zone '$ZONE_NAME' not found. Check your token has Zone:Read access to expadio.com."
  exit 1
fi
echo "    Zone ID: $ZONE_ID"

echo "==> Enabling Custom Hostnames (SSL for SaaS) on $ZONE_NAME ..."
curl -sSf -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/ssl_for_saas" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"on"}' | python3 -c "import sys,json; r=json.load(sys.stdin); print('    OK' if r.get('success') else 'ERROR: '+str(r))"

echo "==> Adding originless fallback record: ${FALLBACK_ORIGIN} AAAA 100:: ..."
# Check if record exists first.
EXISTING=$(curl -sSf "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=AAAA&name=${FALLBACK_ORIGIN}" \
  -H "Authorization: Bearer $CF_TOKEN" | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print(r[0]['id'] if r else '')")

if [ -n "$EXISTING" ]; then
  echo "    Record already exists (id: $EXISTING), skipping."
else
  curl -sSf -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"AAAA\",\"name\":\"${FALLBACK_ORIGIN}\",\"content\":\"100::\",\"ttl\":1,\"proxied\":true}" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print('    Created: '+r['result']['id'] if r.get('success') else 'ERROR: '+str(r))"
fi

echo "==> Setting Custom Hostnames fallback origin to ${FALLBACK_ORIGIN} ..."
curl -sSf -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/custom_hostnames/fallback_origin" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"origin\":\"${FALLBACK_ORIGIN}\"}" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('    OK' if r.get('success') else 'WARN: '+str(r.get('errors','')))"

echo "==> Deploying Cloudflare Worker ..."
cd "$WORKER_DIR"
CLOUDFLARE_API_TOKEN="$CF_TOKEN" npx wrangler deploy --name expadio-forms-proxy

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Set BRAND_WEB_ORIGIN secret in the Worker:"
echo "     CLOUDFLARE_API_TOKEN=$CF_TOKEN npx wrangler secret put BRAND_WEB_ORIGIN"
echo "     (paste your Railway brand-web public URL, e.g. https://brand-web-production.up.railway.app)"
echo ""
echo "  2. Set on Railway brand-web service:"
echo "     CLOUDFLARE_ZONE_ID=$ZONE_ID"
echo "     CLOUDFLARE_API_TOKEN=<token-with-Custom-Hostnames:Edit>"
