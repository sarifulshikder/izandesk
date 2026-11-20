'use strict';
/* Unit tests for ACS/TR-069 (GenieACS) pure helpers: qs() encoding (incl. the
 * connection_request presence contract), pickDeviceSummary(), buildDiagnostics().
 * Run: node tests/acs.test.cjs  (requires: pnpm --filter api build first) */
const acs = require('../dist/routes/acs.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
}

/* qs() — connection_request must survive even when empty (GenieACS triggers the
 * CPE connection on presence: url.searchParams.has('connection_request')). */
check('qs: connection_request empty is emitted', acs.qs({ connection_request: '' }) === '?connection_request=');
check('qs: connection_request undefined is skipped', acs.qs({ connection_request: undefined }) === '');
check('qs: other empty strings still skipped', acs.qs({ a: '' }) === '');
check('qs: null values skipped', acs.qs({ a: null }) === '');
check('qs: normal params', acs.qs({ limit: 500 }) === '?limit=500');
check('qs: object value is JSON-encoded', acs.qs({ query: { a: 1 } }) === '?query=%7B%22a%22%3A1%7D');
check('qs: empty params', acs.qs({}) === '');

/* pickDeviceSummary() on a synthetic GenieACS device doc. */
const doc = {
  _id: '202BC1-BM632w-000000',
  _deviceId: {
    _OUI: { _value: '00236A', _type: 'xsd:string' },
    _SerialNumber: { _value: 'SER123', _type: 'xsd:string' },
    _ProductClass: { _value: 'ACS-1', _type: 'xsd:string' },
  },
  _lastInform: new Date('2026-11-19T12:00:00Z'),
  _tags: ['tagA'],
  InternetGatewayDevice: {
    DeviceInfo: { SerialNumber: { _value: 'SER123' }, Manufacturer: { _value: 'ACME' }, ModelName: { _value: 'ACS-1' }, SoftwareVersion: { _value: 'v1.2' }, HardwareVersion: { _value: 'hw1' } },
    ManagementServer: { ConnectionRequestURL: { _value: 'http://192.168.88.243:7547/' } },
  },
};
const s = acs.pickDeviceSummary(doc);
check('summary.id', s.id === '202BC1-BM632w-000000');
check('summary.serial_number', s.serial_number === 'SER123');
check('summary.oui', s.oui === '00236A');
check('summary.product_class', s.product_class === 'ACS-1');
check('summary.manufacturer', s.manufacturer === 'ACME');
check('summary.model_name', s.model_name === 'ACS-1');
check('summary.software_version', s.software_version === 'v1.2');
check('summary.hardware_version', s.hardware_version === 'hw1');
check('summary.connection_request_url', s.connection_request_url === 'http://192.168.88.243:7547/');
check('summary.tags', Array.isArray(s.tags) && s.tags.length === 1 && s.tags[0] === 'tagA');

/* buildDiagnostics() on a synthetic WAN node (TR-098 WANIPConnection.1). */
const dev = {
  InternetGatewayDevice: {
    WANDevice: { 1: { WANConnectionDevice: { 1: { WANIPConnection: { 1: {
      ConnectionStatus: { _value: 'Connected' },
      ExternalIPAddress: { _value: '10.0.0.5' },
      Uptime: { _value: 8675 },
      Stats: {
        BytesSent: { _value: 100, _timestamp: '2026-11-19T11:00:00Z' },
        BytesReceived: { _value: 200, _timestamp: '2026-11-19T11:00:00Z' },
        ErrorsSent: { _value: 0 },
      },
    } } } } } },
  },
};
const d = acs.buildDiagnostics(dev);
check('diagnostics: one WAN interface', Array.isArray(d.interfaces) && d.interfaces.length === 1);
check('diagnostics: connection_status', d.interfaces[0]?.connection_status === 'Connected');
check('diagnostics: external_ip', d.interfaces[0]?.external_ip === '10.0.0.5');
check('diagnostics: bytes_sent', d.interfaces[0]?.bytes_sent === 100);
check('diagnostics: bytes_received', d.interfaces[0]?.bytes_received === 200);

/* getPath / collectInstances / flattenParams (exported for the project pages). */
check('getPath: traversal', acs.getPath({ a: { b: { c: 'x' } } }, 'a.b.c') === 'x');
check('getPath: missing returns undefined', acs.getPath({ a: {} }, 'a.b.c') === undefined);
check('getPath: empty path returns root', acs.getPath({ a: 1 }, '').a === 1);

check('collectInstances: numeric keys only', acs.collectInstances({ 1: { v: 'a' }, 2: { v: 'b' }, x: { v: 'c' }, 3: { v: 'd' } }).map(r => r.key).join() === '1,2,3');
check('collectInstances: non-object parent → []', acs.collectInstances(null).length === 0);

const flat = acs.flattenParams({
  _hidden: 1,
  'InternetGatewayDevice': {
    DeviceInfo: { SerialNumber: { _value: 'SER', _type: 'xsd:string', _timestamp: '2026-01-01T00:00:00Z' } },
    WANDevice: { _object: true, '1': { WANPPPConnection: { '1': { Enable: { _value: true, _writable: false } } } } },
  },
  Hosts: { Host: { '1': { IPAddress: { _value: '10.0.0.1' }, HostName: 'hp-1' } } },
  Tags: ['a', 'b'],
});
const paths = flat.map(r => r.path);
check('flatten: skips _-prefixed keys', !paths.includes('_hidden'));
check('flatten: leaf path present', paths.includes('InternetGatewayDevice.DeviceInfo.SerialNumber'));
check('flatten: _value extracted', flat.find(r => r.path === 'InternetGatewayDevice.DeviceInfo.SerialNumber')?.value === 'SER');
check('flatten: type carried', flat.find(r => r.path === 'InternetGatewayDevice.DeviceInfo.SerialNumber')?.type === 'xsd:string');
check('flatten: nested primitive leaf', paths.includes('InternetGatewayDevice.WANDevice.1.WANPPPConnection.1.Enable') && flat.find(r => r.path === 'InternetGatewayDevice.WANDevice.1.WANPPPConnection.1.Enable').value === true);
check('flatten: typed node pushed as leaf', acs.flattenParams({ Foo: { _type: 'xsd:string' } }).some(r => r.path === 'Foo' && r.type === 'xsd:string'));
check('flatten: non-object array pushed as leaf', acs.flattenParams({ Tags: ['a'] }).some(r => r.path === 'Tags' && Array.isArray(r.value)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
