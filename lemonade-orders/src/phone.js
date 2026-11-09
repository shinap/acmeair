'use strict';

/**
 * Normalize a phone number typed by the cashier into E.164 (+15551234567).
 * Returns null when it can't be a valid number.
 */
function normalizePhone(input, defaultCountryCode = '1') {
  if (!input) return null;
  const raw = String(input).trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (defaultCountryCode === '1') {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return null;
  }
  return digits.length >= 6 && digits.length <= 14 ? `+${defaultCountryCode}${digits}` : null;
}

function formatPhone(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 || '';
}

module.exports = { normalizePhone, formatPhone };
