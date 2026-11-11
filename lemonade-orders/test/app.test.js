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

// mail.down = true makes the fake mail server act offline; mail.refuseLogin = true makes it reject the password.
function setup({ staffPin = '', failEmail = false, delayMs = 0, emailRetryMs = 0, mail = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemonade-'));
  const config = {
    port: 0, timezone: 'America/New_York', eventName: 'Test Fundraiser', staffPin, dataDir, emailRetryMs,
    email: { host: '', port: 587, secure: false, user: '', pass: '', from: 'stand@example.com', to: 'lrcncsocial@gmail.com' },
  };
  const emails = [];
  const transport = {
    sendMail: async (m) => {
      emails.push(m);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (failEmail) throw new Error('Invalid login');
      if (mail.down) throw Object.assign(new Error('getaddrinfo ENOTFOUND smtp.gmail.com'), { code: 'EDNS' });
      if (mail.refuseLogin) throw Object.assign(new Error('Invalid login: 535 5.7.8'), { code: 'EAUTH', responseCode: 535 });
      return { messageId: `m${emails.length}` };
    },
  };
  const store = new OrderStore({ dataDir, timezone: config.timezone });
  const notifier = new Notifier(config, { transport });
  const app = createApp({ config, menu, store, notifier });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, server, store, emails, dataDir, app });
    });
  });
}

const settle = () => new Promise((r) => setTimeout(r, 30));
const post = (base, url, body) => fetch(base + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const patch = (base, url, body) => fetch(base + url, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const sampleOrder = (overrides = {}) => ({
  customerName: 'Jane',
  items: [{ id: 'lemonade', flavors: ['Strawberry'], quantity: 2 }, { id: 'chicken-pastry', quantity: 1 }],
  payment: { method: 'Cash', status: 'paid', amountReceived: '20' },
  ...overrides,
});

test('places an order, prices it from the menu, and emails it to the organizer', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());

  const res = await post(ctx.base, '/api/orders', sampleOrder({
    items: [{ id: 'lemonade', flavors: ['Strawberry'], quantity: 2, price: 0.01 }, { id: 'chicken-pastry', quantity: 1 }],
  }));
  assert.equal(res.status, 201);
  const order = await res.json();
  assert.equal(order.number, 1);
  assert.equal(order.total, 14); // 2 x $5 + $4; the browser's price is ignored
  assert.equal(order.customerName, 'Jane');
  assert.equal(order.phone, undefined);
  assert.deepEqual(
    { method: order.payment.method, status: order.payment.status, received: order.payment.amountReceived, change: order.payment.change },
    { method: 'Cash', status: 'paid', received: 20, change: 6 },
  );

  await settle();
  assert.equal(ctx.emails.length, 1);
  assert.equal(ctx.emails[0].to, 'lrcncsocial@gmail.com');
  assert.match(ctx.emails[0].subject, /^Order #1 - Jane - \$14\.00 - /);
  assert.match(ctx.emails[0].text, /Customer:  Jane/);
  assert.match(ctx.emails[0].text, /2 x Lemonade \(Strawberry\) \(\$10\.00\)/);
  assert.doesNotMatch(ctx.emails[0].text, /Phone/);
  assert.deepEqual(ctx.store.get(order.id).notifications.map((n) => [n.kind, n.ok]), [['email', true]]);
});

test('a phone number sent by an old page is ignored', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  const order = await (await post(ctx.base, '/api/orders', sampleOrder({ phone: '555-123-4567', smsOptIn: true }))).json();
  assert.equal(order.phone, undefined);
  assert.equal(order.smsOptIn, undefined);
  const csv = await (await fetch(`${ctx.base}/api/orders.csv`)).text();
  assert.doesNotMatch(csv, /555/);
});

