# Lemonade Fundraiser Orders

A small ordering system for the monthly (second-Sunday) lemonade fundraiser.

- **Cashier screen**: tap items (lemonade, chicken pastry, games), enter the
  customer's name and mobile number, and record how they paid.
- **No payments are processed.** The system only *records* the payment: method
  (cash, Zelle, Venmo, your own card reader...), whether it's paid now or at pickup,
  the amount received, and the change due.
- **Text to the customer** when the order is placed and again when it's marked ready.
- **Email to you** for every order, with the order number and time, so the team can
  work in order.
- **Order queue screen**: orders sorted first come, first served. The next order to make is
  outlined, and you move each one through *Start making → Ready → Picked up*.
  Unpaid orders are flagged in red. Failed texts or emails show up with a Retry button.
- Order numbers restart at #1 each event day. You can download a CSV of the day's
  orders for your records.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer on one laptop at the stand.

```bash
cd lemonade-orders
npm install
cp .env.example .env     # then edit .env (see below)
npm start
```

The server window shows the links:

- Cashier: `http://localhost:3000/`
- Order queue: `http://localhost:3000/queue.html`
- An address like `http://192.168.1.20:3000/` for **other phones or tablets on the same Wi-Fi**
  (for example, one tablet for the cashier and one for the people making orders).

Set `STAFF_PIN` in `.env` so customers on the same Wi-Fi can't open the pages.
The browser will ask for a username (anything works) and the PIN as the password.

Until the text and email settings are filled in, the app runs in **test mode**.
Nothing is sent, and every text and email is printed in the server window. The
pages show a "Test mode" badge while this is on.

## Set up texts (Twilio)

Follow **[TWILIO_SETUP.md](TWILIO_SETUP.md)**. It covers the account and phone number, the US carrier registration
(with ready-to-paste form answers), the `.env` keys, and testing with `npm run test-sms -- <your number>`.
Start at least two weeks before you need it, because registration approval takes time.

## Set up email

Follow **[EMAIL_SETUP.md](EMAIL_SETUP.md)** (about 10 minutes with Gmail). It covers creating an App Password,
the `.env` lines, and testing with `npm run test-email`.

Each email subject looks like `Order #7 - Jane - $10.00 - 2:14 PM`, so your inbox sorts
in the same order customers ordered.

## Change the menu

Edit `menu.json` (names, prices, categories, payment methods), then restart the server.

The current menu: **Lemonade $5** (Strawberry, Watermelon, Coconut, Passion Fruit; the customer
can pick one flavor or mix any of them), **Chicken Pastry $4**, and **Games $5**. Any item with a
`flavors` list gets flavor buttons on the cashier screen. Each different mix becomes its own line
on the order, so the team sees exactly what to make.

## Where the data lives

Orders are saved in `data/orders.json` on the laptop running the server. Restarting the
server doesn't lose them. Back the file up, or download the CSV after each event.

## Tests

```bash
npm test
```
