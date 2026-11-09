'use strict';

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n).toFixed(2)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let config;
// One line per item + flavor mix: key -> { id, flavors, quantity }
const cart = new Map();
// Flavors currently ticked on each flavored item's card, before tapping "Add".
const picking = new Map();
let method = null;
let paid = 'paid';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const itemById = (id) => config.items.find((i) => i.id === id);
const lineKey = (id, flavors) => `${id}|${flavors.join('+')}`;
const lineName = (line) => {
  const item = itemById(line.id);
  return line.flavors.length ? `${item.name} (${line.flavors.join(' + ')})` : item.name;
};
const qtyOf = (id) => [...cart.values()].filter((l) => l.id === id).reduce((s, l) => s + l.quantity, 0);

function addLine(id, flavors = []) {
  const key = lineKey(id, flavors);
  const line = cart.get(key) || { id, flavors, quantity: 0 };
  line.quantity += 1;
  cart.set(key, line);
}

function total() {
  let sum = 0;
  for (const l of cart.values()) sum += itemById(l.id).price * l.quantity;
  return Math.round(sum * 100) / 100;
}

function itemCard(i) {
  const qty = qtyOf(i.id);
  const badge = qty ? `<span class="qty">${qty}</span>` : '';
  if (!i.flavors) {
    return `<button type="button" class="item${qty ? ' selected' : ''}" data-add="${esc(i.id)}">
      <strong>${esc(i.name)}</strong><span class="price">${money(i.price)}</span>${badge}
    </button>`;
  }
  const chosen = picking.get(i.id) || [];
  return `<div class="item flavored${qty ? ' selected' : ''}">
    <strong>${esc(i.name)}</strong><span class="price">${money(i.price)} &middot; pick one or mix</span>${badge}
    <div class="chips">
      ${i.flavors.map((f) => `<button type="button" class="chip${chosen.includes(f) ? ' on' : ''}"
        data-flavor="${esc(f)}" data-item="${esc(i.id)}">${esc(f)}</button>`).join('')}
    </div>
    <button type="button" class="btn primary" data-add-flavored="${esc(i.id)}"${chosen.length ? '' : ' disabled'}>
      Add ${esc(i.name.toLowerCase())}${chosen.length ? `: ${esc(chosen.join(' + '))}` : ''}
    </button>
  </div>`;
}

function renderMenu() {
  const groups = {};
  for (const item of config.items) (groups[item.category] ||= []).push(item);
  $('menu').innerHTML = Object.entries(groups).map(([cat, items]) => `
    <div class="category">
      <h3>${esc(cat)}</h3>
      <div class="items">${items.map(itemCard).join('')}</div>
    </div>`).join('');
}

function renderTicket() {
  const lines = [...cart].map(([key, l]) => `<li>
      <button type="button" class="btn step" data-dec="${esc(key)}" aria-label="Remove one">&minus;</button>
      <strong>${l.quantity}</strong>
      <button type="button" class="btn step" data-inc="${esc(key)}" aria-label="Add one">+</button>
      <span class="name">${esc(lineName(l))}</span><span>${money(itemById(l.id).price * l.quantity)}</span>
    </li>`);
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
  const t = (sel) => e.target.closest(sel);
  let el;
  if ((el = t('[data-add]'))) { addLine(el.dataset.add); render(); }
  if ((el = t('[data-flavor]'))) {
    const { item, flavor } = el.dataset;
    const chosen = picking.get(item) || [];
    const next = chosen.includes(flavor) ? chosen.filter((f) => f !== flavor) : [...chosen, flavor];
    // keep flavors in menu order so "Strawberry + Coconut" and "Coconut + Strawberry" are the same line
    picking.set(item, itemById(item).flavors.filter((f) => next.includes(f)));
    renderMenu();
  }
  if ((el = t('[data-add-flavored]'))) {
    const id = el.dataset.addFlavored;
    const chosen = picking.get(id) || [];
    if (chosen.length) { addLine(id, chosen); picking.delete(id); render(); }
  }
  if ((el = t('[data-inc]'))) { cart.get(el.dataset.inc).quantity += 1; render(); }
  if ((el = t('[data-dec]'))) {
    const line = cart.get(el.dataset.dec);
    line.quantity -= 1;
    if (line.quantity < 1) cart.delete(el.dataset.dec);
    render();
  }
  if ((el = t('[data-method]'))) { method = el.dataset.method; renderMethods(); }
  if ((el = t('[data-paid]'))) {
    paid = el.dataset.paid;
    document.querySelectorAll('[data-paid]').forEach((b) => b.classList.toggle('on', b === el));
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
  picking.clear();
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
    items: [...cart.values()].map(({ id, flavors, quantity }) => ({ id, flavors, quantity })),
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
