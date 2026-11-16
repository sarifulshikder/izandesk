#!/usr/bin/env bash
set -euo pipefail

API="http://localhost:4000"

clear_demo() {
  echo "== Clearing demo billing & CRM data =="
  cd /home/server/izandesk/apps/api
  node <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'izandesk', user: 'izandesk_user', password: 'izandesk_secret_password' });
(async () => {
  await pool.query('DELETE FROM invoice_items');
  await pool.query("DELETE FROM payments");
  await pool.query("DELETE FROM invoices");
  await pool.query("DELETE FROM tickets");
  await pool.query("DELETE FROM leads");
  await pool.query("DELETE FROM installation_orders");
  console.log('Cleared: invoice_items, payments, invoices, tickets, leads, installation_orders');
  await pool.end();
})();
NODE
  echo "Done."
}

if [ "${1:-}" = "clear" ] || [ "${1:-}" = "--clear" ]; then
  clear_demo
  exit 0
fi

TOKEN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@izandesk.com","password":"admin123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token)}catch(e){console.error('login failed');process.exit(1)}})")
if [ -z "$TOKEN" ]; then echo "No token"; exit 1; fi

echo "== 1) Set subscriber monthly_bill from bandwidth_packages (fallback defaults) =="
cd /home/server/izandesk/apps/api
node <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'izandesk', user: 'izandesk_user', password: 'izandesk_secret_password' });
(async () => {
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
  -d "{\"subscriber_ids\": $(node -e "const ids=process.argv[1].split(',').filter(Boolean); console.log(JSON.stringify(ids))" "$IDS"), \"cycle_date\": \"$(date +%Y-%m-01)\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.stringify(JSON.parse(d),null,2).slice(0,600))}catch(e){console.log(d.slice(0,400))}})"

echo "== 3) Make a few invoices OVERDUE (direct DB) =="
cd /home/server/izandesk/apps/api
node <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'izandesk', user: 'izandesk_user', password: 'izandesk_secret_password' });
(async () => {
  const r = await pool.query("UPDATE invoices SET status='OVERDUE', due_date = CURRENT_DATE - INTERVAL '10 days', updated_at=now() WHERE id IN (SELECT id FROM invoices WHERE status='UNPAID' ORDER BY created_at LIMIT 3) RETURNING invoice_number, due_amount");
  console.log('overdue set:', r.rows.map(x=>x.invoice_number).join(', '));
  await pool.end();
})();
NODE

echo "== 4) Create + confirm a couple of payments (robust) =="
cd /home/server/izandesk/apps/api
API="$API" TOKEN="$TOKEN" node <<'NODE'
const { Pool } = require('pg');
const http = require('http');

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body || {});
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
    }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, raw: b }); } });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

(async () => {
  const pool = new Pool({ host: 'localhost', port: 5432, database: 'izandesk', user: 'izandesk_user', password: 'izandesk_secret_password' });
  const api = process.env.API || 'http://localhost:4000';
  const token = process.env.TOKEN;
  if (!token) { console.error('no TOKEN'); process.exit(1); }
  const invs = (await pool.query("SELECT id, subscriber_id, due_amount FROM invoices WHERE status IN ('UNPAID','OVERDUE') ORDER BY created_at LIMIT 2")).rows;
  console.log('invoices for payment:', invs.length);
  for (const inv of invs) {
    try {
      const co = await postJson(api + '/api/billing/payments/checkout', { Authorization: 'Bearer ' + token }, { gateway: 'cash', invoice_id: inv.id, subscriber_id: inv.subscriber_id, amount: Number(inv.due_amount) });
      const ref = co.json?.payment?.payment_ref;
      if (!ref) { console.log('checkout failed for', inv.id, co.status, JSON.stringify(co.json || co.raw).slice(0,120)); continue; }
      const conf = await postJson(api + '/api/billing/payments/' + ref + '/confirm', { Authorization: 'Bearer ' + token }, { method: 'CASH', amount: Number(inv.due_amount), trx_id: 'CASH-' + Date.now() });
      console.log('confirmed', ref, 'ok=', conf.json?.ok);
    } catch (e) { console.log('err', inv.id, e.message); }
  }
  await pool.end();
})();
NODE

echo "== 5) Create tickets =="
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
