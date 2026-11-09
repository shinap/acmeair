'use strict';

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n).toFixed(2)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let config;
let orders = [];

const STATUS_LABEL = { queued: 'Waiting', preparing: 'Making it', ready: 'Ready for pickup', picked_up: 'Picked up', cancelled: 'Cancelled' };

function clock(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' });
}

function prettyPhone(p) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
}

function waited(iso) {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  return mins < 1 ? 'just now' : `${mins} min ago`;
}

function notificationBadges(o) {
  const latest = {};
  for (const n of o.notifications) latest[n.kind] = n;
  const label = { placed: 'Text', ready: 'Ready text', email: 'Email' };
  return Object.entries(latest).map(([kind, n]) => n.ok
    ? `<span class="badge ok">${label[kind]} ${n.dryRun ? 'logged' : 'sent'}</span>`
    : `<span class="badge fail" title="${esc(n.error)}">${label[kind]} failed</span>
       <button class="btn" data-resend="${kind}" data-id="${o.id}">Retry ${label[kind].toLowerCase()}</button>`).join(' ');
}

function actions(o) {
  const b = [];
  if (o.status === 'queued') b.push(`<button class="btn" data-status="preparing" data-id="${o.id}">Start making</button>`);
  if (o.status === 'queued' || o.status === 'preparing') {
    b.push(`<button class="btn primary" data-status="ready" data-id="${o.id}">Ready${o.phone && o.smsOptIn ? ' (text them)' : ''}</button>`);
  }
  if (o.status === 'ready') b.push(`<button class="btn primary" data-status="picked_up" data-id="${o.id}">Picked up</button>`);
  if (o.payment.status === 'unpaid' && o.status !== 'cancelled') b.push(`<button class="btn" data-pay="${o.id}">Mark paid</button>`);
  if (!['picked_up', 'cancelled'].includes(o.status)) b.push(`<button class="btn warn" data-status="cancelled" data-id="${o.id}">Cancel</button>`);
  if (['picked_up', 'cancelled'].includes(o.status)) b.push(`<button class="btn" data-status="queued" data-id="${o.id}">Undo</button>`);
  return b.join('');
}

function render() {
  const active = orders.filter((o) => !['picked_up', 'cancelled'].includes(o.status));
  const valid = orders.filter((o) => o.status !== 'cancelled');
  const collected = valid.filter((o) => o.payment.status === 'paid').reduce((s, o) => s + o.total, 0);
  const owed = valid.filter((o) => o.payment.status === 'unpaid').reduce((s, o) => s + o.total, 0);
  $('stats').innerHTML = `<strong>${active.length}</strong> in line &middot; ${valid.length} orders today &middot; `
    + `${money(collected)} collected${owed ? ` &middot; <strong>${money(owed)} unpaid</strong>` : ''}`;

  const shown = $('showDone').checked ? orders : active;
  const nextId = active.find((o) => o.status !== 'ready')?.id;
  $('queue').innerHTML = shown.map((o) => `
    <article class="panel order status-${o.status}${o.id === nextId ? ' next' : ''}">
      <div class="num">#${o.number}<small>${clock(o.createdAt)}<br>${waited(o.createdAt)}</small></div>
      <div>
        <div class="who">${esc(o.customerName)}</div>
        <div>
          <span class="badge status">${o.id === nextId ? 'Next up &middot; ' : ''}${STATUS_LABEL[o.status]}</span>
          ${o.payment.status === 'paid'
            ? `<span class="badge paid">Paid ${money(o.total)} &middot; ${esc(o.payment.method)}</span>`
            : `<span class="badge unpaid">UNPAID ${money(o.total)} &middot; ${esc(o.payment.method)}</span>`}
        </div>
        <ul>${o.items.map((i) => `<li><strong>${i.quantity}</strong> &times; ${esc(i.name)}</li>`).join('')}</ul>
        ${o.notes ? `<div><strong>Note:</strong> ${esc(o.notes)}</div>` : ''}
        <div class="meta">${o.phone ? esc(prettyPhone(o.phone)) : 'No phone'}${o.cashier ? ` &middot; taken by ${esc(o.cashier)}` : ''}</div>
        <div class="meta">${notificationBadges(o)}</div>
      </div>
      <div class="actions">${actions(o)}</div>
    </article>`).join('') || '<p class="empty">No orders in line.</p>';
}

async function load() {
  try {
    const res = await fetch('api/orders');
    if (res.ok) { orders = await res.json(); render(); }
  } catch { /* offline for a moment; try again on next tick */ }
}

async function send(url, method, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Something went wrong.');
  await load();
}

document.addEventListener('click', (e) => {
  const s = e.target.closest('[data-status]');
  const pay = e.target.closest('[data-pay]');
  const resend = e.target.closest('[data-resend]');
  if (s) {
    if (s.dataset.status === 'cancelled' && !confirm('Cancel this order?')) return;
    send(`api/orders/${s.dataset.id}/status`, 'PATCH', { status: s.dataset.status });
  }
  if (pay) {
    const o = orders.find((x) => x.id === Number(pay.dataset.pay));
    const m = prompt(`How did they pay ${money(o.total)}? (${config.paymentMethods.join(', ')})`, o.payment.method);
    if (m === null) return;
    const match = config.paymentMethods.find((pm) => pm.toLowerCase() === m.trim().toLowerCase()) || o.payment.method;
    send(`api/orders/${o.id}/payment`, 'PATCH', { method: match, status: 'paid' });
  }
  if (resend) send(`api/orders/${resend.dataset.id}/resend`, 'POST', { kind: resend.dataset.resend });
});

$('showDone').addEventListener('change', render);

(async function init() {
  config = await (await fetch('api/config')).json();
  $('event-name').textContent = config.eventName;
  document.title = `Order queue - ${config.eventName}`;
  if (config.sms !== 'live' || config.email !== 'live') {
    $('mode').textContent = `Test mode: texts ${config.sms}, email ${config.email}`;
  }
  await load();
  setInterval(load, 4000);
}());
