const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../src/server/totp');
const { sqliteTimestamp } = require('../src/server/routes');

test('TOTP helpers - generateSecret generates valid Base32 secret', () => {
  const secret = totp.generateSecret();
  assert.equal(secret.length, 20);
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
  const currentToken = totp.formatToken(currentOtp);
  assert.ok(totp.verifyTOTP(secret, currentToken));
  assert.ok(totp.verifyTOTP(secret, `${currentToken.slice(0, 3)} ${currentToken.slice(3)}`));

  // 2. Past and future OTPs within drift window are verified
  assert.ok(totp.verifyTOTP(secret, totp.formatToken(pastOtp), 1));
  assert.ok(totp.verifyTOTP(secret, totp.formatToken(futureOtp), 1));

  // 3. Stale OTP outside window is rejected
  const staleOtp = totp.generateHOTP(secretBuffer, currentCounter - 2);
  assert.ok(!totp.verifyTOTP(secret, totp.formatToken(staleOtp), 1)); // Default window is 1

  // 4. Invalid secret or invalid code formatting is rejected
  assert.ok(!totp.verifyTOTP(secret, 'abc123'));
  assert.ok(!totp.verifyTOTP(secret, `${currentToken}abc`));
  assert.ok(!totp.verifyTOTP(secret, currentToken.slice(1)));
  assert.ok(!totp.verifyTOTP('INVALIDSECRET123', currentOtp));
});

test('TOTP helpers - verifyTOTPWithCounter returns the matched counter within the window', () => {
  const totp = require('../src/server/totp');
  const secret = totp.generateSecret();
  const buffer = totp.decodeBase32(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);

  const current = totp.verifyTOTPWithCounter(secret, totp.formatToken(totp.generateHOTP(buffer, counter)));
  assert.ok(current);
  assert.equal(current.counter, counter);

  const previous = totp.verifyTOTPWithCounter(secret, totp.formatToken(totp.generateHOTP(buffer, counter - 1)));
  assert.ok(previous);
  assert.equal(previous.counter, counter - 1);

  assert.equal(totp.verifyTOTPWithCounter(secret, '000000'), null);
  assert.equal(totp.verifyTOTPWithCounter('', '123456'), null);
});

test('TOTP helpers - generateRecoveryCodes produces unique well-formed codes', () => {
  const codes = totp.generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
  }
  assert.equal(totp.generateRecoveryCodes(4).length, 4);
});

test('TOTP helpers - normalizeRecoveryCode strips separators and lowercases', () => {
  assert.equal(totp.normalizeRecoveryCode('AB2DE-FG3JK'), 'ab2defg3jk');
  assert.equal(totp.normalizeRecoveryCode('  ab2de fg3jk  '), 'ab2defg3jk');
  assert.equal(totp.normalizeRecoveryCode(null), '');
  assert.equal(totp.normalizeRecoveryCode(12345), '12345');
});

test('SQLite timestamps sort consistently with SQLite-generated values', () => {
  const cutoff = sqliteTimestamp('2026-07-10T21:30:09.245Z');
  assert.equal(cutoff, '2026-07-10 21:30:09');
  assert.ok('2026-07-10 21:30:10' > cutoff);
  assert.ok('2026-07-10 21:30:08' < cutoff);
});
