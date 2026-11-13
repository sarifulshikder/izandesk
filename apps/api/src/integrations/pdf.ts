function esc(s: any) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as any)[c]); }

export function renderInvoiceHtml(inv: any, opts: { baseUrl?: string; paymentUrl?: string } = {}) {
  const items = inv.items || [];
  const rows = items.map((it:any)=>`<tr><td style="padding:8px;border-bottom:1px solid #eee">${esc(it.description)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${esc(it.quantity||1)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${Number(it.unit_price||it.amount||0).toFixed(2)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${Number(it.amount||0).toFixed(2)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(inv.invoice_number)}</title></head>
  <body style="font-family:Arial,sans-serif;color:#111;margin:0;padding:24px;background:#f6f8fb"><div style="max-width:800px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1 style="margin:0 0 4px 0;font-size:24px">IzanDesk Invoice</h1><div style="color:#555">Invoice: <b>${esc(inv.invoice_number)}</b></div><div style="color:#555">Status: <b>${esc(inv.status)}</b></div></div><div style="text-align:right"><div>${esc(inv.subscriber_name||'')}</div><div style="color:#555">${esc(inv.client_code||'')}</div><div style="color:#555">${esc(inv.username||'')}</div></div></div>
  <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
  <div style="display:flex;gap:24px;flex-wrap:wrap;color:#444;font-size:14px"><div><div>Bill Month</div><b>${esc(inv.bill_month||'')}</b></div><div><div>Period</div><b>${esc(inv.period_start||'')} - ${esc(inv.period_end||'')}</b></div><div><div>Issue Date</div><b>${esc(inv.issue_date||'')}</b></div><div><div>Due Date</div><b>${esc(inv.due_date||'')}</b></div></div>
  <table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:14px"><thead><tr style="background:#f3f4f6"><th style="padding:8px;text-align:left">Description</th><th style="padding:8px;text-align:right">Qty</th><th style="padding:8px;text-align:right">Unit</th><th style="padding:8px;text-align:right">Amount</th></tr></thead><tbody>${rows || `<tr><td colspan="4" style="padding:8px;color:#666">No items</td></tr>`}</tbody></table>
  <div style="margin-top:16px;margin-left:auto;max-width:320px;font-size:14px"><div style="display:flex;justify-content:space-between;padding:4px 0"><span>Subtotal</span><b>${Number(inv.amount||inv.total_amount||0).toFixed(2)}</b></div><div style="display:flex;justify-content:space-between;padding:4px 0"><span>Total</span><b>${Number(inv.total_amount||0).toFixed(2)} ${esc(inv.currency||'BDT')}</b></div><div style="display:flex;justify-content:space-between;padding:4px 0"><span>Paid</span><b>${Number(inv.paid_amount||0).toFixed(2)}</b></div><div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #eee"><span>Due</span><b>${Number(inv.due_amount||0).toFixed(2)} ${esc(inv.currency||'BDT')}</b></div></div>
  ${opts.paymentUrl ? `<div style="margin-top:20px"><a href="${esc(opts.paymentUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:600">Pay Invoice</a></div>` : ''}
  ${inv.notes ? `<div style="margin-top:16px;color:#555;font-size:13px"><b>Notes:</b> ${esc(inv.notes)}</div>` : ''}
  </div></body></html>`;
}

function pdfEscapeText(s: string) { return String(s || '').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/\r?\n/g,' '); }

export function renderSimpleInvoicePdf(inv: any): Buffer {
  // Minimal single-page PDF (Helvetica). Good enough for invoice delivery/attachment links.
  const lines: string[] = [];
  lines.push('IzanDesk Invoice');
  lines.push(`Invoice: ${inv.invoice_number || ''}   Status: ${inv.status || ''}`);
  lines.push(`Subscriber: ${inv.subscriber_name || ''} (${inv.client_code || ''}) ${inv.username || ''}`);
  lines.push(`Bill Month: ${inv.bill_month || ''}   Period: ${inv.period_start || ''} - ${inv.period_end || ''}`);
  lines.push(`Issue: ${inv.issue_date || ''}   Due: ${inv.due_date || ''}`);
  lines.push('------------------------------------------------------------');
  const items = inv.items || [];
  if (items.length) {
    for (const it of items) lines.push(`${it.description || 'Item'}  x${it.quantity||1}  ${Number(it.amount||0).toFixed(2)} ${inv.currency||'BDT'}`);
  } else {
    lines.push(`Subscription  ${Number(inv.total_amount||0).toFixed(2)} ${inv.currency||'BDT'}`);
  }
  lines.push('------------------------------------------------------------');
  lines.push(`Total: ${Number(inv.total_amount||0).toFixed(2)} ${inv.currency||'BDT'}   Paid: ${Number(inv.paid_amount||0).toFixed(2)}   Due: ${Number(inv.due_amount||0).toFixed(2)}`);

  const contentLines: string[] = ['BT','/F1 11 Tf','50 780 Td','14 TL'];
  lines.slice(0, 45).forEach((l, i) => { if (i>0) contentLines.push('T*'); contentLines.push(`(${pdfEscapeText(l)}) Tj`); });
  contentLines.push('ET');
  const content = Buffer.from(contentLines.join('\n'), 'utf8');

  const objects: Buffer[] = [];
  const add = (s: string | Buffer) => { objects.push(Buffer.isBuffer(s)?s:Buffer.from(s,'utf8')); return objects.length; };
  const obj1 = add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const obj2 = add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  const obj3 = add('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  const obj4 = add('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  const obj5 = add(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content.toString('utf8')}\nendstream\nendobj\n`);

  let pdf = Buffer.from('%PDF-1.4\n', 'utf8');
  const offsets: number[] = [0];
  for (const o of objects) { offsets.push(pdf.length); pdf = Buffer.concat([pdf, o]); }
  const xrefStart = pdf.length;
  let xref = `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (let i=1;i<offsets.length;i++) xref += String(offsets[i]).padStart(10,'0') + ' 00000 n \n';
  const trailer = `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  pdf = Buffer.concat([pdf, Buffer.from(xref+trailer,'utf8')]);
  return pdf;
}
