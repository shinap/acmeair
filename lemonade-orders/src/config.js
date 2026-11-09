'use strict';

// Minimal .env loader so organizers don't need extra tooling.
const fs = require('fs');
const path = require('path');

function loadDotEnv(file = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadDotEnv();

const env = process.env;

module.exports = {
  port: Number(env.PORT || 3000),
  timezone: env.TIMEZONE || 'America/New_York',
  eventName: env.EVENT_NAME || 'Lemonade Fundraiser',
  staffPin: env.STAFF_PIN || '',
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
  defaultCountryCode: env.DEFAULT_COUNTRY_CODE || '1',
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    from: env.TWILIO_FROM_NUMBER || '',
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || '',
  },
  email: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.EMAIL_FROM || env.SMTP_USER || '',
    to: env.ORGANIZER_EMAIL || '',
  },
};
