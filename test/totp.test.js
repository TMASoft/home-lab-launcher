const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../src/server/totp');

test('TOTP helpers - generateSecret generates valid Base32 secret', () => {
  const secret = totp.generateSecret();
  assert.equal(secret.length, 10);
  assert.ok(/^[A-Z2-7]+$/.test(secret));
});

test('TOTP helpers - decodeBase32 correctly decodes Base32 strings', () => {
  // RFC 4648 test vectors
  // "" -> ""
  // "MY======" -> "f" (0x66)
  // "MZXW====" -> "fo" (0x66, 0x6f)
  // "MZXW6===" -> "foo" (0x66, 0x6f, 0x6f)
  // "MZXW6YTQ" -> "fooba"
  // "MZXW6YTB" -> "foobaz"
  const dec1 = totp.decodeBase32('MZXW6===');
  assert.equal(dec1.toString('utf8'), 'foo');

  const dec2 = totp.decodeBase32('MZXW6YTB');
  assert.equal(dec2.toString('utf8'), 'fooba');

  // Verify spaces/padding/case insensitivity
  const dec3 = totp.decodeBase32('mzxw 6ytb ===');
  assert.equal(dec3.toString('utf8'), 'fooba');
});

test('TOTP helpers - verifyTOTP validates correct tokens and rejects invalid ones', () => {
  // Using a fixed secret key 'JBSWY3DPEHPK3PXP' (decoded as 'Hello!')
  const secret = 'JBSWY3DPEHPK3PXP';

  // Generates HOTP counter based on fixed epoch
  const secretBuffer = totp.decodeBase32(secret);
  const nowSecs = Math.floor(Date.now() / 1000);
  const currentCounter = Math.floor(nowSecs / 30);

  // Get current, past, and future HOTPs
  const currentOtp = totp.generateHOTP(secretBuffer, currentCounter);
  const pastOtp = totp.generateHOTP(secretBuffer, currentCounter - 1);
  const futureOtp = totp.generateHOTP(secretBuffer, currentCounter + 1);

  // 1. Current OTP is verified
  assert.ok(totp.verifyTOTP(secret, currentOtp));
  assert.ok(totp.verifyTOTP(secret, String(currentOtp)));

  // 2. Past and future OTPs within drift window are verified
  assert.ok(totp.verifyTOTP(secret, pastOtp, 1));
  assert.ok(totp.verifyTOTP(secret, futureOtp, 1));

  // 3. Stale OTP outside window is rejected
  const staleOtp = totp.generateHOTP(secretBuffer, currentCounter - 2);
  assert.ok(!totp.verifyTOTP(secret, staleOtp, 1)); // Default window is 1

  // 4. Invalid secret or invalid code formatting is rejected
  assert.ok(!totp.verifyTOTP(secret, 'abc123'));
  assert.ok(!totp.verifyTOTP('INVALIDSECRET123', currentOtp));
});
