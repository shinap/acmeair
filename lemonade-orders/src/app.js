'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { normalizePhone } = require('./phone');
const { STATUSES } = require('./store');

const round2 = (n) => Math.round(n * 100) / 100;
const cleanText = (v, max) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

class ValidationError extends Error {}

/** Optional staff PIN, checked with HTTP Basic auth (any username, PIN as password). */
function pinGuard(pin) {
  if (!pin) return (req, res, next) => next();
  const expected = crypto.createHash('sha256').update(pin).digest();
  return (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    const supplied = scheme === 'Basic' && encoded
      ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':')
      : '';
    const actual = crypto.createHash('sha256').update(supplied).digest();
    if (crypto.timingSafeEqual(expected, actual)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Lemonade staff", charset="UTF-8"');
    return res.status(401).send('Staff PIN required');
  };
}

/** Turn the cashier's form into a trusted order (prices always come from the menu, never the browser). */
function buildOrder(body, { menu, defaultCountryCode }) {
  const customerName = cleanText(body.customerName, 60);
  if (!customerName) throw new ValidationError('Customer name is required.');

  let phone = null;
  if (cleanText(body.phone, 30)) {
    phone = normalizePhone(body.phone, defaultCountryCode);
    if (!phone) throw new ValidationError('That phone number does not look right.');
  }
  const smsOptIn = Boolean(phone && body.smsOptIn);

  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const items = [];
  for (const line of Array.isArray(body.items) ? body.items : []) {
    const item = byId.get(line.id);
    const quantity = Number(line.quantity);
    if (!item) throw new ValidationError(`Unknown menu item: ${line.id}`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new ValidationError(`Bad quantity for ${item.name}.`);
    const flavors = pickFlavors(item, line.flavors);
    const name = flavors.length ? `${item.name} (${flavors.join(' + ')})` : item.name;
    const existing = items.find((i) => i.id === item.id && i.name === name);
    if (existing) existing.quantity += quantity;
    else {
      items.push({
        id: item.id, name, category: item.category, price: item.price, quantity,
        ...(flavors.length && { flavors }),
      });
    }
  }
  if (!items.length) throw new ValidationError('Add at least one item.');
  const total = round2(items.reduce((sum, i) => sum + i.price * i.quantity, 0));

  const payment = buildPayment(body.payment, total, menu);

  return {
    customerName,
    phone,
    smsOptIn,
    items,
    total,
    payment,
    notes: cleanText(body.notes, 200),
    cashier: cleanText(body.cashier, 40),
  };
}

/** Flavors chosen for an item, in menu order. Items with flavors need at least one; mixes are allowed. */
function pickFlavors(item, chosen) {
  if (!item.flavors) {
    if (Array.isArray(chosen) && chosen.length) throw new ValidationError(`${item.name} has no flavors.`);
    return [];
  }
  const wanted = new Set(Array.isArray(chosen) ? chosen : []);
  for (const f of wanted) {
    if (!item.flavors.includes(f)) throw new ValidationError(`Unknown ${item.name.toLowerCase()} flavor: ${f}`);
  }
  if (!wanted.size) throw new ValidationError(`Pick at least one flavor for the ${item.name.toLowerCase()}.`);
  return item.flavors.filter((f) => wanted.has(f));
}

function buildPayment(input = {}, total, menu) {
  const method = cleanText(input.method, 40);
  if (!menu.paymentMethods.includes(method)) throw new ValidationError('Pick how the customer is paying.');
  if (input.status === 'unpaid') {
    return { method, status: 'unpaid', amountReceived: 0, change: 0 };
  }
  const amountReceived = input.amountReceived === undefined || input.amountReceived === ''
    ? total
    : round2(Number(input.amountReceived));
  if (!Number.isFinite(amountReceived) || amountReceived < total) {
    throw new ValidationError(`Amount received must be at least the total ($${total.toFixed(2)}).`);
  }
  return { method, status: 'paid', amountReceived, change: round2(amountReceived - total), recordedAt: new Date().toISOString() };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function createApp({ config, menu, store, notifier }) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use(pinGuard(config.staffPin));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Notifications run in the background so the cashier is never kept waiting;
  // each result (sent / failed) is saved on the order and shown in the queue.
  const notify = (order, kind) => {
    const task = (async () => {
      if (kind === 'email') {
        const { subject, text } = notifier.organizerEmail(order);
        return notifier.sendEmail(subject, text);
      }
      if (!order.phone || !order.smsOptIn) return null;
      const body = kind === 'ready' ? notifier.orderReadySms(order) : notifier.orderPlacedSms(order);
      return notifier.sendSms(order.phone, body);
    })();
    return task
      .then((r) => r && store.addNotification(order.id, { kind, ok: true, dryRun: Boolean(r.dryRun) }))
      .catch((err) => {
        console.error(`Notification "${kind}" for order ${order.id} failed:`, err.message);
        store.addNotification(order.id, { kind, ok: false, error: err.message });
      });
  };
  app.locals.notify = notify;

  app.get('/api/config', (req, res) => {
    res.json({
      eventName: config.eventName,
      today: store.today(),
      timezone: config.timezone,
      items: menu.items,
      paymentMethods: menu.paymentMethods,
      sms: notifier.smsEnabled ? 'live' : 'dry-run',
      email: notifier.emailEnabled ? 'live' : 'dry-run',
    });
  });

  app.post('/api/orders', (req, res) => {
    const fields = buildOrder(req.body || {}, { menu, defaultCountryCode: config.defaultCountryCode });
    const order = store.create(fields);
    res.status(201).json(order);
    notify(order, 'placed');
    notify(order, 'email');
  });

  app.get('/api/orders', (req, res) => {
    const eventDate = req.query.date || store.today();
    res.json(store.list({ eventDate, includeDone: req.query.active !== '1' }));
  });

  app.get('/api/orders.csv', (req, res) => {
    const eventDate = req.query.date || store.today();
    const header = ['order_number', 'placed_at', 'customer', 'phone', 'items', 'total', 'payment_method', 'payment_status', 'amount_received', 'change', 'status', 'notes', 'cashier'];
    const rows = store.list({ eventDate }).map((o) => [
      o.number, o.createdAt, o.customerName, o.phone || '',
      o.items.map((i) => `${i.quantity} x ${i.name}`).join('; '),
      o.total.toFixed(2), o.payment.method, o.payment.status,
      o.payment.amountReceived.toFixed(2), o.payment.change.toFixed(2),
      o.status, o.notes, o.cashier,
    ]);
    res.type('text/csv').attachment(`orders-${eventDate}.csv`);
    res.send([header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
  });

  app.patch('/api/orders/:id/status', (req, res) => {
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) throw new ValidationError('Unknown status.');
    const before = store.get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Order not found.' });
    const wasReady = before.status === 'ready';
    const order = store.setStatus(req.params.id, status);
    res.json(order);
    if (status === 'ready' && !wasReady) notify(order, 'ready');
  });

  app.patch('/api/orders/:id/payment', (req, res) => {
    const order = store.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    order.payment = buildPayment(req.body || {}, order.total, menu);
    store._save();
    res.json(order);
  });

  app.post('/api/orders/:id/resend', (req, res) => {
    const order = store.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const kind = (req.body || {}).kind;
    if (!['placed', 'ready', 'email'].includes(kind)) throw new ValidationError('Unknown notification.');
    notify(order, kind);
    res.status(202).json({ ok: true });
  });

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

module.exports = { createApp, buildOrder, ValidationError };
