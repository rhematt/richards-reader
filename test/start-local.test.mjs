import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { selectLanAddress } from '../scripts/local-network.mjs';
import { bonjourRegistrationReady, stopChildren } from '../scripts/start-local.mjs';

const routes = `Routing tables
Internet:
Destination        Gateway            Flags               Netif Expire
default            192.168.0.1        UGScg                 en0
default            link#23            UCSIg           bridge100      !
default            link#25            UCSIg           bridge101      !
`;

const addresses = ip => ({
  en0: [{ address: ip, family: 'IPv4', internal: false }],
  bridge100: [{ address: '10.211.55.1', family: 'IPv4', internal: false }],
  utun4: [{ address: '10.8.0.3', family: 'IPv4', internal: false }]
});

test('LAN-MDNS-001: the gateway route selects the current DHCP address, not a VM or VPN address', () => {
  const route = 'route to: default\ndestination: default\ngateway: 192.168.0.1\ninterface: en0\n';
  assert.deepEqual(selectLanAddress(route, routes, addresses('192.168.0.3')), {
    interfaceName: 'en0', address: '192.168.0.3'
  });
  assert.deepEqual(selectLanAddress(route, routes, addresses('192.168.0.17')), {
    interfaceName: 'en0', address: '192.168.0.17'
  });
});

test('LAN-MDNS-001: a tunnel default route falls back to the gateway-backed LAN route', () => {
  const route = 'route to: default\ngateway: 10.8.0.1\ninterface: utun4\n';
  assert.deepEqual(selectLanAddress(route, routes, addresses('192.168.0.17')), {
    interfaceName: 'en0', address: '192.168.0.17'
  });
});

test('LAN-MDNS-001: fails closed without a routed LAN IPv4', () => {
  assert.throws(() => selectLanAddress('', routes, { bridge100: addresses('192.168.0.3').bridge100 }), /LAN IPv4/);
});

test('LAN-MDNS-001: follows a changed default LAN interface', () => {
  const newRoutes = routes.replace('192.168.0.1        UGScg                 en0',
    '10.0.0.1           UGScg                 en5');
  const newAddresses = { en5: [{ address: '10.0.0.42', family: 'IPv4', internal: false }] };
  assert.deepEqual(selectLanAddress('', newRoutes, newAddresses), {
    interfaceName: 'en5', address: '10.0.0.42'
  });
});

test('LAN-MDNS-001: chooses the address on the gateway subnet when an interface has aliases', () => {
  const interfaces = { en0: [
    { address: '10.1.0.8', family: 'IPv4', internal: false, netmask: '255.255.255.0' },
    { address: '192.168.0.17', family: 'IPv4', internal: false, netmask: '255.255.255.0' }
  ] };
  assert.equal(selectLanAddress('', routes, interfaces).address, '192.168.0.17');
  assert.throws(() => selectLanAddress('', routes, { en0: interfaces.en0.slice(0, 1) }), /LAN IPv4/);
});

test('LAN-MDNS-001: stopping Reader removes Bonjour before stopping the server', async () => {
  const calls = [];
  class FakeChild extends EventEmitter {
    exitCode = null;
    signalCode = null;
    constructor(name) { super(); this.name = name; }
    kill(signal) {
      calls.push(`${this.name}:${signal}`);
      queueMicrotask(() => { this.signalCode = signal; this.emit('exit', null, signal); });
      return true;
    }
  }
  await stopChildren(new FakeChild('bonjour'), new FakeChild('server'));
  assert.deepEqual(calls, ['bonjour:SIGTERM', 'server:SIGTERM']);
});

test('LAN-MDNS-001: waits for both Bonjour records and rejects a renamed service', () => {
  const host = 'Got a reply for record reader.local: Name now registered and active\n';
  const service = "Got a reply for service Richard's Reader._https._tcp.local.: Name now registered and active\n";
  assert.equal(bonjourRegistrationReady(host), false);
  assert.equal(bonjourRegistrationReady(host + service), true);
  assert.throws(() => bonjourRegistrationReady(host + service.replace('Reader._https', 'Reader (2)._https')),
    /competing registration/);
});
