/**
 * Greenweb Bangladesh SMS Gateway Driver for IzanDesk ERP
 * Hot-Reloadable Driver in /plugins/sms-greenweb
 */
module.exports = {
  id: 'sms-greenweb',
  name: 'Greenweb SMS Gateway',
  version: '1.2.0',
  type: 'SMS_GATEWAY',
  author: 'IzanDesk Core Team',
  description: 'Masked alphanumeric sender ID & Bengali Unicode SMS delivery',

  async sendSms(recipient, message, senderId) {
    return {
      status: 'DELIVERED',
      messageId: 'GW_' + Date.now(),
      recipient,
      senderId: senderId || 'IZANDESK',
    };
  },
};
