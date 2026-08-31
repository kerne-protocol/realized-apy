#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// realized-apy: what an ERC-4626 dollar vault actually paid, from public RPC.
//
//   node bin/realized-apy.mjs check                    every row of the Kerne Honesty Index
//   node bin/realized-apy.mjs check ethena-susde       one row
//   node bin/realized-apy.mjs vault 0x9D39...3497      any vault, no snapshot involved
//   node bin/realized-apy.mjs signature                just the signature on the snapshot
//
// No API key, no wallet, no npm install, no account anywhere.

import { checkSnapshot, fetchSnapshot, makeReader, DEFAULT_SNAPSHOT_URL } from '../src/check.mjs';
import { measure, WINDOW_SECONDS } from '../src/measure.mjs';
import { verifySnapshot } from '../src/attestation.mjs';
import { CHAINS } from '../src/rpc.mjs';
import { readFileSync } from 'node:fs';

const USAGE = `realized-apy - what an ERC-4626 dollar vault actually paid

  check [rowKey ...]      re-derive rows of the Kerne Honesty Index from chain data
  vault <address>         measure any ERC-4626 vault yourself
  signature               verify the signature over the published snapshot
  rows                    list the row keys in the snapshot

Options
  --chain <name>          ethereum | base | avalanche      (vault; default ethereum)
  --rpc <url>             use this endpoint instead of the built-in list (repeatable)
  --one-endpoint          do not require two independent endpoints to agree
  --window <days>         window length for \`vault\` (default 30)
  --from <block>          pin the window start block for \`vault\`
  --to <block>            pin the window end block for \`vault\`
  --snapshot <url|path>   read the snapshot from somewhere else
  --concurrency <n>       rows checked in parallel (default 5)
  --json                  machine-readable output
  --quiet                 no progress lines

Exit code is 1 if any row fails to reproduce, or if the signature does not verify.`;

