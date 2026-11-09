'use strict';

const nodemailer = require('nodemailer');
const { formatPhone } = require('./phone');

const money = (n) => `$${Number(n).toFixed(2)}`;

function itemLines(order) {
  return order.items.map((i) => `${i.quantity} x ${i.name} (${money(i.price * i.quantity)})`);
}

function timeLabel(iso, timezone) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

/**
 * Sends texts (Twilio) and emails (SMTP). When credentials are missing it runs
 * in "dry run" mode and just prints what it would have sent, so the app can be
 * tried out before anything is set up.
 */
class Notifier {
  constructor(config, { fetchImpl = globalThis.fetch, transport } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    const t = config.twilio;
    this.smsEnabled = Boolean(t.accountSid && t.authToken && (t.from || t.messagingServiceSid));
    const e = config.email;
    this.emailEnabled = Boolean((transport || e.host) && e.to);
    if (this.emailEnabled) {
      this.transport = transport || nodemailer.createTransport({
        host: e.host,
        port: e.port,
        secure: e.secure,
        auth: e.user ? { user: e.user, pass: e.pass } : undefined,
      });
    }
  }

  async sendSms(to, body) {
    if (!this.smsEnabled) {
      console.log(`[dry-run SMS to ${to}] ${body}`);
      return { ok: true, dryRun: true };
    }
    const { accountSid, authToken, from, messagingServiceSid } = this.config.twilio;
    const params = new URLSearchParams({ To: to, Body: body });
    if (messagingServiceSid) params.set('MessagingServiceSid', messagingServiceSid);
    else params.set('From', from);
    const res = await this.fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Twilio error ${res.status}`);
    return { ok: true, id: data.sid };
  }

  async sendEmail(subject, text) {
    if (!this.emailEnabled) {
      console.log(`[dry-run EMAIL] ${subject}\n${text}\n`);
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

  orderPlacedSms(order) {
    return `Hi ${order.customerName}! Thanks for supporting the ${this.config.eventName}. `
      + `Your order #${order.number} (${money(order.total)}) is in line. We'll text you when it's ready. `
      + 'Reply STOP to opt out.';
  }

  orderReadySms(order) {
    return `${order.customerName}, your order #${order.number} is ready! `
      + `Please pick it up at the ${this.config.eventName} table.`;
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
      `Phone:     ${order.phone ? formatPhone(order.phone) : '(none)'}`,
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
