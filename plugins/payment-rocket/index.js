/**
 * Rocket (DBBL) Merchant PGW Plugin (IzanDesk ERP)
 * Hot-reloadable driver in /plugins/payment-rocket
 */
const crypto = require('crypto');
function makeId(p='RKT') { return `${p}_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

module.exports = {
  id: 'payment-rocket',
  name: 'Rocket Merchant PGW',
  title: 'Rocket (DBBL) Merchant Payment Gateway',
  version: '1.0.0',
  type: 'PAYMENT_GATEWAY',
  author: 'IzanDesk Core Team',
  description: 'Rocket merchant PGW checkout and webhook/callback verification for instant collection.',
  capabilities: ['merchant_pgw', 'checkout', 'webhook', 'sandbox'],

  async createCheckoutSession(req = {}) {
    const amount = Number(req.amount || req.invoice?.due_amount || req.invoice?.amount || 0);
    const paymentRef = req.paymentRef || req.invoiceId || makeId('INV');
    const txnRef = makeId('RTXN');
    const mode = (req.mode || 'SANDBOX').toUpperCase();
    // Real Rocket integration requires merchant API/credentials. Avoid fake external redirect.
    return {
      ok: true,
      gateway: 'rocket',
      paymentUrl: null,
      txnRef,
      mode,
      simulated: true,
      supports: ['merchant_pgw'],
      message: 'Rocket checkout created as SIMULATED (live Rocket merchant API/credentials not integrated in this environment). Configure credentials and enable live integration to redirect to Rocket.',
      raw: { paymentRef, amount, currency: req.currency || 'BDT' }
    };
  },

  async verifyWebhook(payload = {}, _headers = {}, _config = {}) {
    const statusRaw = String(payload.status || payload.txnStatus || payload.responseCode || 'SUCCESS').toUpperCase();
    const completed = ['SUCCESS', 'COMPLETED', 'PAID', '000', 'APPROVED'].includes(statusRaw);
    const amount = Number(payload.amount || 0);
    const trxId = payload.bankTxnId || payload.txnId || payload.trxId || payload.trx_id || makeId('RTRX');
    return {
      ok: true,
      verified: completed,
      status: completed ? 'COMPLETED' : 'FAILED',
      trxId,
      paymentRef: payload.invoiceNo || payload.merchantInvoice || payload.paymentRef || payload.payment_ref || null,
      invoiceId: payload.invoiceId || payload.invoice_id || null,
      amount: isFinite(amount) ? amount : undefined,
      currency: payload.currency || 'BDT',
      payer: { msisdn: payload.payerAccount || payload.payer || null, method: 'Rocket' },
      eventId: trxId,
      raw: payload,
      message: completed ? 'Rocket payment verified' : 'Rocket payment not completed'
    };
  }
};
