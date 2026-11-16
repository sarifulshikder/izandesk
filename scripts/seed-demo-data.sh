#!/usr/bin/env bash
set -euo pipefail

API="http://localhost:4000"
TOKEN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@izandesk.com","password":"admin123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token)}catch(e){console.error('login failed');process.exit(1)}})")
if [ -z "$TOKEN" ]; then echo "No token"; exit 1; fi

echo "== 1) Set subscriber monthly_bill from bandwidth_packages (fallback defaults) =="
cd /home/server/izandesk/apps/api
node <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'izandesk', user: 'izandesk_user', password: 'izandesk_secret_password' });
(async () => {
  // Set fallback for zero-price packages
  await pool.query(`
    UPDATE subscribers s SET monthly_bill = CASE
      WHEN bp.price::numeric > 0 THEN bp.price
      WHEN s.package_name ILIKE '%6mbps%' OR s.package_name ILIKE '%6 Mbps%' THEN 600
      WHEN s.package_name ILIKE '%8mbps%' OR s.package_name ILIKE '%8 Mbps%' THEN 700
      WHEN s.package_name ILIKE '%10mbps%' OR s.package_name ILIKE '%10 Mbps%' THEN 800
      WHEN s.package_name ILIKE '%basic%' THEN 500
      WHEN s.package_name ILIKE '%special%' THEN 999
      WHEN s.package_name ILIKE '%home 20%' THEN 500
      WHEN s.package_name ILIKE '%home 50%' THEN 800
      WHEN s.package_name ILIKE '%corporate%' THEN 5000
      ELSE 500
    END,
    updated_at = now()
    FROM bandwidth_packages bp
    WHERE s.package_name = bp.name
  `);
  // Handle any not matched (shouldn't happen), set default
  await pool.query(`UPDATE subscribers SET monthly_bill = 500, updated_at = now() WHERE monthly_bill IS NULL OR monthly_bill::numeric = 0`);
  const r = await pool.query("SELECT COUNT(*)::int c, MIN(monthly_bill::numeric) mn, MAX(monthly_bill::numeric) mx FROM subscribers WHERE monthly_bill::numeric > 0");
  console.log('subscribers with bill:', JSON.stringify(r.rows[0]));
  const by = await pool.query("SELECT package_name, COUNT(*)::int n, AVG(monthly_bill::numeric)::int avg FROM subscribers GROUP BY package_name ORDER BY 2 DESC");
  for (const row of by.rows) console.log('  ', row.package_name, '| n:', row.n, '| avg:', row.avg);
  await pool.end();
})();
NODE

echo "== 2) Generate invoices for active subscribers =="
IDS=$(cd /home/server/izandesk/apps/api && node <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'izandesk', user: 'izandesk_user', password: 'izandesk_secret_password' });
(async () => {
  const r = await pool.query("SELECT id FROM subscribers WHERE status='ACTIVE' ORDER BY created_at");
  console.log(r.rows.map(x=>x.id).join(','));
  await pool.end();
})();
NODE
)
echo "Active subscriber IDs count: $(echo "$IDS" | awk -F, '{print NF}')"

curl -s -X POST "$API/api/billing/invoices/generate" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"subscriber_ids\": $(node -e "const ids=process.argv[1].split(',').filter(Boolean); console.log(JSON.stringify(ids))" "$IDS"), \"cycle_date\": \"$(date +%Y-%m-01)\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.stringify(JSON.parse(d),null,2).slice(0,1200))}catch(e){console.log(d.slice(0,800))}})"

echo "== 3) Make a few invoices OVERDUE (direct DB) =="
cd /home/server/izandesk/apps/api
node <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'izandesk', user: 'izandesk_user', password: 'izandesk_secret_password' });
(async () => {
  // mark 3 oldest UNPAID invoices as OVERDUE and push due_date back
  const r = await pool.query("UPDATE invoices SET status='OVERDUE', due_date = CURRENT_DATE - INTERVAL '10 days', updated_at=now() WHERE id IN (SELECT id FROM invoices WHERE status='UNPAID' ORDER BY created_at LIMIT 3) RETURNING invoice_number, due_amount");
  console.log('overdue set:', r.rows.map(x=>x.invoice_number).join(', '));
  await pool.end();
})();
NODE

