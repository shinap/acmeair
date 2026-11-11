'use strict';

const fs = require('fs');
const path = require('path');

const STATUSES = ['queued', 'preparing', 'ready', 'picked_up', 'cancelled'];

/** Date string (YYYY-MM-DD) for the event day in the configured timezone. */
function eventDateFor(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/**
 * Tiny JSON-file order store. All writes happen synchronously in one Node
 * process, so order numbers are assigned strictly in the order requests arrive.
 */
class OrderStore {
  constructor({ dataDir, timezone }) {
    this.timezone = timezone;
    this.file = path.join(dataDir, 'orders.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.state = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : { nextId: 1, orders: [] };
  }

  _save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file); // atomic replace: a crash never leaves a half-written file
  }

  create(fields, now = new Date()) {
    const eventDate = eventDateFor(now, this.timezone);
    const sameDay = this.state.orders.filter((o) => o.eventDate === eventDate);
    const order = {
      id: this.state.nextId++,
      // Customer-facing number restarts at 1 every event day.
      number: sameDay.length ? Math.max(...sameDay.map((o) => o.number)) + 1 : 1,
      eventDate,
      createdAt: now.toISOString(),
      status: 'queued',
      statusHistory: [{ status: 'queued', at: now.toISOString() }],
      notifications: [],
      ...fields,
    };
    this.state.orders.push(order);
    this._save();
    return order;
  }

  get(id) {
    return this.state.orders.find((o) => o.id === Number(id)) || null;
  }

  /** Orders for a day, oldest first (first come, first served). */
  list({ eventDate, includeDone = true } = {}) {
    return this.state.orders
      .filter((o) => !eventDate || o.eventDate === eventDate)
      .filter((o) => includeDone || !['picked_up', 'cancelled'].includes(o.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  }

  setStatus(id, status, now = new Date()) {
    if (!STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
    const order = this.get(id);
    if (!order) return null;
    order.status = status;
    order.statusHistory.push({ status, at: now.toISOString() });
    this._save();
    return order;
  }

  addNotification(id, entry) {
    const order = this.get(id);
    if (!order) return;
    const now = new Date().toISOString();
    const last = order.notifications[order.notifications.length - 1];
    if (!entry.ok && last && last.kind === entry.kind && !last.ok) {
      // Another failed try (e.g. still offline): update the existing entry rather than
      // adding one per automatic retry, so the order file doesn't keep growing.
      Object.assign(last, entry, { at: now, attempts: (last.attempts || 1) + 1 });
    } else {
      order.notifications.push({ at: now, ...entry, ...(!entry.ok && { attempts: 1 }) });
    }
    this._save();
  }

  today(now = new Date()) {
    return eventDateFor(now, this.timezone);
  }
}

module.exports = { OrderStore, STATUSES, eventDateFor };
