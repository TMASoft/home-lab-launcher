const crypto = require('crypto');

function decodeBase32(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = str.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  let bits = '';
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val === -1) throw new Error('Invalid base32 character');
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateHOTP(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(0, 0);
  counterBuffer.writeUInt32BE(counter, 4);

  const hmac = crypto.createHmac('sha1', secretBuffer);
  hmac.update(counterBuffer);
  const hmacResult = hmac.digest();

  const offset = hmacResult[hmacResult.length - 1] & 0xf;
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  return code % 1000000;
}

function formatToken(value) {
  return String(value).padStart(6, '0');
}

function verifyTOTPWithCounter(secretBase32, token, window = 1) {
  try {
    if (!secretBase32) return null;
    const secretBuffer = decodeBase32(secretBase32);
    const epoch = Math.floor(Date.now() / 1000);
    const currentCounter = Math.floor(epoch / 30);
    const cleanToken = String(token).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanToken)) return null;

    for (let i = -window; i <= window; i++) {
      const computed = generateHOTP(secretBuffer, currentCounter + i);
      if (formatToken(computed) === cleanToken) {
        return { counter: currentCounter + i };
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

function verifyTOTP(secretBase32, token, window = 1) {
  return Boolean(verifyTOTPWithCounter(secretBase32, token, window));
}

function generateSecret() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(20); // 100 bits of entropy as 20 Base32 chars
  let secret = '';
  for (let i = 0; i < bytes.length; i++) {
    secret += alphabet[bytes[i] % 32];
  }
  return secret;
}

module.exports = {
  decodeBase32,
  formatToken,
  generateHOTP,
  verifyTOTP,
  verifyTOTPWithCounter,
  generateSecret
};
