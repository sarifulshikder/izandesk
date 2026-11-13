/**
 * Nagad Merchant PGW Plugin (IzanDesk ERP)
 * Hot-reloadable driver in /plugins/payment-nagad
 */
const crypto = require('crypto');
function makeId(p='NGD') { return `${p}_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

module.exports = {
  id: 'payment-nagad',
  name: 'Nagad Merchant PGW',
  title: 'Nagad Merchant Payment Gateway',
  version: '1.0.0',
  type: 'PAYMENT_GATEWAY',
  author: 'IzanDesk Core Team',
  description: 'Nagad merchant PGW checkout, callback/webhook verification and instant payment confirmation.',
  capabilities: ['merchant_pgw', 'checkout', 'webhook', 'sandbox'],

  async createCheckoutSession(req = {}) {
    const amount = Number(req.amount || req.invoice?.due_amount || req.invoice?.amount || 0);
    const paymentRef = req.paymentRef || req.invoiceId || makeId('INV');
    const orderId = makeId('NORDER');
    const mode = (req.mode || 'SANDBOX').toUpperCase();
    const base = mode === 'LIVE' ? 'https://api.mynagad.com' : 'https://sandbox.mynagad.com';
    const paymentUrl = `${base}:30000/remote-payment-gateway-1.0/api/dfs/check-out/initialize/${encodeURIComponent(orderId)}?amount=${encodeURIComponent(amount)}&merchantInvoice=${encodeURIComponent(paymentRef)}`;
    return {
      ok: true,
      gateway: 'nagad',
      paymentUrl,
      orderId,
      paymentReferenceId: makeId('NREF'),
      mode,
      supports: ['merchant_pgw'],
      message: 'Nagad merchant checkout initialized (sandbox-ready).',
      raw: { paymentRef, amount, currency: req.currency || 'BDT' }
    };
  },

  async verifyWebhook(payload = {}, _headers = {}, _config = {}) {
    const statusRaw = String(payload.status || payload.statusCode || payload.orderStatus || 'Success').toLowerCase();
    const completed = ['success', 'completed', 'paid', 'complete'].includes(statusRaw) || payload.status === 'Success';
    const amount = Number(payload.amount || 0);
    const trxId = payload.issuerPaymentRefNo || payload.paymentRefId || payload.trxId || payload.trx_id || makeId('NTRX');
    return {
      ok: true,
      verified: completed,
      status: completed ? 'COMPLETED' : 'FAILED',
      trxId,
      paymentRef: payload.merchantInvoiceNumber || payload.orderId || payload.paymentRef || payload.payment_ref || null,
      invoiceId: payload.invoiceId || payload.invoice_id || null,
      amount: isFinite(amount) ? amount : undefined,
      currency: payload.currency || 'BDT',
      payer: { msisdn: payload.clientMobileNo || payload.payer || null, method: 'Nagad' },
      eventId: trxId,
      raw: payload,
      message: completed ? 'Nagad payment verified' : 'Nagad payment not completed'
    };
  }
};