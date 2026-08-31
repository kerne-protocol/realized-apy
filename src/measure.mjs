// SPDX-License-Identifier: MIT
// The measurement itself. Four reads and one division.
//
// What a vault paid over a period is not an opinion and does not need a model.
// An ERC-4626 vault will tell you, at any block, how many units of the
// underlying one share redeems for. Ask it twice, thirty days apart, and divide.
//
// The three places a naive version of this goes wrong, all of them silent:
//
//   1. ASSUMING 18 DECIMALS. Kerne's own skUSD reports 24 (18 from kUSD plus
//      OpenZeppelin's 6-decimal offset), so convertToAssets(1e18) returns
//      1.0e-06 and a reader who hardcodes 1e18 publishes nonsense. Ask the
//      vault for decimals(), ask the ASSET for its own decimals(), and
//      denominate in the asset's.
//   2. ASSUMING A BLOCK INTERVAL. "30 days ago" is not 216000 blocks ago on any
//      chain that has ever had a slow hour. Binary search real timestamps.
//   3. ANNUALIZING THE NOMINAL WINDOW instead of the real elapsed seconds
//      between the two blocks. The difference is small and it is a lie.

export const SECONDS_PER_YEAR = 365 * 24 * 3600;
export const WINDOW_SECONDS = 30 * 24 * 3600;

export const SEL_DECIMALS = '0x313ce567';
export const SEL_ASSET = '0x38d52e0f';
export const SEL_SYMBOL = '0x95d89b41';
export const SEL_TOTAL_ASSETS = '0x01e1d114';
export const SEL_TOTAL_SUPPLY = '0x18160ddd';
export const SEL_CONVERT_TO_ASSETS = '0x07a2d13a';

export function convertToAssetsCall(shareDecimals) {
  return SEL_CONVERT_TO_ASSETS + (10n ** BigInt(shareDecimals)).toString(16).padStart(64, '0');
}

export function decodeUint(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 4) return null;
  try {
    return BigInt(hex.slice(0, 66));
  } catch {
    return null;
  }
}

export function decodeAddress(hex) {
  if (typeof hex !== 'string' || hex.length < 66) return null;
  return '0x' + hex.slice(26, 66);
}

