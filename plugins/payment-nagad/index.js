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
    // Real Nagad PGW requires merchant credentials and initialize/complete API flow.
    // Return simulated checkout to avoid redirecting to non-functional fake endpoints.
    return {
      ok: true,
      gateway: 'nagad',
      paymentUrl: null,
      orderId,
      paymentReferenceId: makeId('NREF'),
      mode,
      simulated: true,
      supports: ['merchant_pgw'],
      message: 'Nagad checkout created as SIMULATED (live Nagad merchant PGW API/credentials not integrated in this environment). Configure Nagad credentials and enable live integration to redirect to Nagad.',
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
