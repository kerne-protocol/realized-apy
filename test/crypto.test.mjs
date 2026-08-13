// The two primitives written by hand here are the only place this project
// could be subtly, silently wrong in a way that still prints a confident
// answer, so they are pinned to published vectors rather than to themselves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256Hex } from '../src/keccak.mjs';
import { recoverPersonalSign, sha256Hex } from '../src/attestation.mjs';
import { splitSignature, recoverPublicKey, N } from '../src/secp256k1.mjs';

const utf8 = (s) => new TextEncoder().encode(s);

test('keccak256 matches the published vectors', () => {
  assert.equal(keccak256Hex(utf8('')), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(keccak256Hex(utf8('abc')), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(
    keccak256Hex(utf8('The quick brown fox jumps over the lazy dog')),
    '0x4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15',
  );
});

test('keccak256 absorbs across the 136 byte rate boundary', () => {
  // 200 bytes forces a second permutation; a padding bug that only shows up on
  // multi-block input would pass every short vector above.
  const digest = keccak256Hex(utf8('a'.repeat(200)));
  assert.match(digest, /^0x[0-9a-f]{64}$/);
  assert.notEqual(digest, keccak256Hex(utf8('a'.repeat(199))));
});

test('keccak256 reproduces well-known function selectors', () => {
  const sel = (sig) => keccak256Hex(utf8(sig)).slice(0, 10);
  assert.equal(sel('transfer(address,uint256)'), '0xa9059cbb');
  assert.equal(sel('convertToAssets(uint256)'), '0x07a2d13a');
  assert.equal(sel('decimals()'), '0x313ce567');
  assert.equal(sel('asset()'), '0x38d52e0f');
  assert.equal(sel('totalSupply()'), '0x18160ddd');
});

test('sha256Hex is the plain sha256 of the string bytes', () => {
  assert.equal(sha256Hex(''), '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('splitSignature accepts both v encodings and rejects everything else', () => {
  const r = 'aa'.repeat(32);
  const s = '11'.repeat(32);
  assert.equal(splitSignature('0x' + r + s + '1b').recid, 0); // v = 27
  assert.equal(splitSignature('0x' + r + s + '1c').recid, 1); // v = 28
  assert.equal(splitSignature('0x' + r + s + '00').recid, 0);
  assert.equal(splitSignature('0x' + r + s + '01').recid, 1);
  assert.equal(splitSignature('0x' + r + s + '05'), null); // nonsense v
  assert.equal(splitSignature('0x' + r + s), null); // 64 bytes
  assert.equal(splitSignature('not hex'), null);
  assert.equal(splitSignature(undefined), null);
});

test('recovery rejects the malleated high-s twin', () => {
  // secp256k1 is malleable: for every (r, s, v) there is (r, n - s, v ^ 1) that
  // recovers to the SAME signer. Accepting it would mean two valid signatures
  // per message, which breaks anything keyed on the signature bytes.
  const digest = new Uint8Array(32).fill(7);
  const r = 1n;
  const highS = N - 1n;
  assert.equal(recoverPublicKey(digest, r, highS, 0), null);
});

test('recovery fails closed on malformed input', () => {
  assert.equal(recoverPersonalSign('0xdeadbeef', '0x' + '00'.repeat(65)), null); // hash not 32 bytes
  assert.equal(recoverPersonalSign('0x' + 'ab'.repeat(32), '0x1234'), null); // signature not 65 bytes
  assert.equal(recoverPersonalSign('0x' + 'ab'.repeat(32), '0x' + '00'.repeat(65)), null); // r = s = 0
});
