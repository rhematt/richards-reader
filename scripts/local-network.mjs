import { isIP } from 'node:net';

const virtualInterface = /^(?:lo|utun|tun|tap|awdl|llw|vmenet|vmnet|anpi)\d*$/i;

function usableAddress(address) {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return first !== 0 && first !== 127 && first < 224 &&
    !(first === 169 && second === 254);
}

function routesFromTable(table) {
  return table.split(/\r?\n/).flatMap(line => {
    const [destination, gateway, , interfaceName] = line.trim().split(/\s+/);
    return destination === 'default' && isIP(gateway) === 4 && interfaceName &&
      !virtualInterface.test(interfaceName)
      ? [{ gateway, interfaceName }] : [];
  });
}

function routeFromGet(output) {
  const gateway = /^\s*gateway:\s*(\S+)/m.exec(output)?.[1];
  const interfaceName = /^\s*interface:\s*(\S+)/m.exec(output)?.[1];
  return isIP(gateway) === 4 && interfaceName && !virtualInterface.test(interfaceName)
    ? { gateway, interfaceName } : null;
}

function onGatewaySubnet(address, netmask, gateway) {
  if (isIP(netmask) !== 4) return false;
  const bytes = value => value.split('.').map(Number);
  const ip = bytes(address), mask = bytes(netmask), router = bytes(gateway);
  return ip.every((part, index) => (part & mask[index]) === (router[index] & mask[index]));
}

// Route selection precedes address selection: virtual interfaces and arbitrary
// private addresses must never become the advertised reader.local destination.
export function selectLanAddress(routeOutput, tableOutput, interfaces) {
  const tableRoutes = routesFromTable(tableOutput);
  const primary = routeFromGet(routeOutput);
  const candidates = primary && (tableRoutes.length === 0 ||
    tableRoutes.some(route => route.interfaceName === primary.interfaceName))
    ? [primary, ...tableRoutes]
    : tableRoutes;
  for (const route of candidates) {
    const ipv4 = (interfaces[route.interfaceName] || []).filter(entry =>
      (entry.family === 'IPv4' || entry.family === 4) && !entry.internal &&
      usableAddress(entry.address));
    const selected = ipv4.find(entry => onGatewaySubnet(entry.address, entry.netmask, route.gateway)) ||
      ipv4.find(entry => !entry.netmask);
    if (selected) return { interfaceName: route.interfaceName, address: selected.address };
  }
  throw new Error('No gateway-routed LAN IPv4 address found. Connect to a LAN and try again.');
}
