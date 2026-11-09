'use strict';

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n).toFixed(2)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let config;
const cart = new Map(); // item id -> quantity
let method = null;
let paid = 'paid';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

function total() {
  let sum = 0;
  for (const [id, qty] of cart) sum += config.items.find((i) => i.id === id).price * qty;
  return Math.round(sum * 100) / 100;
}

function renderMenu() {
  const groups = {};
  for (const item of config.items) (groups[item.category] ||= []).push(item);
  $('menu').innerHTML = Object.entries(groups).map(([cat, items]) => `
    <div class="category">
      <h3>${esc(cat)}</h3>
      <div class="items">
        ${items.map((i) => `
          <button type="button" class="item${cart.has(i.id) ? ' selected' : ''}" data-add="${esc(i.id)}">
            <strong>${esc(i.name)}</strong><span class="price">${money(i.price)}</span>
            ${cart.has(i.id) ? `<span class="qty">${cart.get(i.id)}</span>` : ''}
          </button>`).join('')}
      </div>
    </div>`).join('');
}

function renderTicket() {
  const lines = [...cart].map(([id, qty]) => {
    const item = config.items.find((i) => i.id === id);
    return `<li>
      <button type="button" class="btn step" data-dec="${esc(id)}" aria-label="Remove one">&minus;</button>
      <strong>${qty}</strong>
      <button type="button" class="btn step" data-add="${esc(id)}" aria-label="Add one">+</button>
      <span class="name">${esc(item.name)}</span><span>${money(item.price * qty)}</span>
    </li>`;
  });
  $('lines').innerHTML = lines.join('') || '<li class="empty">Tap menu items to add them.</li>';
  $('total').textContent = money(total());
  renderChange();
}

function renderChange() {
  const received = parseFloat($('amountReceived').value);
  const t = total();
  $('change').textContent = Number.isFinite(received) && received >= t && t > 0
    ? `Change due: ${money(received - t)}` : '';
}

function render() { renderMenu(); renderTicket(); }

function renderMethods() {
  $('methods').innerHTML = config.paymentMethods.map((m) =>
    `<button type="button" class="chip${m === method ? ' on' : ''}" data-method="${esc(m)}">${esc(m)}</button>`).join('');
}

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  const dec = e.target.closest('[data-dec]');
  const m = e.target.closest('[data-method]');
  const p = e.target.closest('[data-paid]');
  if (add) { const id = add.dataset.add; cart.set(id, (cart.get(id) || 0) + 1); render(); }
  if (dec) { const id = dec.dataset.dec; const q = cart.get(id) - 1; if (q > 0) cart.set(id, q); else cart.delete(id); render(); }
  if (m) { method = m.dataset.method; renderMethods(); }
  if (p) {
    paid = p.dataset.paid;
    document.querySelectorAll('[data-paid]').forEach((b) => b.classList.toggle('on', b === p));
    $('received-wrap').style.display = paid === 'paid' ? '' : 'none';
  }
});

$('amountReceived').addEventListener('input', renderChange);

function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('toast').classList.remove('show'), 5000);
}

function resetForm() {
  cart.clear();
  method = null;
  ['customerName', 'phone', 'amountReceived', 'notes'].forEach((id) => { $(id).value = ''; });
  $('smsOptIn').checked = true;
  renderMethods();
  render();
  $('customerName').focus();
}

$('order-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('error').textContent = '';
  if (!cart.size) { $('error').textContent = 'Add at least one item.'; return; }
  if (!method) { $('error').textContent = 'Pick a payment method.'; return; }
  store.set('cashier', $('cashier').value);

  const body = {
    customerName: $('customerName').value,
    phone: $('phone').value,
    smsOptIn: $('smsOptIn').checked,
    items: [...cart].map(([id, quantity]) => ({ id, quantity })),
    payment: { method, status: paid, amountReceived: $('amountReceived').value },
    notes: $('notes').value,
    cashier: $('cashier').value,
  };
  $('submit').disabled = true;
  try {
    const res = await fetch('api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not place the order.');
    const change = data.payment.change > 0 ? ` Give ${money(data.payment.change)} change.` : '';
    toast(`Order #${data.number} placed for ${data.customerName}.${change}`);
    resetForm();
  } catch (err) {
    $('error').textContent = err.message;
  } finally {
    $('submit').disabled = false;
  }
});

(async function init() {
  config = await (await fetch('api/config')).json();
  $('event-name').textContent = config.eventName;
  document.title = `Cashier - ${config.eventName}`;
  if (config.sms !== 'live' || config.email !== 'live') {
    $('mode').textContent = `Test mode: texts ${config.sms}, email ${config.email}`;
  }
  $('cashier').value = store.get('cashier') || '';
  renderMethods();
  render();
}());
