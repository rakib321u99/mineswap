// TON wallet address validation — format only, no network calls.
// Accepted forms:
//   - User-friendly (bounceable/non-bounceable): EQ... / UQ... — 48 chars,
//     base64url alphabet.
//   - Raw: 0:<64 hex chars>.
// Anything else is rejected. This never proves the wallet exists or is
// owned by the user — the admin pays manually and checks the address.
'use strict';

const FRIENDLY_RE = /^[EU]Q[0-9A-Za-z_-]{46}$/;
const RAW_RE = /^0:[0-9a-fA-F]{64}$/;

function isValidTonAddress(addr) {
  if (typeof addr !== 'string') return false;
  const a = addr.trim();
  if (a.length === 0 || a.length > 100) return false;
  return FRIENDLY_RE.test(a) || RAW_RE.test(a);
}

module.exports = { isValidTonAddress };
