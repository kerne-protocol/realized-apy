// JSON-RPC over fetch. No provider SDK, no API key, no account.
//
// The endpoint lists below are not decoration. Reproducing a thirty day window
// means reading contract state at a block from thirty days ago, which is an
// ARCHIVE read, and most free endpoints quietly refuse those: some answer with
// a 403 telling you to buy a plan, some return "missing trie node", and at
// least one returns a perfectly formatted error that a naive script will print
// as though the protocol were at fault. Every endpoint listed here was probed
// with a real archive call before it was written down, and the failures are
// listed beside them so nobody has to rediscover this.
//
// Two endpoints are used for every read and they must agree byte for byte. A
// single endpoint is a single party you are trusting, which is the thing this
// whole exercise is trying to avoid.

/** Archive-capable public endpoints, probed 2026-08-13. */
export const CHAINS = {
  ethereum: {
    chainId: 1,
    rpcs: [
      'https://eth.drpc.org',
      'https://eth.merkle.io',
      'https://eth-mainnet.public.blastapi.io',
      'https://rpc.mevblocker.io',
      'https://gateway.tenderly.co/public/mainnet',
    ],
    // Probed and NOT archive-capable, kept so nobody re-adds them:
    //   ethereum-rpc.publicnode.com  403 "Archive requests require a personal token"
    //   1rpc.io/eth                  "historical state ... is not available"
    //   eth.blockrazor.xyz           same
    //   rpc.flashbots.net            "rpc method is not whitelisted"
    //   rpc.ankr.com/eth             requires an API key
  },
  base: {
    chainId: 8453,
    rpcs: [
      'https://mainnet.base.org',
      'https://base-mainnet.public.blastapi.io',
      'https://gateway.tenderly.co/public/base',
      'https://1rpc.io/base',
    ],
    //   base-rpc.publicnode.com  403 archive
    //   base.drpc.org            408 "Request timeout on the free plan"
    //   base.meowrpc.com         eth_call not supported
  },
  avalanche: {
    chainId: 43114,
    rpcs: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://avalanche.drpc.org',
      'https://avalanche-mainnet.gateway.tenderly.co',
    ],
    //   avalanche-c-chain-rpc.publicnode.com  "missing trie node"
    //   1rpc.io/avax/c                        "missing trie node"
  },
};

export class RpcError extends Error {
  constructor(message, url) {
    super(message);
    this.url = url;
  }
}

/** One-line, bounded form of anything a misbehaving endpoint sends back. */
function terse(s, max = 140) {
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '...' : flat;
}

async function post(url, body, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RpcError(`HTTP ${res.status}, non-JSON body: ${terse(text)}`, url);
  }
  if (!res.ok && !Array.isArray(json) && !json.result) {
    throw new RpcError(`HTTP ${res.status}: ${terse(json?.error?.message ?? text)}`, url);
  }
  return json;
}

/** Marks a call that the endpoint answered with an error, when the caller has
 *  asked to be told rather than to have the whole batch fail. A reverted
 *  `asset()` is not an outage; it is the answer, and it means the address is
 *  not an ERC-4626 vault. */
export class CallError {
  constructor(message) {
    this.error = terse(message, 100);
  }
}

/**
 * Send several calls to ONE endpoint. Tries a JSON-RPC batch first because it
 * is one round trip; falls back to sequential requests for endpoints that
 * reject batches. Results come back in request order.
 */
export async function sendMany(url, calls, { timeoutMs = 20000, tolerant = false } = {}) {
  const onCallError = (code, message) => {
    if (tolerant) return new CallError(`${code}: ${message}`);
    throw new RpcError(`${code}: ${terse(message)}`, url);
  };
  const payload = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params }));
  try {
    const json = await post(url, payload, timeoutMs);
    if (Array.isArray(json) && json.length === calls.length) {
      const byId = new Map(json.map((r) => [r.id, r]));
      return calls.map((_, i) => {
        const r = byId.get(i + 1);
        if (!r) throw new RpcError('Batch response was missing an id.', url);
        if (r.error) return onCallError(r.error.code, r.error.message);
        return r.result;
      });
    }
  } catch (e) {
    if (e instanceof RpcError && /^-?\d+:/.test(e.message)) throw e; // a real RPC error, not a batch problem
  }
  const out = [];
  for (const c of calls) {
    const json = await post(url, { jsonrpc: '2.0', id: 1, method: c.method, params: c.params }, timeoutMs);
    if (json.error) out.push(onCallError(json.error.code, json.error.message));
    else out.push(json.result);
  }
  return out;
}

