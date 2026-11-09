# Setting up order emails

Every order is emailed to you (the organizer) with a subject like
`Order #7 - Jane - $10.00 - 2:14 PM`, so your inbox lists orders in the order they came in.

This takes about 10 minutes with Gmail. Unlike texting, there's no approval to wait for.

## Two addresses

- **Sending account** (`SMTP_USER`): the Gmail account the system logs in to and sends from.
  We suggest a **separate free Gmail** just for the stand, such as `ourlemonadestand@gmail.com`.
  That way the password saved on the stand laptop can't open your personal email.
- **Organizer address** (`ORGANIZER_EMAIL`): where orders go. This can be your personal email or any
  address. You can list several, separated by commas: `you@example.com, helper@example.com`.

## Step 1: Turn on 2-Step Verification for the sending account

Sign in to the sending Gmail account, open <https://myaccount.google.com/security>, and turn on
**2-Step Verification**. Google only offers App Passwords once this is on.

## Step 2: Create an App Password

1. Go to <https://myaccount.google.com/apppasswords> while signed in to the sending account.
2. Type a name such as `Lemonade orders` and click **Create**.
3. Google shows a **16-letter password** once. Copy it (spaces don't matter).

If that page says App Passwords aren't available, 2-Step Verification isn't on yet. Other causes:
the account uses Advanced Protection, or it's a work/school account whose admin turned them off.
A personal Gmail account avoids both.

## Step 3: Put it in `.env`

On the stand laptop, in the `lemonade-orders` folder (copy `.env.example` to `.env` if you haven't):

```
ORGANIZER_EMAIL=you@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=ourlemonadestand@gmail.com
SMTP_PASS=abcdefghijklmnop
EMAIL_FROM=Lemonade Stand <ourlemonadestand@gmail.com>
```

`SMTP_PASS` is the App Password, **not** the normal Gmail password. Don't paste it into chats or
email, and don't commit `.env` (it's already git-ignored).

## Step 4: Test it

```bash
npm run test-email
```

You should see `Logged in to smtp.gmail.com...` and get a test email at `ORGANIZER_EMAIL`.
The first one may land in **Spam**. If it does, mark it "Not spam" so real orders arrive in your inbox.
In Gmail you can also add a filter (from the stand's address → Never send to Spam, apply a label).

Then run `npm start`. Once texts are also set up, the "Test mode" badge disappears.

### If the test fails

| What you see | What it means |
|---|---|
| `Invalid login` / `Username and Password not accepted` / `535` | `SMTP_PASS` is your normal password or a mistyped App Password. Create a new App Password. |
| `Application-specific password required` | Same: use an App Password. |
| `network problem` / `ETIMEDOUT` | The laptop is offline, or the Wi-Fi blocks email ports. Try a phone hotspot. |
| `Email is not set up yet` | A line in `.env` is blank. The message names which one. |

## Not using Gmail?

Any email provider that offers SMTP works. Swap in its settings:

| Provider | SMTP_HOST | SMTP_PORT | SMTP_SECURE | Password |
|---|---|---|---|---|
| Gmail | `smtp.gmail.com` | 587 | false | App Password |
| Outlook.com / Hotmail | `smtp-mail.outlook.com` | 587 | false | Your provider may require an app password or have SMTP turned off; check its settings |
| Yahoo | `smtp.mail.yahoo.com` | 465 | true | App Password (Account security → Generate app password) |
| iCloud | `smtp.mail.me.com` | 587 | false | App-specific password from appleid.apple.com; `SMTP_USER` is your full iCloud address |

Gmail allows about 500 emails a day, far more than a stand needs.
