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

app.listen(config.port, () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);
  console.log(`${config.eventName} ordering is running.`);
  console.log(`  Cashier:      http://localhost:${config.port}/`);
  console.log(`  Order queue:  http://localhost:${config.port}/queue.html`);
  if (lan) console.log(`  Other devices on this Wi-Fi: http://${lan.address}:${config.port}/`);
  console.log(`  Email:  ${notifier.emailEnabled ? `LIVE to ${config.email.to}` : `dry run - printed here, not sent (would go to ${config.email.to})`}`);
  if (!config.staffPin) console.log('  Warning: STAFF_PIN is not set, so anyone on the network can open these pages.');
});