/**
 * What two endpoints have to agree ABOUT.
 *
 * Not the raw response. Nodes decorate a block header differently depending on
 * client and version: one returns `totalDifficulty`, another omits it, a third
 * adds `blobGasUsed`, and hex casing varies. Comparing whole responses makes
 * every one of those a "disagreement" and produces an alarming, meaningless
 * error about consensus. So the comparison is over the fields the measurement
 * actually consumes: the return data of a call, and the number, timestamp and
 * hash of a block. Anything else is presentation.
 */
export function normalizeResult(method, result) {
  if (result === null || result === undefined) return null;
  // Endpoints word the same revert differently ("execution reverted" versus
  // "execution reverted: ..."), so an errored call compares as one value. Two
  // endpoints where ONE reverts and the other returns data still disagree,
  // which is the case worth shouting about.
  if (result instanceof CallError) return '!call-error';
  if (method === 'eth_getBlockByNumber' || method === 'eth_getBlockByHash') {
    return {
      number: BigInt(result.number).toString(),
      timestamp: BigInt(result.timestamp).toString(),
      hash: String(result.hash).toLowerCase(),
    };
  }
  if (typeof result === 'string') return result.toLowerCase();
  return result;
}

/**
 * Send the same calls to two independent endpoints and require identical
 * answers. Returns { results, endpoints }.
 *
 * Disagreement is not smoothed over or retried away: if two nodes return
 * different state for the same pinned block, the honest output is that you
 * cannot currently reproduce the row, not an average of the two.
 */
export async function readAgreed(chain, calls, { rpcs, timeoutMs = 20000, requireTwo = true, tolerant = false } = {}) {
  const spec = CHAINS[chain];
  const candidates = rpcs && rpcs.length ? rpcs : spec ? spec.rpcs : null;
  if (!candidates) throw new RpcError(`Unknown chain "${chain}". Pass --rpc with an archive endpoint.`, '');

  const answers = [];
  const failures = [];
  for (const url of candidates) {
    try {
      const results = await sendMany(url, calls, { timeoutMs, tolerant });
      answers.push({ url, results });
    } catch (e) {
      failures.push(`${url}: ${e.message}`);
      continue;
    }
    if (answers.length === (requireTwo ? 2 : 1)) break;
  }

  if (answers.length === 0) {
    throw new RpcError(`No archive endpoint answered for ${chain}.\n  ${failures.join('\n  ')}`, '');
  }
  if (requireTwo && answers.length < 2) {
    return { results: answers[0].results, endpoints: [answers[0].url], agreed: false, failures };
  }
  if (requireTwo) {
    const [a, b] = answers;
    for (let i = 0; i < calls.length; i++) {
      const na = JSON.stringify(normalizeResult(calls[i].method, a.results[i]));
      const nb = JSON.stringify(normalizeResult(calls[i].method, b.results[i]));
      if (na !== nb) {
        // One side erroring while the other answers is almost always a lagging
        // node asked about a block it does not have yet, not a dispute about
        // consensus state. Those are very different accusations and the tool
        // must not make the second one when the first is what happened.
        const oneSideErrored = na === '"!call-error"' || nb === '"!call-error"';
        const what = oneSideErrored
          ? 'One endpoint could not answer'
          : 'Two endpoints disagreed about';
        throw new RpcError(
          `${what} ${calls[i].method} at ${JSON.stringify(calls[i].params[1] ?? '')}` +
            `${oneSideErrored ? ', which usually means it is behind. Retry, or pin an older block.' : '.'}\n` +
            `  ${a.url}: ${na}\n  ${b.url}: ${nb}`,
          '',
        );
      }
    }
    return { results: a.results, endpoints: [a.url, b.url], agreed: true, failures };
  }
  return { results: answers[0].results, endpoints: [answers[0].url], agreed: true, failures };
}

export function ethCallAt(to, data, block) {
  return {
    method: 'eth_call',
    params: [{ to, data }, typeof block === 'number' ? '0x' + block.toString(16) : block],
  };
}

export function getBlock(block) {
  return {
    method: 'eth_getBlockByNumber',
    params: [typeof block === 'number' ? '0x' + block.toString(16) : block, false],
  };
}
