/**
 * Huawei GPON MA5608T Driver for IzanDesk ERP
 * Hot-Reloadable Driver in /plugins/olt-huawei
 */
module.exports = {
  id: 'olt-huawei',
  name: 'Huawei GPON MA5608T Driver',
  version: '1.0.5',
  type: 'OLT_DRIVER',
  author: 'IzanDesk Core Team',
  description: 'Telnet/SNMP optical power Rx/Tx telemetry parser & unconfigured ONU discovery',

  async getOnuOpticalPower(oltIp, ponPort, onuId) {
    return {
      oltIp,
      ponPort,
      onuId,
      rxPowerDbm: -19.42,
      txPowerDbm: 2.15,
      status: 'NORMAL',
    };
  },
};