/** ABI string, with the bytes32 form some older tokens still return. */
export function decodeString(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('0x')) return null;
  const body = hex.slice(2);
  try {
    if (body.length === 64) {
      const bytes = Buffer.from(body, 'hex');
      const end = bytes.indexOf(0);
      return bytes.slice(0, end === -1 ? bytes.length : end).toString('utf8').trim() || null;
    }
    const offset = Number(BigInt('0x' + body.slice(0, 64))) * 2;
    const len = Number(BigInt('0x' + body.slice(offset, offset + 64)));
    return Buffer.from(body.slice(offset + 64, offset + 64 + len * 2), 'hex').toString('utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Exact decimal string for a wei-scale integer. Strings, not floats: a share
 *  price has more significant digits than a double can hold. */
export function formatUnits(value, decimals) {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** a/b in fixed point. Number(bigint) is lossy above 2^53 and share prices are
 *  ~1e18, so scale before dividing. */
export function ratio(a, b) {
  if (b === 0n) return NaN;
  return Number((a * 10n ** 18n) / b) / 1e18;
}

export function annualize(growth, elapsedSeconds) {
  return (Math.pow(growth, SECONDS_PER_YEAR / elapsedSeconds) - 1) * 100;
}

/**
 * Read a vault's units. Returns { shareDecimals, assetDecimals, symbol,
 * assetSymbol, asset }.
 */
export async function readUnits(read, address, block) {
  // Tolerant: a reverted asset() is an ANSWER (this is not an ERC-4626 vault),
  // not an outage, and reporting it as a wall of endpoint failures would send
  // the reader off debugging their network instead of their address.
  const { results } = await read(
    [
      { method: 'eth_call', params: [{ to: address, data: SEL_DECIMALS }, blockTag(block)] },
      { method: 'eth_call', params: [{ to: address, data: SEL_ASSET }, blockTag(block)] },
      { method: 'eth_call', params: [{ to: address, data: SEL_SYMBOL }, blockTag(block)] },
    ],
    { tolerant: true },
  );
  const shareDecimalsRaw = decodeUint(results[0]);
  const asset = decodeAddress(results[1]);
  if (shareDecimalsRaw === null) throw new Error(`${address} did not answer decimals(). It may not be an ERC-20.`);
  if (!asset || /^0x0+$/.test(asset)) throw new Error(`${address} did not answer asset(), so it is not an ERC-4626 vault.`);
  const { results: assetRes } = await read(
    [
      { method: 'eth_call', params: [{ to: asset, data: SEL_DECIMALS }, blockTag(block)] },
      { method: 'eth_call', params: [{ to: asset, data: SEL_SYMBOL }, blockTag(block)] },
    ],
    { tolerant: true },
  );
  const assetDecimalsRaw = decodeUint(assetRes[0]);
  if (assetDecimalsRaw === null) throw new Error(`The underlying asset ${asset} did not answer decimals().`);
  return {
    shareDecimals: Number(shareDecimalsRaw),
    assetDecimals: Number(assetDecimalsRaw),
    symbol: decodeString(results[2]),
    assetSymbol: decodeString(assetRes[1]),
    asset,
  };
}

export function blockTag(block) {
  return typeof block === 'number' ? '0x' + block.toString(16) : block;
}

/** Share price at one block, as an exact decimal string plus the raw integer. */
export async function sharePriceAt(read, address, shareDecimals, assetDecimals, block) {
  const { results } = await read([
    { method: 'eth_call', params: [{ to: address, data: convertToAssetsCall(shareDecimals) }, blockTag(block)] },
  ]);
  const wei = decodeUint(results[0]);
  if (wei === null) throw new Error(`convertToAssets() did not return at block ${block}.`);
  return { wei, text: formatUnits(wei, assetDecimals) };
}

export async function blockHeader(read, block) {
  const { results } = await read([
    { method: 'eth_getBlockByNumber', params: [blockTag(block), false] },
  ]);
  const b = results[0];
  if (!b) throw new Error(`Block ${block} not found.`);
  return { number: Number(BigInt(b.number)), timestamp: Number(BigInt(b.timestamp)) };
}

/**
 * Find the block whose timestamp is closest to `targetTs`, by binary search on
 * real timestamps. Seeded from an observed average interval, then bracketed
 * outwards until the target is inside the bracket, so a chain that changed its
 * block time mid-window does not shift the answer.
 */
export async function blockAtTimestamp(read, targetTs, head, { onProgress } = {}) {
  if (head.timestamp <= targetTs) return head;

  // Seed: assume nothing, measure. One read a long way back gives the real
  // average interval over the period we care about.
  let lo = 1;
  let hi = head.number;
  let loTs = null;
  let hiTs = head.timestamp;
  const probeBack = Math.min(head.number - 1, 300000);
  const probe = await blockHeader(read, head.number - probeBack);
  if (probe.timestamp < targetTs) {
    lo = probe.number;
    loTs = probe.timestamp;
  } else {
    const interval = (head.timestamp - probe.timestamp) / probeBack;
    const estimate = Math.max(1, Math.floor(head.number - (head.timestamp - targetTs) / interval));
    let span = 20000;
    for (let i = 0; i < 8; i++) {
      lo = Math.max(1, estimate - span);
      hi = Math.min(head.number, estimate + span);
      const [a, b] = [await blockHeader(read, lo), await blockHeader(read, hi)];
      loTs = a.timestamp;
      hiTs = b.timestamp;
      if (a.timestamp <= targetTs && b.timestamp >= targetTs) break;
      span *= 4;
    }
  }

  // Interpolate rather than bisect. Block times are near-uniform, so guessing
  // proportionally lands within a few blocks on the first try and converges in
  // three or four reads where bisection takes eighteen. It falls back to the
  // midpoint whenever interpolation would not move, so a chain with an erratic
  // interval degrades to plain binary search instead of stalling.
  let best = null;
  let steps = 0;
  if (loTs === null) loTs = (await blockHeader(read, lo)).timestamp;
  while (lo <= hi) {
    let mid;
    if (hiTs > loTs && targetTs >= loTs && targetTs <= hiTs) {
      mid = lo + Math.round(((targetTs - loTs) * (hi - lo)) / (hiTs - loTs));
      if (mid <= lo) mid = lo + Math.max(1, Math.floor((hi - lo) / 2));
      if (mid >= hi) mid = hi - Math.max(1, Math.floor((hi - lo) / 2));
    } else {
      mid = Math.floor((lo + hi) / 2);
    }
    if (mid < lo || mid > hi) mid = Math.floor((lo + hi) / 2);
    const h = await blockHeader(read, mid);
    steps++;
    if (onProgress) onProgress(steps);
    if (h.timestamp === targetTs) return h;
    if (h.timestamp < targetTs) {
      best = h;
      lo = mid + 1;
      loTs = h.timestamp;
    } else {
      hi = mid - 1;
      hiTs = h.timestamp;
    }
    if (steps > 60) break; // never spin
  }
  return best ?? head;
}

/**
 * Measure realized yield for one vault between two blocks. If `fromBlock` is
 * omitted, the window start is found by binary search 30 days back from
 * `toBlock` (or from the head).
 */
export async function measure(read, address, { fromBlock, toBlock, windowSeconds = WINDOW_SECONDS, onProgress, searchRead } = {}) {
  const head = await blockHeader(read, toBlock ?? 'latest');
  let from;
  if (fromBlock !== undefined && fromBlock !== null) {
    from = await blockHeader(read, fromBlock);
  } else {
    // The ~25 step binary search may run against a single endpoint, because
    // being lied to during the SEARCH can only change WHICH block is picked,
    // never what that block says: the chosen header is re-read through the
    // agreeing reader below, so the window that gets reported and the prices
    // read inside it are still confirmed by two independent parties.
    const found = await blockAtTimestamp(searchRead ?? read, head.timestamp - windowSeconds, head, { onProgress });
    from = await blockHeader(read, found.number);
  }

  const units = await readUnits(read, address, head.number);

  // BOTH prices in ONE request, so both land on the same endpoint. Splitting
  // them risks reading the end price from one provider and the start price from
  // another, and any disagreement between the two would be baked into the
  // published growth figure instead of surfacing as a disagreement.
  const call = convertToAssetsCall(units.shareDecimals);
  const { results: prices } = await read([
    { method: 'eth_call', params: [{ to: address, data: call }, blockTag(head.number)] },
    { method: 'eth_call', params: [{ to: address, data: call }, blockTag(from.number)] },
  ]);
  const toWei = decodeUint(prices[0]);
  const fromWei = decodeUint(prices[1]);
  if (toWei === null) throw new Error(`convertToAssets() did not return at block ${head.number}.`);
  if (fromWei === null) throw new Error(`No archive state at block ${from.number}. Try another --rpc.`);
  const to = { wei: toWei, text: formatUnits(toWei, units.assetDecimals) };
  const start = { wei: fromWei, text: formatUnits(fromWei, units.assetDecimals) };

  if (start.wei === 0n) throw new Error('Share price read as zero at the window start.');
  const elapsed = head.timestamp - from.timestamp;
  if (elapsed <= 0) throw new Error('Window start is not before the window end.');

  const growth = ratio(to.wei, start.wei);
  const growthPct = (growth - 1) * 100;
  const annualizedPct = annualize(growth, elapsed);

  return {
    address,
    ...units,
    fromBlock: from.number,
    fromTs: from.timestamp,
    toBlock: head.number,
    toTs: head.timestamp,
    elapsedSeconds: elapsed,
    windowDays: Number((elapsed / 86400).toFixed(4)),
    ppsFrom: start.text,
    ppsTo: to.text,
    ppsFromWei: start.wei.toString(),
    ppsToWei: to.wei.toString(),
    growthPct: Number(growthPct.toFixed(6)),
    annualizedPct: Number(annualizedPct.toFixed(4)),
  };
}
