#!/usr/bin/env bash
# Remove every trace of one disposable E2E subscriber.
#
# The subscriber DELETE API deliberately refuses to remove rows that have
# payment history, which is correct for real data but blocks disposable
# checkout fixtures. This script is for throwaway `SC-E2E-*` / `SC-WH-*` rows
# only and is never used by application code.
set -euo pipefail

CODE="${1:?usage: cleanup-e2e-fixtures.sh SC-E2E-123456}"
if [[ ! "$CODE" =~ ^SC-(E2E|WH)-[A-Za-z0-9_-]+$ ]]; then
  echo "refusing to clean unexpected client code: $CODE" >&2
  exit 1
fi

CONTAINER="${E2E_POSTGRES_CONTAINER:-izandesk-postgres}"
DB_USER="${E2E_DB_USER:-izandesk_user}"
DB_NAME="${E2E_DB_NAME:-izandesk}"

docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;

CREATE TEMP TABLE e2e_fixture_sub AS
  SELECT id, username FROM subscribers WHERE client_code = '$CODE';
CREATE TEMP TABLE e2e_fixture_payments AS
  SELECT payment_ref FROM payments WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);

-- Children that point at other child rows must go first.
DELETE FROM field_activities WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM installation_orders WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM onu_optical_history WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM onus WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM inventory_serials WHERE assigned_subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM coa_requests WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM subscriber_sessions WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM subscriber_session_history WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM acs_devices WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM kyc_documents WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM kyc_review_events WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM kyc_legal_holds WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM subscriber_kyc_profiles WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM saved_payment_methods WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM subscriber_equipment WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM subscriber_communications WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM reseller_share_entries WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM reseller_wallet_transactions WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM wallet_transactions WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM finance_transactions WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM billing_suspension_logs WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM fup_enforcement_logs WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM hotspot_vouchers WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM enforcement_outbox WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM tickets WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM leads WHERE converted_subscriber_id IN (SELECT id FROM e2e_fixture_sub);

DELETE FROM payment_webhook_events
 WHERE (payload->>'payment_ref') IN (SELECT payment_ref FROM e2e_fixture_payments);
DELETE FROM payments WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);
DELETE FROM invoices WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub);

-- Delete by the known client code too: the subscriber row may already be gone
-- while its RADIUS projection remains.
DELETE FROM radius_users WHERE subscriber_id IN (SELECT id FROM e2e_fixture_sub) OR username = '$CODE';
DELETE FROM radcheck WHERE username IN (SELECT username FROM e2e_fixture_sub) OR username = '$CODE';
DELETE FROM radreply WHERE username IN (SELECT username FROM e2e_fixture_sub) OR username = '$CODE';
DELETE FROM radusergroup WHERE username IN (SELECT username FROM e2e_fixture_sub) OR username = '$CODE';
DELETE FROM radpostauth WHERE username IN (SELECT username FROM e2e_fixture_sub) OR username = '$CODE';
DELETE FROM radacct WHERE username IN (SELECT username FROM e2e_fixture_sub) OR username = '$CODE';

DELETE FROM subscribers WHERE id IN (SELECT id FROM e2e_fixture_sub);

COMMIT;
SQL

echo "cleaned E2E fixture $CODE"
