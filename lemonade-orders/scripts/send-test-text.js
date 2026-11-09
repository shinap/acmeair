'use strict';

// Send one test text with the Twilio settings in .env:
//   npm run test-sms -- 555-123-4567
const config = require('../src/config');
const { Notifier } = require('../src/notify');
const { normalizePhone } = require('../src/phone');

(async () => {
  const to = normalizePhone(process.argv[2], config.defaultCountryCode);
  if (!to) {
    console.error('Usage: npm run test-sms -- <your mobile number>   e.g. npm run test-sms -- 555-123-4567');
    process.exit(1);
  }
  const notifier = new Notifier(config);
  if (!notifier.smsEnabled) {
    console.error('Twilio is not set up yet. In .env, fill in TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,');
    console.error('and TWILIO_FROM_NUMBER (or TWILIO_MESSAGING_SERVICE_SID).');
    process.exit(1);
  }
  try {
    const result = await notifier.sendSms(to, `Test text from the ${config.eventName} ordering system. It works!`);
    console.log(`Sent to ${to} (Twilio message ${result.id}). Check your phone.`);
    console.log('If it never arrives, look the message up in the Twilio Console > Monitor > Logs > Messaging.');
  } catch (err) {
    const detail = err.cause ? ` (${err.cause.code || err.cause.message})` : '';
    console.error(`Could not send the text: ${err.message}${detail}`);
    if (err.cause) console.error('This looks like a network problem: check that this computer is online.');
    process.exit(1);
  }
})();
