'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const menu = require('../menu.json');
const { OrderStore } = require('../src/store');
const { Notifier } = require('../src/notify');
const { createApp } = require('../src/app');
const { normalizePhone } = require('../src/phone');

function setup({ staffPin = '', twilio = {}, failSms = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemonade-'));
  const config = {
    port: 0, timezone: 'America/New_York', eventName: 'Test Fundraiser', staffPin, dataDir,
    defaultCountryCode: '1',
    twilio: { accountSid: 'AC1', authToken: 'tok', from: '+15550000000', messagingServiceSid: '', ...twilio },
    email: { host: '', port: 587, secure: false, user: '', pass: '', from: 'stand@example.com', to: 'owner@example.com' },
  };
  const sms = [];
  const emails = [];
  const fetchImpl = async (url, opts) => {
    sms.push(Object.fromEntries(new URLSearchParams(opts.body.toString())));
    if (failSms) return { ok: false, status: 400, json: async () => ({ message: 'Invalid To number' }) };
    return { ok: true, status: 201, json: async () => ({ sid: `SM${sms.length}` }) };
  };
  const transport = { sendMail: async (m) => { emails.push(m); return { messageId: `m${emails.length}` }; } };
  const store = new OrderStore({ dataDir, timezone: config.timezone });
  const notifier = new Notifier(config, { fetchImpl, transport });
  const app = createApp({ config, menu, store, notifier });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, server, store, sms, emails, dataDir });
    });
  });
}

const settle = () => new Promise((r) => setTimeout(r, 30));
const post = (base, url, body, headers = {}) => fetch(base + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const patch = (base, url, body) => fetch(base + url, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const sampleOrder = (overrides = {}) => ({
  customerName: 'Jane',
  phone: '(555) 123-4567',
  smsOptIn: true,
  items: [{ id: 'classic-lemonade', quantity: 2 }, { id: 'chicken-pastry', quantity: 1 }],
  payment: { method: 'Cash', status: 'paid', amountReceived: '20' },
  ...overrides,
});

test('places an order, prices it from the menu, texts the customer and emails the organizer', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());

  const res = await post(ctx.base, '/api/orders', sampleOrder({
    items: [{ id: 'classic-lemonade', quantity: 2, price: 0.01 }, { id: 'chicken-pastry', quantity: 1 }],
  }));
  assert.equal(res.status, 201);
  const order = await res.json();
  assert.equal(order.number, 1);
  assert.equal(order.total, 11); // 2 x $3 + $5; the browser's price is ignored
  assert.equal(order.phone, '+15551234567');
  assert.deepEqual(
    { method: order.payment.method, status: order.payment.status, received: order.payment.amountReceived, change: order.payment.change },
    { method: 'Cash', status: 'paid', received: 20, change: 9 },
  );

  await settle();
  assert.equal(ctx.sms.length, 1);
  assert.equal(ctx.sms[0].To, '+15551234567');
  assert.match(ctx.sms[0].Body, /order #1 \(\$11\.00\)/);
  assert.equal(ctx.emails.length, 1);
  assert.equal(ctx.emails[0].to, 'owner@example.com');
  assert.match(ctx.emails[0].subject, /^Order #1 - Jane - \$11\.00/);
  assert.match(ctx.emails[0].text, /2 x Classic Lemonade/);

  const saved = ctx.store.get(order.id);
  assert.deepEqual(saved.notifications.map((n) => [n.kind, n.ok]).sort(), [['email', true], ['placed', true]]);
});

test('queue lists orders first come, first served and numbers them in sequence', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  for (const name of ['Ann', 'Ben', 'Cal']) {
    await post(ctx.base, '/api/orders', sampleOrder({ customerName: name }));
  }
  const list = await (await fetch(`${ctx.base}/api/orders`)).json();
  assert.deepEqual(list.map((o) => [o.number, o.customerName]), [[1, 'Ann'], [2, 'Ben'], [3, 'Cal']]);
});

test('marking ready texts the customer once; picked-up orders leave the active queue', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  const order = await (await post(ctx.base, '/api/orders', sampleOrder())).json();
  await settle();

  await patch(ctx.base, `/api/orders/${order.id}/status`, { status: 'ready' });
  await patch(ctx.base, `/api/orders/${order.id}/status`, { status: 'ready' });
  await settle();
  const readyTexts = ctx.sms.filter((m) => /is ready/.test(m.Body));
  assert.equal(readyTexts.length, 1);

  await patch(ctx.base, `/api/orders/${order.id}/status`, { status: 'picked_up' });
  const active = await (await fetch(`${ctx.base}/api/orders?active=1`)).json();
  assert.equal(active.length, 0);
});

