# Lemonade Fundraiser Orders

A small ordering system for the monthly (second-Sunday) lemonade fundraiser.

- **Cashier screen**: tap items (lemonades, chicken pastry, game tickets), enter the
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

1. Create a Twilio account and buy a phone number (about $1–2/month plus about 1¢ per text).
2. Put your **Account SID**, **Auth Token** and the number in `.env`.
3. **US numbers must be registered before they can text customers.** In the Twilio
   console, finish *A2P 10DLC* registration (a "Sole Proprietor" or nonprofit brand works),
   or use a **toll-free number** and complete toll-free verification. Plan for a few
   days to a couple of weeks for approval, and do it well before your first Sunday.
4. Ask each customer if they want texts. The cashier checkbox records their answer.
   Every first text includes "Reply STOP to opt out", and Twilio handles STOP for you.

## Set up email

Any SMTP account works. With Gmail:

1. Turn on 2-Step Verification on the Google account.
2. Create an **App Password** at <https://myaccount.google.com/apppasswords>.
3. In `.env`, set `SMTP_USER` to the Gmail address, `SMTP_PASS` to the app password, and
   `ORGANIZER_EMAIL` to the address that should get each order.

Each email subject looks like `Order #7 - Jane - $11.00 - 2:14 PM`, so your inbox sorts
in the same order customers ordered.

## Change the menu

Edit `menu.json` (names, prices, categories, payment methods), then restart the server.

## Where the data lives

Orders are saved in `data/orders.json` on the laptop running the server. Restarting the
server doesn't lose them. Back the file up, or download the CSV after each event.

## Tests

```bash
npm test
```