echo "== 4) Create + confirm a couple of payments =="
# pick first two invoices
cd /home/server/izandesk/apps/api
PAY_DATA=$(node <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'izandesk', user: 'izandesk_user', password: 'izandesk_secret_password' });
(async () => {
  const r = await pool.query("SELECT id, subscriber_id, due_amount FROM invoices WHERE status IN ('UNPAID','OVERDUE') ORDER BY created_at LIMIT 2");
  console.log(JSON.stringify(r.rows));
  await pool.end();
})();
NODE
)
echo "Invoices for payment: $PAY_DATA"
node -e "const arr=JSON.parse(process.argv[1]); process.stdout.write(arr.map(x=>x.id+'|'+x.subscriber_id+'|'+x.due_amount).join('\\n'))" "$PAY_DATA" | while IFS='|' read -r INV_ID SUB_ID AMT; do
  [ -z "$INV_ID" ] && continue
  echo "--- checkout for invoice $INV_ID amount $AMT ---"
  CO=$(curl -s -X POST "$API/api/billing/payments/checkout" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"gateway\":\"cash\",\"invoice_id\":\"$INV_ID\",\"subscriber_id\":\"$SUB_ID\",\"amount\":$AMT}")
  REF=$(echo "$CO" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.payment?.payment_ref||'')}catch(e){console.log('')}})" )
  if [ -n "$REF" ]; then
    echo "confirming $REF ..."
    curl -s -X POST "$API/api/billing/payments/$REF/confirm" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"method":"CASH","amount":'"$AMT"',"trx_id":"CASH-'"$RANDOM"'"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('ok:', j.ok, '| dup:', j.duplicate||false)}catch(e){console.log(d.slice(0,200))}})"
  else
    echo "checkout failed: $CO" | head -c 200; echo
  fi
done

echo "== 5) Create tickets ==";echo "== 5) Create tickets =="
# pick a subscriber
SUB1=$(cd /home/server/izandesk/apps/api && node <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'izandesk', user: 'izandesk_user', password: 'izandesk_secret_password' });
(async () => {
  const r = await pool.query("SELECT id, full_name FROM subscribers WHERE status='ACTIVE' ORDER BY created_at LIMIT 2");
  console.log(r.rows.map(x=>x.id).join(','));
  await pool.end();
})();
NODE
)
S1=$(echo "$SUB1" | cut -d, -f1)
S2=$(echo "$SUB1" | cut -d, -f2)
curl -s -X POST "$API/api/tickets/" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"subscriber_id\":\"$S1\",\"subject\":\"No internet / red LOS\",\"description\":\"Customer reports no internet since morning.\",\"category\":\"FIBER\",\"priority\":\"HIGH\",\"status\":\"OPEN\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('ticket:', j.data?.ticket_no||j.message)}catch(e){console.log(d.slice(0,120))}})"
curl -s -X POST "$API/api/tickets/" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"subscriber_id\":\"$S2\",\"subject\":\"Slow speed complaint\",\"description\":\"Speed much lower than package.\",\"category\":\"SUPPORT\",\"priority\":\"MEDIUM\",\"status\":\"IN_PROGRESS\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('ticket:', j.data?.ticket_no||j.message)}catch(e){console.log(d.slice(0,120))}})"
curl -s -X POST "$API/api/tickets/" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"subject\":\"Router replacement request\",\"description\":\"Need to replace faulty ONT.\",\"category\":\"EQUIPMENT\",\"priority\":\"LOW\",\"status\":\"OPEN\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('ticket:', j.data?.ticket_no||j.message)}catch(e){console.log(d.slice(0,120))}})"

echo "== 6) Create leads =="
curl -s -X POST "$API/api/leads/" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"full_name":"Rahim Uddin","phone":"+8801711000001","source":"WALK_IN","status":"NEW","interested_package":"Home 20 Mbps","priority":"MEDIUM"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('lead:', j.lead?.lead_no||j.message)}catch(e){console.log(d.slice(0,120))}})"
curl -s -X POST "$API/api/leads/" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"full_name":"Karim Mia","phone":"+8801711000002","source":"CALL","status":"CONTACTED","interested_package":"Home 50 Mbps","priority":"HIGH"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('lead:', j.lead?.lead_no||j.message)}catch(e){console.log(d.slice(0,120))}})"
curl -s -X POST "$API/api/leads/" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"full_name":"Nasir Telecom","phone":"+8801711000003","source":"REFERRAL","status":"QUALIFIED","interested_package":"Corporate 100 Mbps CIR","priority":"HIGH"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('lead:', j.lead?.lead_no||j.message)}catch(e){console.log(d.slice(0,120))}})"

echo "== 7) Create installation orders =="
curl -s -X POST "$API/api/installation-orders/" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"subscriber_id\":\"$S1\",\"order_type\":\"REPAIR\",\"status\":\"SCHEDULED\",\"priority\":\"HIGH\",\"site_contact_name\":\"Demo Contact\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('order:', j.order?.order_no||j.message)}catch(e){console.log(d.slice(0,120))}})"
curl -s -X POST "$API/api/installation-orders/" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"subscriber_id\":\"$S2\",\"order_type\":\"INSTALLATION\",\"status\":\"PENDING\",\"priority\":\"NORMAL\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('order:', j.order?.order_no||j.message)}catch(e){console.log(d.slice(0,120))}})"

echo "== 8) Verify metrics =="
curl -s "$API/api/billing/metrics" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(JSON.stringify(j,null,2))}catch(e){console.log(d.slice(0,300))}})"
