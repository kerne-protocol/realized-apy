// Arithmetic and decoding, offline. Every case here is one that produced a
// wrong number somewhere before it produced a test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUnits,
  ratio,
  annualize,
  decodeUint,
  decodeAddress,
  decodeString,
  convertToAssetsCall,
  blockAtTimestamp,
  measure,
  SECONDS_PER_YEAR,
} from '../src/measure.mjs';
import { normalizeResult } from '../src/rpc.mjs';
import { mapLimit } from '../src/check.mjs';

test('formatUnits keeps every digit a share price has', () => {
  assert.equal(formatUnits(1239219272830875824n, 18), '1.239219272830875824');
  assert.equal(formatUnits(1000098667771066974n, 18), '1.000098667771066974');
  assert.equal(formatUnits(10n ** 18n, 18), '1');
  assert.equal(formatUnits(0n, 18), '0');
  assert.equal(formatUnits(1n, 18), '0.000000000000000001');
  assert.equal(formatUnits(1000000n, 6), '1');
});

test('ratio divides in fixed point before it ever touches a double', () => {
  // Both operands are ~1e18, above the 2^53 where Number() starts rounding the
  // INTEGER itself. Scaling first means the quotient is exact to eighteen
  // decimals and only the final conversion rounds. The two paths part company
  // around the seventeenth significant digit, which is not enough to move a
  // four-decimal annualized figure and is free to avoid anyway.
  const naive = Number(1000000000000039552n) / Number(1239219272830875824n);
  assert.notEqual(ratio(1000000000000039552n, 1239219272830875824n), naive);
  assert.equal(ratio(1n, 0n), NaN);
});

test('the real sUSDe numbers reproduce the figure the board published', () => {
  // From the committed snapshot: ethena-susde, blocks 25532715 -> 25747939.
  const growth = ratio(1243250466593290566n, 1239219272830875824n);
  assert.equal(Number(((growth - 1) * 100).toFixed(6)), 0.325301);
  assert.equal(Number((annualize(growth, 2592000) * 1).toFixed(4)), 4.0305);
});

test('annualizing uses real elapsed seconds, not the nominal window', () => {
  // A 1% gain over exactly a year is 1% annualized.
  assert.ok(Math.abs(annualize(1.01, SECONDS_PER_YEAR) - 1) < 1e-9);
  // The same 1% over 30 days compounds to far more.
  const thirty = annualize(1.01, 30 * 86400);
  assert.ok(thirty > 12 && thirty < 13, `got ${thirty}`);
  // Using the nominal window where the real one was shorter overstates.
  assert.ok(annualize(1.01, 29 * 86400) > thirty);
});

test('convertToAssets is asked in the vault its own unit', () => {
  assert.equal(convertToAssetsCall(18), '0x07a2d13a' + '0de0b6b3a7640000'.padStart(64, '0'));
  // The 24 decimal case that a hardcoded 1e18 gets wrong by a factor of a million.
  assert.equal(convertToAssetsCall(24).slice(0, 10), '0x07a2d13a');
  assert.notEqual(convertToAssetsCall(24), convertToAssetsCall(18));
});

test('decoders survive what nodes actually return', () => {
  assert.equal(decodeUint('0x' + (12345n).toString(16).padStart(64, '0')), 12345n);
  assert.equal(decodeUint('0x'), null);
  assert.equal(decodeUint(null), null);
  assert.equal(decodeUint({ error: 'execution reverted' }), null);
  assert.equal(
    decodeAddress('0x' + '00'.repeat(12) + '9d39a5de30e57443bff2a8307a4256c8797a3497'),
    '0x9d39a5de30e57443bff2a8307a4256c8797a3497',
  );
  // ABI dynamic string
  const dyn =
    '0x' +
    (32n).toString(16).padStart(64, '0') +
    (5n).toString(16).padStart(64, '0') +
    Buffer.from('sUSDe').toString('hex').padEnd(64, '0');
  assert.equal(decodeString(dyn), 'sUSDe');
  // bytes32 form, still used by a few older tokens
  assert.equal(decodeString('0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0')), 'MKR');
  assert.equal(decodeString('0x'), null);
});