test('lemonade flavors can be mixed; each mix is its own line, same mix in any order merges', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  const order = await (await post(ctx.base, '/api/orders', sampleOrder({
    items: [
      { id: 'lemonade', flavors: ['Coconut', 'Strawberry'], quantity: 1 },
      { id: 'lemonade', flavors: ['Strawberry', 'Coconut'], quantity: 1 },
      { id: 'lemonade', flavors: ['Watermelon', 'Passion Fruit'], quantity: 1 },
      { id: 'games', quantity: 1 },
    ],
  }))).json();
  assert.deepEqual(order.items.map((i) => [i.name, i.quantity]), [
    ['Lemonade (Strawberry + Coconut)', 2],
    ['Lemonade (Watermelon + Passion Fruit)', 1],
    ['Games', 1],
  ]);
  assert.equal(order.total, 20);
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

test('status changes move orders through the queue without sending more email', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  const order = await (await post(ctx.base, '/api/orders', sampleOrder())).json();
  await patch(ctx.base, `/api/orders/${order.id}/status`, { status: 'ready' });
  await patch(ctx.base, `/api/orders/${order.id}/status`, { status: 'picked_up' });
  await settle();
  assert.equal(ctx.emails.length, 1);
  const active = await (await fetch(`${ctx.base}/api/orders?active=1`)).json();
  assert.equal(active.length, 0);
  assert.equal((await patch(ctx.base, '/api/orders/999/status', { status: 'ready' })).status, 404);
});

test('pay-at-pickup orders can be marked paid later', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  const order = await (await post(ctx.base, '/api/orders', sampleOrder({ payment: { method: 'Zelle', status: 'unpaid' } }))).json();
  assert.equal(order.payment.status, 'unpaid');
  const updated = await (await patch(ctx.base, `/api/orders/${order.id}/payment`, { method: 'Cash', status: 'paid' })).json();
  assert.equal(updated.payment.status, 'paid');
  assert.equal(updated.payment.amountReceived, 14);
});

test('a failed email is recorded on the order, the order still goes through, and it can be retried', async (t) => {
  const ctx = await setup({ failEmail: true });
  t.after(() => ctx.server.close());
  const res = await post(ctx.base, '/api/orders', sampleOrder());
  assert.equal(res.status, 201);
  const order = await res.json();
  await settle();
  const failed = ctx.store.get(order.id).notifications.find((n) => n.kind === 'email');
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'Invalid login');

  assert.equal((await post(ctx.base, `/api/orders/${order.id}/resend-email`, {})).status, 202);
  await settle();
  assert.equal(ctx.emails.length, 2);
});

test('rejects bad input', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  const cases = [
    [sampleOrder({ customerName: '  ' }), /customer's name/],
    [sampleOrder({ items: [] }), /at least one item/],
    [sampleOrder({ items: [{ id: 'free-car', quantity: 1 }] }), /Unknown menu item/],
    [sampleOrder({ items: [{ id: 'games', quantity: 0 }] }), /Bad quantity/],
    [sampleOrder({ items: [{ id: 'lemonade', quantity: 1 }] }), /at least one flavor/],
    [sampleOrder({ items: [{ id: 'lemonade', flavors: ['Grape'], quantity: 1 }] }), /Unknown lemonade flavor/],
    [sampleOrder({ items: [{ id: 'games', flavors: ['Coconut'], quantity: 1 }] }), /has no flavors/],
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
  assert.match(csv, /^order_number,placed_at,customer,items,total/);
  assert.match(csv, /"Doe, John"/);
});

test('order numbers restart each event day', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemonade-'));
  const store = new OrderStore({ dataDir, timezone: 'America/New_York' });
  const base = { items: [], total: 0, payment: {} };
  assert.equal(store.create(base, new Date('2026-11-08T15:00:00Z')).number, 1);
  assert.equal(store.create(base, new Date('2026-11-08T16:00:00Z')).number, 2);
  assert.equal(store.create(base, new Date('2026-12-13T15:00:00Z')).number, 1);
});

test('emails go to lrcncsocial@gmail.com unless ORGANIZER_EMAIL says otherwise', () => {
  delete require.cache[require.resolve('../src/config')];
  const saved = process.env.ORGANIZER_EMAIL;
  delete process.env.ORGANIZER_EMAIL;
  try {
    assert.equal(require('../src/config').email.to, 'lrcncsocial@gmail.com');
  } finally {
    if (saved !== undefined) process.env.ORGANIZER_EMAIL = saved;
    delete require.cache[require.resolve('../src/config')];
  }
});

test('half-filled email settings stay in test mode instead of failing every order', () => {
  const base = { host: 'smtp.gmail.com', port: 587, secure: false, user: 'lrcncsocial@gmail.com', from: '', to: 'lrcncsocial@gmail.com' };
  assert.equal(new Notifier({ email: { ...base, pass: '' } }).emailEnabled, false);
  assert.equal(new Notifier({ email: { ...base, host: '', pass: 'secret' } }).emailEnabled, false);
  assert.equal(new Notifier({ email: { ...base, pass: 'secret' } }).emailEnabled, true);
});

