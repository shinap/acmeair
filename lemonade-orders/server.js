'use strict';

const os = require('os');
const config = require('./src/config');
const menu = require('./menu.json');
const { OrderStore } = require('./src/store');
const { Notifier } = require('./src/notify');
const { createApp } = require('./src/app');

const store = new OrderStore({ dataDir: config.dataDir, timezone: config.timezone });
const notifier = new Notifier(config);
const app = createApp({ config, menu, store, notifier });

// Addresses tablets and phones on the same Wi-Fi can use to reach this laptop.
// Wi-Fi first; virtual adapters (VPNs, virtual machines, WSL) are left out.
function lanAddresses() {
  const virtual = /vethernet|virtual|vmware|vbox|wsl|hyper-v|loopback|bluetooth|docker|tailscale|zerotier/i;
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !virtual.test(name))
    .flatMap(([name, addrs]) => addrs
      .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
      .map((a) => ({ name, address: a.address })))
    .sort((a, b) => Number(/wi-?fi|wlan|wireless/i.test(b.name)) - Number(/wi-?fi|wlan|wireless/i.test(a.name)));
}

app.listen(config.port, () => {
  const lan = lanAddresses();
  console.log(`${config.eventName} ordering is running.`);
  console.log(`  Cashier:      http://localhost:${config.port}/`);
  console.log(`  Order queue:  http://localhost:${config.port}/queue.html`);
  if (lan.length) {
    console.log('  On tablets and phones connected to the same Wi-Fi, open:');
    for (const { name, address } of lan) console.log(`      http://${address}:${config.port}/    (${name})`);
    console.log('    This address changes when you join a different network, so check it at each event.');
  } else {
    console.log('  Not connected to a network, so other devices cannot reach this laptop yet.');
  }
  console.log(`  Email:  ${notifier.emailEnabled ? `LIVE to ${config.email.to}` : `dry run - printed here, not sent (would go to ${config.email.to})`}`);
  if (!config.staffPin) console.log('  Warning: STAFF_PIN is not set, so anyone on the network can open these pages.');
});
