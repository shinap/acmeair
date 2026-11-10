'use strict';

const nodemailer = require('nodemailer');

const money = (n) => `$${Number(n).toFixed(2)}`;

function itemLines(order) {
  return order.items.map((i) => `${i.quantity} x ${i.name} (${money(i.price * i.quantity)})`);
}

function timeLabel(iso, timezone) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

/**
 * Emails each new order (SMTP). When SMTP isn't set up it runs in "dry run"
 * mode and just prints the email it would have sent, so the app can be tried
 * out before anything is configured.
 */
class Notifier {
  constructor(config, { transport } = {}) {
    this.config = config;
    const e = config.email;
    // Live only when the settings are complete; a half-filled .env (e.g. the
    // App Password still blank) stays in test mode instead of failing every order.
    this.emailEnabled = Boolean(transport || (e.host && e.to && (!e.user || e.pass)));
    if (this.emailEnabled) {
      this.transport = transport || nodemailer.createTransport({
        host: e.host,
        port: e.port,
        secure: e.secure,
        auth: e.user ? { user: e.user, pass: e.pass } : undefined,
      });
    }
  }

  async sendEmail(subject, text) {
    if (!this.emailEnabled) {
      console.log(`[dry-run EMAIL to ${this.config.email.to}] ${subject}\n${text}\n`);
      return { ok: true, dryRun: true };
    }
    const info = await this.transport.sendMail({
      from: this.config.email.from,
      to: this.config.email.to,
      subject,
      text,
    });
    return { ok: true, id: info.messageId };
  }

  organizerEmail(order) {
    const tz = this.config.timezone;
    const p = order.payment;
    const subject = `Order #${order.number} - ${order.customerName} - ${money(order.total)} - ${timeLabel(order.createdAt, tz)}`;
    const text = [
      `New order for ${this.config.eventName} (${order.eventDate})`,
      '',
      `Order #:   ${order.number}`,
      `Placed:    ${timeLabel(order.createdAt, tz)}`,
      `Customer:  ${order.customerName}`,
      '',
      'Items:',
      ...itemLines(order).map((l) => `  - ${l}`),
      '',
      `Total:     ${money(order.total)}`,
      `Payment:   ${p.method} - ${p.status === 'paid' ? `paid ${money(p.amountReceived)}` : 'NOT PAID YET'}`,
      p.status === 'paid' && p.change > 0 ? `Change:    ${money(p.change)}` : null,
      order.notes ? `Notes:     ${order.notes}` : null,
      `Cashier:   ${order.cashier || '-'}`,
      '',
      'Fill orders in the order they were placed (lowest order # first).',
    ].filter((l) => l !== null).join('\n');
    return { subject, text };
  }
}

module.exports = { Notifier, money };