test('two endpoints are compared on substance, not on decoration', () => {
  const a = { number: '0x10', timestamp: '0x64', hash: '0xABC', totalDifficulty: '0x1', size: '0x2' };
  const b = { number: '0x10', timestamp: '0x64', hash: '0xabc', blobGasUsed: '0x0' };
  assert.deepEqual(
    normalizeResult('eth_getBlockByNumber', a),
    normalizeResult('eth_getBlockByNumber', b),
  );
  // But a different timestamp for the same block is a real disagreement.
  assert.notDeepEqual(
    normalizeResult('eth_getBlockByNumber', a),
    normalizeResult('eth_getBlockByNumber', { ...b, timestamp: '0x65' }),
  );
  // eth_call results compare case-insensitively, which is presentation too.
  assert.equal(normalizeResult('eth_call', '0xAB'), normalizeResult('eth_call', '0xab'));
});

// A deterministic fake chain: 12 second blocks, one contract, no network.
function fakeChain({ interval = 12, head = 1000000, prices = {} } = {}) {
  const tsOf = (n) => 1700000000 + n * interval;
  let calls = 0;
  return {
    calls: () => calls,
    read: async (batch) => ({
      results: batch.map((c) => {
        calls++;
        if (c.method === 'eth_getBlockByNumber') {
          const tag = c.params[0];
          const n = tag === 'latest' ? head : Number(BigInt(tag));
          return { number: '0x' + n.toString(16), timestamp: '0x' + tsOf(n).toString(16), hash: '0x' + n.toString(16).padStart(64, '0') };
        }
        const data = c.params[0].data;
        const block = Number(BigInt(c.params[1]));
        if (data === '0x313ce567') return '0x' + (18n).toString(16).padStart(64, '0');
        if (data === '0x38d52e0f') return '0x' + '00'.repeat(12) + '11'.repeat(20);
        if (data === '0x95d89b41') return '0x' + Buffer.from('TEST').toString('hex').padEnd(64, '0');
        if (data.startsWith('0x07a2d13a')) {
          const v = prices[block] ?? 10n ** 18n;
          return '0x' + v.toString(16).padStart(64, '0');
        }
        return '0x';
      }),
    }),
  };
}

test('the window start is found by timestamp, not by assuming a block interval', async () => {
  const chain = fakeChain({ interval: 12, head: 1000000 });
  const head = { number: 1000000, timestamp: 1700000000 + 1000000 * 12 };
  const found = await blockAtTimestamp(chain.read, head.timestamp - 30 * 86400, head);
  // 30 days at 12s is exactly 216000 blocks.
  assert.equal(found.number, 1000000 - 216000);
});

test('a chain with a shorter block interval lands on a different block, not the same one', async () => {
  // 2 second blocks: the same thirty days is 1,296,000 blocks, not 216,000.
  // A script that hardcodes an interval reads the wrong block on one of these
  // two chains and never says so.
  const chain = fakeChain({ interval: 2, head: 2000000 });
  const head = { number: 2000000, timestamp: 1700000000 + 2000000 * 2 };
  const found = await blockAtTimestamp(chain.read, head.timestamp - 30 * 86400, head);
  assert.equal(found.number, 2000000 - 1296000);
});

test('measure divides the two pinned reads and annualizes the real gap', async () => {
  const prices = { 900000: 10n ** 18n, 1000000: (10n ** 18n * 1005n) / 1000n };
  const chain = fakeChain({ interval: 12, head: 1000000, prices });
  const m = await measure(chain.read, '0x' + '22'.repeat(20), { fromBlock: 900000, toBlock: 1000000 });
  assert.equal(m.ppsFrom, '1');
  assert.equal(m.ppsTo, '1.005');
  assert.equal(m.elapsedSeconds, 100000 * 12);
  assert.equal(m.growthPct, 0.5);
  const expected = (Math.pow(1.005, SECONDS_PER_YEAR / (100000 * 12)) - 1) * 100;
  assert.equal(m.annualizedPct, Number(expected.toFixed(4)));
});

test('a flat share price is zero, not an error', async () => {
  const chain = fakeChain({ interval: 12, head: 1000000, prices: { 900000: 10n ** 18n, 1000000: 10n ** 18n } });
  const m = await measure(chain.read, '0x' + '22'.repeat(20), { fromBlock: 900000, toBlock: 1000000 });
  assert.equal(m.growthPct, 0);
  assert.equal(m.annualizedPct, 0);
});

test('mapLimit preserves order and bounds concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3, `peak ${peak}`);
});
