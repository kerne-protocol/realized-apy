// Re-derive every row of a published Kerne Honesty Index snapshot from chain
// data and say, per row, whether the published numbers hold.
//
// The comparison is deliberately unforgiving. Both blocks are pinned in the
// snapshot, so an honest row must reproduce EXACTLY: same share price at the
// start block, same share price at the end block, to the last digit. There is
// no tolerance on those two numbers because there is no legitimate source of
// disagreement about them. The annualized figure gets a hair of tolerance for
// floating-point rounding across platforms and nothing else.
//
// What this checks and what it does not:
//   CHECKS   the realized column, which is the column Kerne computes.
//   DOES NOT check the advertised column, which is a human reading a marketing
//            surface on a date. That one you check by opening the source_url
//            printed beside each row and reading it yourself. The verbatim
//            quote is in the snapshot for exactly that purpose.

import { readAgreed, CHAINS } from './rpc.mjs';
import { measure } from './measure.mjs';
import { verifySnapshot } from './attestation.mjs';

export const DEFAULT_SNAPSHOT_URL = 'https://kerne.fi/api/honesty-index';

/** Annualized figures may differ by this much and still count as a match. */
export const ANNUALIZED_TOLERANCE = 0.0002;

export async function fetchSnapshot(url = DEFAULT_SNAPSHOT_URL) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'realized-apy (github.com/kerne-protocol/realized-apy)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.json();
}

export function makeReader(chain, { rpcs, requireTwo = true, timeoutMs = 20000 } = {}) {
  return (calls, extra = {}) => readAgreed(chain, calls, { rpcs, requireTwo, timeoutMs, ...extra });
}

/**
 * Check one row. Returns a verdict object; never throws for a row-level
 * problem, because one unreadable chain should not stop the other twenty rows
 * from being checked.
 */
export async function checkRow(row, { rpcs, requireTwo = true, timeoutMs = 20000 } = {}) {
  const published = row.realized ?? {};
  const base = {
    key: row.key,
    protocol: row.protocol,
    symbol: row.symbol,
    chain: row.chain,
    address: row.address,
    published: {
      ppsFrom: published.ppsFrom ?? null,
      ppsTo: published.ppsTo ?? null,
      fromBlock: published.fromBlock ?? null,
      toBlock: published.toBlock ?? null,
      annualizedPct: published.annualizedPct ?? null,
      growthPct: published.growthPct ?? null,
    },
  };

  if (published.ok !== true) {
    return { ...base, status: 'SKIP', reason: published.reason || 'The snapshot publishes no realized figure for this row.' };
  }
  if (!CHAINS[row.chain] && !(rpcs && rpcs.length)) {
    return { ...base, status: 'SKIP', reason: `No default archive endpoint for chain "${row.chain}". Pass --rpc.` };
  }

  const read = makeReader(row.chain, { rpcs, requireTwo, timeoutMs });
  let mine;
  let lastError;
  // One retry, because the failure this catches is a public endpoint having a
  // bad second (a rate limit, a load-balanced backend answering from a stale
  // replica), not a fact about the row. A second failure is reported rather
  // than retried away: a row nobody can read is a real state and the tool
  // should say so instead of grinding.
  for (let attempt = 0; attempt < 2 && mine === undefined; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      mine = await measure(read, row.address, { fromBlock: published.fromBlock, toBlock: published.toBlock });
    } catch (e) {
      lastError = e;
    }
  }
  if (mine === undefined) return { ...base, status: 'ERROR', reason: lastError.message };

  const ppsFromMatch = mine.ppsFrom === published.ppsFrom;
  const ppsToMatch = mine.ppsTo === published.ppsTo;
  const annualizedDelta = Math.abs(mine.annualizedPct - published.annualizedPct);
  const annualizedMatch = annualizedDelta <= ANNUALIZED_TOLERANCE;
  const decimalsNote =
    mine.shareDecimals !== published.shareDecimals || mine.assetDecimals !== published.assetDecimals
      ? `decimals differ: read ${mine.shareDecimals}/${mine.assetDecimals}, published ${published.shareDecimals}/${published.assetDecimals}`
      : null;

  return {
    ...base,
    status: ppsFromMatch && ppsToMatch && annualizedMatch ? 'PASS' : 'FAIL',
    mine: {
      ppsFrom: mine.ppsFrom,
      ppsTo: mine.ppsTo,
      annualizedPct: mine.annualizedPct,
      growthPct: mine.growthPct,
      elapsedSeconds: mine.elapsedSeconds,
      shareDecimals: mine.shareDecimals,
      assetDecimals: mine.assetDecimals,
    },
    detail: { ppsFromMatch, ppsToMatch, annualizedMatch, annualizedDelta: Number(annualizedDelta.toFixed(6)), decimalsNote },
  };
}

/** Run `fn` over `items` with at most `limit` in flight. Order is preserved. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function checkSnapshot(snapshot, { rows, rpcs, requireTwo = true, concurrency = 5, onRow } = {}) {
  const signature = verifySnapshot(snapshot);
  const selected = rows && rows.length
    ? snapshot.rows.filter((r) => rows.includes(r.key))
    : snapshot.rows;
  const results = await mapLimit(selected, concurrency, async (row) => {
    const verdict = await checkRow(row, { rpcs, requireTwo });
    if (onRow) onRow(verdict);
    return verdict;
  });
  return {
    generated_at: snapshot.generated_at,
    signer: snapshot.signer,
    signature,
    results,
    totals: {
      pass: results.filter((r) => r.status === 'PASS').length,
      fail: results.filter((r) => r.status === 'FAIL').length,
      skip: results.filter((r) => r.status === 'SKIP').length,
      error: results.filter((r) => r.status === 'ERROR').length,
    },
  };
}
