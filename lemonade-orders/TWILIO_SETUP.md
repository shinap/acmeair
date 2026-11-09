# Setting up Twilio texts

This gets the ordering system texting customers ("order #7 is in line" and "order #7 is ready").
Plan on **1–3 weeks** in total, mostly waiting for US carriers to approve your registration,
so start well before the Sunday you want to use it.

## Which registration path?

US carriers block texts from unregistered numbers, so you'll register one of two ways:

| Your situation | Path | Notes |
|---|---|---|
| The fundraiser is run by an organization with an **EIN** (church, school, nonprofit, club) | **A2P 10DLC – Low-Volume Standard brand** | Register under the organization's legal name and EIN. |
| You're running it yourself with **no EIN** | **A2P 10DLC – Sole Proprietor brand** | Uses your name and your own mobile for a one-time PIN. One number, one campaign. That's plenty for this. |

Both work with a normal local Twilio number (10DLC). You don't need a toll-free number.

## Step 1: Create the account and buy a number

1. Sign up at <https://www.twilio.com/try-twilio> and verify your email and mobile.
2. **Upgrade** the account (Console → Admin → Account billing → Upgrade) and add about $20.
   Trial accounts can only text numbers you've verified yourself, and they add "Sent from a Twilio trial account" to every text.
3. **Buy a number:** Console → Phone Numbers → Manage → Buy a number. Choose a local number
   with **SMS** capability, ideally in your area code (about $1.15/month).

## Step 2: Register (A2P 10DLC)

Go to Console → Messaging → **Regulatory compliance / A2P 10DLC** (sometimes called "Onboarding")
and pick the path from the table above. The form asks about your *campaign*, which means what you'll text and why.
Copy these answers, swapping in your own name and location:

**Use case:** Customer Care (or "Account Notification" if Customer Care isn't offered)

**Campaign description:**
> Order-status texts for a monthly community fundraiser lemonade stand at [your location].
> When a customer places an order in person, we text them their order number, and text again
> when the order is ready for pickup. No marketing or promotional messages are sent.

**Sample message 1:**
> Hi Jane! Thanks for supporting the Lemonade Fundraiser. Your order #7 ($10.00) is in line. We'll text you when it's ready. Reply STOP to opt out.

**Sample message 2:**
> Jane, your order #7 is ready! Please pick it up at the Lemonade Fundraiser table.

**How do end users consent (opt-in)?**
> Customers order in person at our stand. The cashier asks if they would like a text when their
> order is ready. If they say yes, the cashier enters their mobile number and checks a box
> recording their consent in our ordering system. Customers who decline are not texted.
> The first text tells them they can reply STOP to opt out.

**Opt-in keywords:** leave blank (customers opt in verbally at the stand, not by texting a keyword).
**Opt-out:** STOP. **Help:** HELP. Twilio handles both replies automatically.

**Embedded links / phone numbers in messages:** No.
**Age-gated content / direct lending:** No.

If the form insists on a **privacy policy URL**, a simple public page works (Google Sites or your
organization's website). It should say: phone numbers are used only to send order updates for this fundraiser,
are never shared or sold, and customers can reply STOP at any time.

Sole Proprietor registration texts a PIN to your own mobile. Reply to confirm it quickly, because it expires.

When the **campaign status shows "Verified"**, add your phone number to the campaign's
**Messaging Service** (the registration flow creates one). Approval usually takes a few days and
can take a couple of weeks. If it's rejected, the reason is shown in the Console. Fix it and resubmit.

## Step 3: Put the keys in `.env`

On the laptop that runs the stand, in the `lemonade-orders` folder (copy `.env.example` to `.env` first):

```
TWILIO_ACCOUNT_SID=AC...            # Console home page, "Account Info"
TWILIO_AUTH_TOKEN=...               # same box, click "Show"
TWILIO_MESSAGING_SERVICE_SID=MG...  # Messaging → Services (recommended, uses your registered campaign)
TWILIO_FROM_NUMBER=+1...            # optional if you set the Messaging Service SID above
```

Keep the Auth Token secret: don't email it, paste it into chats, or commit `.env` (it's already git-ignored).

## Step 4: Test it

```bash
npm run test-sms -- 555-123-4567     # your own mobile
```

You should get "Test text from the Lemonade Fundraiser ordering system. It works!" Then run
`npm start`. The "Test mode" badge on the cashier page should now say texts are live
(it stays until email is set up as well).

### If the test fails

| What you see | What it means |
|---|---|
| `Authenticate` | Account SID or Auth Token is wrong. Copy them again. |
| `The 'From' number ... is not a valid ... phone number` | `TWILIO_FROM_NUMBER` isn't your Twilio number, or isn't in `+1XXXXXXXXXX` form. |
| `... unverified ... Trial accounts ...` | The account is still on trial. Upgrade it (Step 1.2). |
| Command says "sent" but nothing arrives, and the Twilio message log shows error **30034** | Registration isn't approved yet, or the number isn't in the registered Messaging Service. |
| Error **30007** | A carrier filtered the text. Make sure your messages match the samples you registered. |
| `network problem` | The laptop is offline. Fundraiser Wi-Fi or a phone hotspot is needed for texts and email. |

## Costs (approximate, check the Console for current prices)

- Phone number: about $1.15/month
- Registration: one-time brand and campaign vetting fees (roughly $5–$20), plus a small monthly campaign fee (around $2)
- Each text: about 1¢ plus a carrier fee of under 1¢. Two texts per order means about 100 orders cost ~$2–3.
