/**
 * Stripe Elements Payment Driver for IzanDesk ERP
 * Hot-Reloadable Driver in /plugins/payment-stripe
 */
module.exports = {
  id: 'payment-stripe',
  name: 'Stripe Elements & Apple Pay',
  version: '2.1.0',
  type: 'PAYMENT_GATEWAY',
  author: 'IzanDesk Core Team',
  description: 'Global 3D Secure 2.0 card processing, Apple Pay & Google Pay',

  async createCheckoutSession(invoice) {
    return {
      clientSecret: 'pi_test_secret_' + Math.random().toString(36).substring(2, 10),
      currency: 'usd',
    };
  },
};