test('retry email is refused once the email went through, and a double tap sends only once', async (t) => {
  const ok = await setup();
  t.after(() => ok.server.close());
  const order = await (await post(ok.base, '/api/orders', sampleOrder())).json();
  await settle();
  assert.equal((await post(ok.base, `/api/orders/${order.id}/resend-email`, {})).status, 409);
  assert.equal(ok.emails.length, 1);

  const bad = await setup({ failEmail: true, delayMs: 50 }); // a slow mail server
  t.after(() => bad.server.close());
  const failed = await (await post(bad.base, '/api/orders', sampleOrder())).json();
  await new Promise((r) => setTimeout(r, 100)); // let the first attempt fail
  const [first, second] = await Promise.all([
    post(bad.base, `/api/orders/${failed.id}/resend-email`, {}),
    post(bad.base, `/api/orders/${failed.id}/resend-email`, {}),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [202, 409]);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(bad.emails.length, 2); // the original attempt + one retry
});

test('an error while building the email is recorded on the order, not lost', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.server.close());
  const realBuild = Notifier.prototype.organizerEmail;
  Notifier.prototype.organizerEmail = () => { throw new Error('bad order data'); };
  t.after(() => { Notifier.prototype.organizerEmail = realBuild; });
  const res = await post(ctx.base, '/api/orders', sampleOrder());
  assert.equal(res.status, 201);
  const order = await res.json();
  await settle();
  const n = ctx.store.get(order.id).notifications.at(-1);
  assert.deepEqual([n.kind, n.ok, n.error], ['email', false, 'bad order data']);
});

test('emails that failed while offline are resent automatically once back online', async (t) => {
  const mail = { down: true };
  const ctx = await setup({ mail });
  t.after(() => ctx.server.close());
  const first = await (await post(ctx.base, '/api/orders', sampleOrder({ customerName: 'Ann' }))).json();
  const second = await (await post(ctx.base, '/api/orders', sampleOrder({ customerName: 'Ben' }))).json();
  const cancelled = await (await post(ctx.base, '/api/orders', sampleOrder({ customerName: 'Cal' }))).json();
  await patch(ctx.base, `/api/orders/${cancelled.id}/status`, { status: 'cancelled' });
  await settle();

  // Still offline: one try, then the rest wait (no pile-up of entries on the order).
  assert.equal(await ctx.app.locals.retryFailedEmails(), 0);
  const ann = ctx.store.get(first.id).notifications;
  assert.equal(ann.length, 1);
  assert.deepEqual([ann[0].ok, ann[0].attempts], [false, 2]);
  assert.equal(ctx.store.get(second.id).notifications[0].attempts, 1);

  // Back online: everything not cancelled goes out, oldest first.
  mail.down = false;
  const before = ctx.emails.length;
  assert.equal(await ctx.app.locals.retryFailedEmails(), 2);
  assert.deepEqual(ctx.emails.slice(before).map((m) => m.subject.split(' - ')[1]), ['Ann', 'Ben']);
  assert.equal(ctx.store.get(first.id).notifications.at(-1).ok, true);
  assert.equal(ctx.store.get(cancelled.id).notifications.at(-1).ok, false);
  assert.equal(await ctx.app.locals.retryFailedEmails(), 0); // nothing left to send
});

test('the resend runs on its own timer', async (t) => {
  const mail = { down: true };
  const ctx = await setup({ mail, emailRetryMs: 40 });
  t.after(() => ctx.server.close());
  const order = await (await post(ctx.base, '/api/orders', sampleOrder())).json();
  await settle();
  mail.down = false;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ctx.store.get(order.id).notifications.at(-1).ok, true);
});

test('automatic resend pauses when Gmail refuses the login, and the queue says why', async (t) => {
  const mail = { refuseLogin: true };
  const ctx = await setup({ mail });
  t.after(() => ctx.server.close());
  const order = await (await post(ctx.base, '/api/orders', sampleOrder())).json();
  await settle();
  const tries = ctx.emails.length;
  assert.equal(await ctx.app.locals.retryFailedEmails(), 0);
  assert.equal(ctx.emails.length, tries); // didn't try Gmail again with the bad password
  assert.equal(ctx.store.get(order.id).notifications.at(-1).loginRefused, true);
});
