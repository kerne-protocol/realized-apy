// Verified against a real signed snapshot, captured 2026-08-13 and committed
// here. The fixture is the point: a signature over a table of numbers stays
// checkable forever, so this suite proves the verifier works without asking
// anyone to trust that kerne.fi is up, or that it is serving the same document
// today that it served then.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifySnapshot, buildSignablePayload, sha256Hex } from '../src/attestation.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/honesty-index-2026-08-13.json', import.meta.url));
const load = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));

const EXPECTED_SIGNER = '0x84949170e0ad0f9bd8686a4aa4922c10f5fdc4ea';

test('the committed snapshot verifies, all three ways', () => {
  const v = verifySnapshot(load());
  assert.equal(v.hashMatches, true);
  assert.equal(v.signerRecovered, EXPECTED_SIGNER);
  assert.equal(v.signerMatches, true);
  assert.equal(v.rowsBound, true);
  assert.equal(v.ok, true);
  assert.deepEqual(v.notes, []);
});

test('the fixture is the board it claims to be', () => {
  const snap = load();
  assert.equal(snap.rows.length, 21);
  assert.equal(snap.window_days, 30);
  assert.equal(snap.kind, 'kerne.honesty-index.v1');
  // Kerne's own row is first and reads zero. If that ever stops being true in a
  // fixture, the fixture was replaced with a flattering one.
  assert.equal(snap.rows[0].key, 'kerne-skusd');
  assert.equal(snap.rows[0].realized.annualizedPct, 0);
});

test('editing a published figure breaks the binding and nothing else', () => {
  const snap = load();
  snap.rows[1].realized.annualizedPct = 9.99;
  const v = verifySnapshot(snap);
  // The signature itself is still a good signature over the ORIGINAL bytes,
  // which is exactly why check 3 has to exist: without it this edit passes.
  assert.equal(v.hashMatches, true);
  assert.equal(v.signerMatches, true);
  assert.equal(v.rowsBound, false);
  assert.equal(v.ok, false);
});

test('editing a verbatim advertised quote breaks the binding', () => {
  const snap = load();
  const row = snap.rows.find((r) => r.advertised && r.advertised.length > 0);
  assert.ok(row, 'fixture should contain at least one advertised figure');
  row.advertised[0].verbatim = row.advertised[0].verbatim + ' (edited)';
  assert.equal(verifySnapshot(snap).rowsBound, false);
});

test('adding a row breaks the binding', () => {
  const snap = load();
  snap.rows.push(JSON.parse(JSON.stringify(snap.rows[1])));
  assert.equal(verifySnapshot(snap).rowsBound, false);
});

test('a tampered attestation hash fails the hash check', () => {
  const snap = load();
  snap.attestation_hash = '0x' + '00'.repeat(32);
  const v = verifySnapshot(snap);
  assert.equal(v.hashMatches, false);
  assert.equal(v.ok, false);
});

test('a tampered signature fails signer recovery, not the hash', () => {
  const snap = load();
  const sig = snap.signature;
  // Flip one byte in r.
  const flipped = '0x' + (sig.slice(2, 4) === 'ff' ? '00' : 'ff') + sig.slice(4);
  snap.signature = flipped;
  const v = verifySnapshot(snap);
  assert.equal(v.hashMatches, true);
  assert.equal(v.signerMatches, false);
  assert.equal(v.ok, false);
});

test('claiming a different signer fails even with a valid signature', () => {
  const snap = load();
  snap.signer = '0x' + '11'.repeat(20);
  const v = verifySnapshot(snap);
  assert.equal(v.signerMatches, false);
  assert.equal(v.ok, false);
});

test('a document with fields missing does not throw, it returns not-ok', () => {
  assert.equal(verifySnapshot({}).ok, false);
  assert.equal(verifySnapshot({ rows: [] }).ok, false);
});

test('the rebuilt canonical form is byte-identical to the published one', () => {
  const snap = load();
  assert.equal(JSON.stringify(buildSignablePayload(snap)), snap.signed_payload_canonical);
  assert.equal(sha256Hex(snap.signed_payload_canonical), snap.attestation_hash);
});