function parseArgs(argv) {
  const opts = { rpc: [], rows: [], json: false, quiet: false, concurrency: 5, requireTwo: true };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--one-endpoint') opts.requireTwo = false;
    else if (a === '--rpc') opts.rpc.push(argv[++i]);
    else if (a === '--chain') opts.chain = argv[++i];
    else if (a === '--window') opts.window = Number(argv[++i]);
    else if (a === '--from') opts.from = Number(argv[++i]);
    else if (a === '--to') opts.to = Number(argv[++i]);
    else if (a === '--snapshot') opts.snapshot = argv[++i];
    else if (a === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  return { opts, positional };
}

async function loadSnapshot(where) {
  if (!where) return fetchSnapshot(DEFAULT_SNAPSHOT_URL);
  if (/^https?:\/\//.test(where)) return fetchSnapshot(where);
  return JSON.parse(readFileSync(where, 'utf8'));
}

function pct(n) {
  return (n >= 0 ? ' ' : '') + n.toFixed(4) + '%';
}

function printSignature(sig, signer, generatedAt, quiet) {
  if (quiet) return;
  const mark = (b) => (b ? 'ok  ' : 'FAIL');
  console.log(`Snapshot ${generatedAt}`);
  console.log(`  ${mark(sig.hashMatches)} attestation_hash is sha256 of the published canonical bytes`);
  console.log(`  ${mark(sig.signerMatches)} signature recovers to ${sig.signerRecovered ?? 'nothing'}${sig.signerMatches ? '' : ` (published signer ${signer})`}`);
  console.log(`  ${mark(sig.rowsBound)} those bytes rebuild from the rows in this document`);
  for (const n of sig.notes) console.log(`      ${n}`);
  console.log('');
}

async function cmdCheck(opts, positional) {
  const snapshot = await loadSnapshot(opts.snapshot);
  const wanted = positional.slice(1);
  const known = new Set(snapshot.rows.map((r) => r.key));
  for (const w of wanted) {
    if (!known.has(w)) {
      console.error(`No row "${w}". Run \`rows\` to list them.`);
      process.exitCode = 1;
      return;
    }
  }

  if (!opts.json) {
    printSignature(verifySnapshot(snapshot), snapshot.signer, snapshot.generated_at, opts.quiet);
    if (!opts.quiet) {
      console.log(
        `Re-reading ${wanted.length || snapshot.rows.length} row(s) at the block heights the snapshot names,`,
      );
      console.log(
        `${opts.requireTwo ? 'from two independent public endpoints that must agree' : 'from one endpoint'}. Nothing here is fetched from Kerne except the snapshot itself.\n`,
      );
    }
  }

  const started = Date.now();
  const report = await checkSnapshot(snapshot, {
    rows: wanted,
    rpcs: opts.rpc,
    requireTwo: opts.requireTwo,
    concurrency: opts.concurrency,
    onRow: opts.json || opts.quiet ? undefined : (v) => {
      if (v.status === 'PASS') {
        console.log(`PASS  ${v.key.padEnd(20)} realized ${pct(v.mine.annualizedPct)}  (published ${pct(v.published.annualizedPct)})`);
      } else if (v.status === 'SKIP') {
        console.log(`SKIP  ${v.key.padEnd(20)} ${v.reason}`);
      } else if (v.status === 'ERROR') {
        console.log(`ERR   ${v.key.padEnd(20)} ${v.reason.split('\n')[0]}`);
      } else {
        console.log(`FAIL  ${v.key.padEnd(20)} published ${pct(v.published.annualizedPct)} vs recomputed ${pct(v.mine.annualizedPct)}`);
        if (!v.detail.ppsFromMatch) console.log(`        share price at block ${v.published.fromBlock}: published ${v.published.ppsFrom}, read ${v.mine.ppsFrom}`);
        if (!v.detail.ppsToMatch) console.log(`        share price at block ${v.published.toBlock}: published ${v.published.ppsTo}, read ${v.mine.ppsTo}`);
        if (v.detail.decimalsNote) console.log(`        ${v.detail.decimalsNote}`);
      }
    },
  });

  if (opts.json) {
    console.log(JSON.stringify({ ...report, elapsedMs: Date.now() - started }, null, 2));
  } else {
    const t = report.totals;
    console.log('');
    console.log(`${t.pass} reproduced, ${t.fail} did not, ${t.skip} publish no figure, ${t.error} could not be read, in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    if (t.fail > 0) {
      console.log('');
      console.log('A row that does not reproduce is a defect in the published board, not in your setup.');
      console.log('Kerne asks that you publish it: https://kerne.fi/honesty-index/reproduce');
    }
  }
  if (report.totals.fail > 0 || !report.signature.ok) process.exitCode = 1;
}

async function cmdVault(opts, positional) {
  const address = positional[1];
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error('Give a vault address: realized-apy vault 0x9D39A5DE30e57443BfF2A8307A4256c8797A3497');
    process.exitCode = 1;
    return;
  }
  const chain = opts.chain || 'ethereum';
  if (!CHAINS[chain] && !opts.rpc.length) {
    console.error(`Unknown chain "${chain}". Known: ${Object.keys(CHAINS).join(', ')}. Or pass --rpc.`);
    process.exitCode = 1;
    return;
  }
  const read = makeReader(chain, { rpcs: opts.rpc, requireTwo: opts.requireTwo });
  const searchRead = makeReader(chain, { rpcs: opts.rpc, requireTwo: false });
  const windowSeconds = opts.window ? Math.round(opts.window * 86400) : WINDOW_SECONDS;
  if (!opts.quiet && !opts.json) {
    process.stderr.write(`Searching ${chain} for the block ${(windowSeconds / 86400).toFixed(0)} days back`);
  }
  const m = await measure(read, address, {
    fromBlock: opts.from,
    toBlock: opts.to,
    windowSeconds,
    searchRead,
    onProgress: opts.quiet || opts.json ? undefined : () => process.stderr.write('.'),
  });
  if (!opts.quiet && !opts.json) process.stderr.write('\n');
  if (opts.json) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  console.log('');
  console.log(`${m.symbol ?? address}  on ${chain}`);
  console.log(`  underlying          ${m.assetSymbol ?? m.asset} (${m.assetDecimals} decimals; the vault reports ${m.shareDecimals})`);
  console.log(`  window              block ${m.fromBlock} -> ${m.toBlock}, ${m.windowDays} days (${m.elapsedSeconds} seconds)`);
  console.log(`  share price start   ${m.ppsFrom}`);
  console.log(`  share price end     ${m.ppsTo}`);
  console.log(`  growth              ${m.growthPct}%`);
  console.log(`  realized, annual    ${m.annualizedPct}%`);
  console.log('');
  console.log('  That last line is what the vault paid. Whatever it advertises is a separate document.');
}

async function cmdSignature(opts) {
  const snapshot = await loadSnapshot(opts.snapshot);
  const sig = verifySnapshot(snapshot);
  if (opts.json) {
    console.log(JSON.stringify({ generated_at: snapshot.generated_at, signer: snapshot.signer, ...sig }, null, 2));
  } else {
    printSignature(sig, snapshot.signer, snapshot.generated_at, false);
    console.log(sig.ok
      ? `The ${snapshot.rows.length} rows in this document are the rows that were signed.`
      : 'This document does not verify. Treat every figure in it as unattributed.');
  }
  if (!sig.ok) process.exitCode = 1;
}

async function cmdRows(opts) {
  const snapshot = await loadSnapshot(opts.snapshot);
  for (const r of snapshot.rows) {
    const rz = r.realized ?? {};
    console.log(
      [r.key.padEnd(20), r.chain.padEnd(10), (r.symbol ?? '').padEnd(12), rz.ok ? `${rz.annualizedPct}%` : '-'].join(' '),
    );
  }
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  if (opts.help || !cmd) {
    console.log(USAGE);
    return;
  }
  if (cmd === 'check') return cmdCheck(opts, positional);
  if (cmd === 'vault') return cmdVault(opts, positional);
  if (cmd === 'signature' || cmd === 'sig') return cmdSignature(opts);
  if (cmd === 'rows') return cmdRows(opts);
  console.error(`Unknown command "${cmd}".\n`);
  console.log(USAGE);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error('\n' + (e && e.message ? e.message : String(e)));
  process.exitCode = 1;
});
