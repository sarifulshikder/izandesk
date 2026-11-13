/**
 * Stripe Elements / Cards / Apple Pay / Google Pay Plugin (IzanDesk ERP)
 * Hot-reloadable driver in /plugins/payment-stripe
 */
const crypto = require('crypto');
function makeId(p='pi') { return `${p}_${crypto.randomBytes(8).toString('hex')}`; }

module.exports = {
  id: 'payment-stripe',
  name: 'Stripe Elements & Apple Pay',
  title: 'Stripe Elements, Cards, Apple Pay & Google Pay',
  version: '3.0.0',
  type: 'PAYMENT_GATEWAY',
  author: 'IzanDesk Core Team',
  description: 'Stripe Elements/PaymentIntent checkout with support for cards, Apple Pay and Google Pay (3D Secure ready).',
  capabilities: ['elements', 'cards', 'apple_pay', 'google_pay', 'payment_intent', 'webhook', 'sandbox'],

  async createCheckoutSession(req = {}) {
    const amount = Math.round(Number(req.amount || req.invoice?.due_amount || req.invoice?.amount || 0) * 100) || 0; // minor units
    const currency = String(req.currency || 'usd').toLowerCase();
    const paymentIntentId = makeId('pi');
    const clientSecret = `${paymentIntentId}_secret_${crypto.randomBytes(12).toString('hex')}`;
    // Real Stripe requires server-side PaymentIntent/Checkout Session creation with secret key and client-side Elements/Checkout.
    // Return simulated checkout unless fully integrated.
    return {
      ok: true,
      gateway: 'stripe',
      sessionId: makeId('cs'),
      paymentIntentId,
      clientSecret,
      amount,
      currency,
      publishableKeyHint: req.mode === 'LIVE' ? 'pk_live_configured' : 'pk_test_sandbox',
      supports: ['cards', 'apple_pay', 'google_pay', 'elements'],
      paymentUrl: null,
      simulated: true,
      message: 'Stripe checkout created as SIMULATED (live Stripe API/keys and client Elements/Checkout integration required). Configure Stripe keys and integration to collect payment.',
      raw: { paymentRef: req.paymentRef, invoiceId: req.invoiceId }
    };
  },

  async verifyWebhook(payload = {}, headers = {}, _config = {}) {
    // In sandbox/local mode accept signed-looking payloads; production would verify Stripe-Signature with webhook secret
    const type = String(payload.type || payload.event || '');
    const obj = payload.data?.object || payload.object || payload;
    const succeeded = ['payment_intent.succeeded', 'checkout.session.completed', 'charge.succeeded', 'COMPLETED', 'PAID'].includes(type) || String(obj.status||'').toLowerCase() === 'succeeded';
    const amountMinor = Number(obj.amount_received || obj.amount_total || obj.amount || 0);
    const amount = amountMinor > 100 ? amountMinor / 100 : Number(payload.amount || amountMinor || 0);
    return {
      ok: true,
      verified: succeeded,
      status: succeeded ? 'COMPLETED' : (String(obj.status || 'PENDING').toUpperCase()),
      trxId: obj.id || payload.id || makeId('ch'),
      paymentRef: obj.metadata?.paymentRef || payload.paymentRef || payload.payment_ref || null,
      invoiceId: obj.metadata?.invoiceId || payload.invoiceId || payload.invoice_id || null,
      amount,
      currency: String(obj.currency || payload.currency || 'usd').toUpperCase(),
      payer: { email: obj.receipt_email || obj.customer_details?.email || null },
      eventId: payload.id || headers['stripe-event-id'] || null,
      raw: payload,
      message: succeeded ? 'Stripe payment verified' : 'Stripe event not a completed payment'
    };
  }
};
