#!/usr/bin/env bash
# Signed bKash webhook + idempotency smoke against a disposable subscriber.
# Everything created here is removed by scripts/cleanup-e2e-fixtures.sh.
set -euo pipefail

: "${BKASH_WEBHOOK_SECRET:?set BKASH_WEBHOOK_SECRET to the staging gateway webhook secret}"

API="${E2E_API_URL:-http://localhost:4000}"
PKG_ID="${E2E_PACKAGE_ID:-0698f553-e610-4ffc-8e6f-4eeb398e1d3b}"
CODE="SC-WH-$(date +%s | tail -c 6)"
EVENT_ID="evt-live-$CODE"
TRX_ID="BTRX-LIVE-$CODE"
CLEANUP="$(cd "$(dirname "$0")" && pwd)/cleanup-e2e-fixtures.sh"

get() { python3 -c 'import sys,json; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"; }

cleanup() {
  bash "$CLEANUP" "$CODE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ADMIN_TOKEN=$(curl -fsS -X POST "$API/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@izandesk.com","password":"admin123"}' | get token)

CREATE=$(curl -fsS -X POST "$API/api/subscribers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Webhook Smoke\",\"client_code\":\"$CODE\",\"username\":\"$CODE\",\"password\":\"PortalSmoke@123\",\"package_name\":\"profile-v777\",\"expiry_date\":\"2020-01-10\"}")
SUB_ID=$(printf '%s' "$CREATE" | get id)

PTOKEN=$(curl -fsS -X POST "$API/api/portal/login" \
  -H 'Content-Type: application/json' \
  -d "{\"client_code\":\"$CODE\",\"password\":\"PortalSmoke@123\"}" | get token)

CHECKOUT=$(curl -fsS -X POST "$API/api/portal/packages/$PKG_ID/checkout" \
  -H "Authorization: Bearer $PTOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"gateway":"bkash","purpose":"PACKAGE_PURCHASE"}')
REF=$(printf '%s' "$CHECKOUT" | get payment_ref)
echo "checkout: ref=$REF subscriber=$CODE id=$SUB_ID"

PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"event_id":sys.argv[1],"status":"COMPLETED","payment_ref":sys.argv[2],"trx_id":sys.argv[3],"amount":500,"currency":"BDT","payer":"01700000000"}, separators=(",",":")))' "$EVENT_ID" "$REF" "$TRX_ID")
SIG=$(python3 -c 'import hmac,hashlib,sys; print(hmac.new(sys.argv[1].encode(),sys.argv[2].encode(),hashlib.sha256).hexdigest())' "$BKASH_WEBHOOK_SECRET" "$PAYLOAD")

FIRST=$(curl -fsS -X POST "$API/api/billing/webhooks/bkash" \
  -H 'Content-Type: application/json' \
  -H "x-signature: $SIG" \
  -d "$PAYLOAD")
printf '%s' "$FIRST" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("signed webhook: ok=%s verified=%s processed=%s duplicate=%s" % (d.get("ok"),d.get("verified"),d.get("processed"),d.get("duplicate")))
assert d.get("ok") is True and d.get("verified") is True and d.get("processed") is True, d
assert not d.get("duplicate"), d
'

SECOND=$(curl -fsS -X POST "$API/api/billing/webhooks/bkash" \
  -H 'Content-Type: application/json' \
  -H "x-signature: $SIG" \
  -d "$PAYLOAD")
printf '%s' "$SECOND" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("replay: ok=%s processed=%s duplicate=%s" % (d.get("ok"),d.get("processed"),d.get("duplicate")))
assert d.get("ok") is True and d.get("duplicate") is True, d
'

curl -fsS "$API/api/portal/payments/$REF" -H "Authorization: Bearer $PTOKEN" | python3 -c '
import sys,json
d=json.load(sys.stdin); p=d.get("payment") or {}; s=d.get("subscriber") or {}
print("portal status: payment=%s state=%s expiry=%s" % (p.get("status"), s.get("normalized_state"), s.get("expiry_date")))
assert p.get("status") == "COMPLETED", d
assert s.get("normalized_state") == "ACTIVE", d
'
