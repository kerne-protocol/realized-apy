// Opt-in. These hit public RPC endpoints and kerne.fi, so they are not what a
// pull request is gated on: a rate limit somewhere else in the world is not a
// defect in this code. Run them with:
//
//   npm run test:live
//
// The scheduled workflow in .github runs them daily, which is the part that
// matters: it proves the claim on the tin, from a clean clone, on a machine
// nobody involved controls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSnapshot, checkSnapshot } from '../src/check.mjs';
import { verifySnapshot } from '../src/attestation.mjs';

const LIVE = process.env.REALIZED_APY_LIVE === '1';

test('the live snapshot is signed and its rows are bound to that signature', { skip: !LIVE }, async () => {
  const snap = await fetchSnapshot();
  const v = verifySnapshot(snap);
  assert.equal(v.ok, true, v.notes.join(' | '));
  assert.ok(snap.rows.length >= 15, `only ${snap.rows.length} rows`);
});

test('a live row re-derives from public RPC', { skip: !LIVE }, async () => {
  const snap = await fetchSnapshot();
  const report = await checkSnapshot(snap, { rows: ['ethena-susde'] });
  const row = report.results[0];
  assert.equal(row.status, 'PASS', JSON.stringify(row, null, 2));
  assert.equal(row.mine.ppsFrom, row.published.ppsFrom);
  assert.equal(row.mine.ppsTo, row.published.ppsTo);
});

test('every live row re-derives, and Kerne is measured on the same terms', { skip: !LIVE }, async () => {
  const snap = await fetchSnapshot();
  const report = await checkSnapshot(snap, { concurrency: 5 });
  const bad = report.results.filter((r) => r.status === 'FAIL');
  assert.deepEqual(bad.map((r) => r.key), [], JSON.stringify(bad, null, 2));
  // Kerne's own row is on the board and is checked like any other. A board that
  // exempts its author from its own instrument is a marketing page.
  const kerne = report.results.find((r) => r.key === 'kerne-skusd');
  assert.ok(kerne, 'the board no longer carries its own author');
  assert.notEqual(kerne.status, 'SKIP');
});