test('no texts without a phone number or without the customer agreeing', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  await post(ctx.base, '/api/orders', sampleOrder({ phone: '' }));
  await post(ctx.base, '/api/orders', sampleOrder({ smsOptIn: false }));
  await settle();
  assert.equal(ctx.sms.length, 0);
  assert.equal(ctx.emails.length, 2);
});

test('pay-at-pickup orders can be marked paid later', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  const order = await (await post(ctx.base, '/api/orders', sampleOrder({ payment: { method: 'Zelle', status: 'unpaid' } }))).json();
  assert.equal(order.payment.status, 'unpaid');
  const updated = await (await patch(ctx.base, `/api/orders/${order.id}/payment`, { method: 'Cash', status: 'paid' })).json();
  assert.equal(updated.payment.status, 'paid');
  assert.equal(updated.payment.amountReceived, 11);
});

test('a failed text is recorded on the order and the order still goes through', async (t) => {
  const ctx = await setup({ failSms: true });
  t.after(() => ctx.server.close());
  const res = await post(ctx.base, '/api/orders', sampleOrder());
  assert.equal(res.status, 201);
  const order = await res.json();
  await settle();
  const failed = ctx.store.get(order.id).notifications.find((n) => n.kind === 'placed');
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'Invalid To number');
});

test('rejects bad input', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  const cases = [
    [sampleOrder({ customerName: ' ' }), /name is required/],
    [sampleOrder({ items: [] }), /at least one item/],
    [sampleOrder({ items: [{ id: 'free-car', quantity: 1 }] }), /Unknown menu item/],
    [sampleOrder({ items: [{ id: 'game-ticket', quantity: 0 }] }), /Bad quantity/],
    [sampleOrder({ phone: '123' }), /phone number/],
    [sampleOrder({ payment: { method: 'Bitcoin', status: 'paid' } }), /how the customer is paying/],
    [sampleOrder({ payment: { method: 'Cash', status: 'paid', amountReceived: '5' } }), /at least the total/],
  ];
  for (const [body, msg] of cases) {
    const res = await post(ctx.base, '/api/orders', body);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, msg);
  }
});

test('staff PIN protects every page and API', async (t) => {
  const ctx = await setup({ staffPin: '4321' });
  t.after(() => ctx.server.close());
  assert.equal((await fetch(`${ctx.base}/`)).status, 401);
  assert.equal((await fetch(`${ctx.base}/api/orders`)).status, 401);
  const wrong = `Basic ${Buffer.from('staff:1111').toString('base64')}`;
  assert.equal((await fetch(`${ctx.base}/api/orders`, { headers: { Authorization: wrong } })).status, 401);
  const right = `Basic ${Buffer.from('staff:4321').toString('base64')}`;
  assert.equal((await fetch(`${ctx.base}/api/orders`, { headers: { Authorization: right } })).status, 200);
});

test('orders survive a restart and CSV export works', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  await post(ctx.base, '/api/orders', sampleOrder({ customerName: 'Doe, John' }));
  const reopened = new OrderStore({ dataDir: ctx.dataDir, timezone: 'America/New_York' });
  assert.equal(reopened.list().length, 1);
  const csv = await (await fetch(`${ctx.base}/api/orders.csv`)).text();
  assert.match(csv, /^order_number,placed_at,customer/);
  assert.match(csv, /"Doe, John"/);
});

test('order numbers restart each event day', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemonade-'));
  const store = new OrderStore({ dataDir, timezone: 'America/New_York' });
  const base = { customerName: 'x', items: [], total: 0, payment: {} };
  assert.equal(store.create(base, new Date('2026-11-08T15:00:00Z')).number, 1);
  assert.equal(store.create(base, new Date('2026-11-08T16:00:00Z')).number, 2);
  assert.equal(store.create(base, new Date('2026-12-13T15:00:00Z')).number, 1);
});

test('normalizes US phone numbers', () => {
  assert.equal(normalizePhone('555-123-4567'), '+15551234567');
  assert.equal(normalizePhone('1 (555) 123 4567'), '+15551234567');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('12345'), null);
});
