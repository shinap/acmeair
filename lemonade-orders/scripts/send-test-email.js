'use strict';

// Send one test email with the SMTP settings in .env:
//   npm run test-email
const config = require('../src/config');
const { Notifier } = require('../src/notify');

(async () => {
  const { email } = config;
  const missing = [
    ['SMTP_HOST', email.host], ['SMTP_USER', email.user], ['SMTP_PASS', email.pass],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Email is not set up yet. In .env, fill in: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`Orders will be emailed to: ${email.to}  (change ORGANIZER_EMAIL in .env to send elsewhere)`);
  const notifier = new Notifier(config);
  try {
    await notifier.transport.verify();
    console.log(`Logged in to ${email.host} as ${email.user}.`);
    await notifier.sendEmail(
      `Test email from the ${config.eventName} ordering system`,
      `It works! New orders will be emailed to ${email.to} like this one.`,
    );
    console.log(`Sent a test email to ${email.to}. Check that inbox (and Spam, the first time).`);
  } catch (err) {
    console.error(`Could not send the email: ${err.message}`);
    if (err.code === 'EAUTH' || err.responseCode === 535) {
      console.error('The login was refused. For Gmail, SMTP_PASS must be a 16-letter App Password,');
      console.error('not your normal password. See EMAIL_SETUP.md.');
    } else if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(err.code)) {
      console.error('This looks like a network problem: check that this computer is online and SMTP_HOST/SMTP_PORT are right.');
    }
    process.exit(1);
  }
})();
