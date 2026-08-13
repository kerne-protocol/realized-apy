# realized-apy

**What an ERC-4626 dollar vault actually paid, read from the chain. And a
one-command check of every row Kerne publishes about other people.**

Zero dependencies, no API key, no wallet, no account anywhere. From a clean
clone:

```
node bin/realized-apy.mjs check
```

That reads the signed [Kerne Honesty Index](https://kerne.fi/honesty-index)
snapshot, re-derives every row from public archive RPC at the block heights the
snapshot names, and tells you, row by row, whether the published number holds.
It takes about half a minute.

```
Snapshot 2026-08-13T18:37:14.118Z
  ok   attestation_hash is sha256 of the published canonical bytes
  ok   signature recovers to 0x84949170e0ad0f9bd8686a4aa4922c10f5fdc4ea
  ok   those bytes rebuild from the rows in this document

PASS  kerne-skusd          realized  0.0000%  (published  0.0000%)
PASS  avant-savusd         realized  8.9293%  (published  8.9293%)
PASS  cap-stcusd           realized  5.0565%  (published  5.0565%)
PASS  aegis-syusd          realized  4.8875%  (published  4.8875%)
PASS  curve-scrvusd        realized  1.2620%  (published  1.2620%)
PASS  falcon-susdf         realized  4.9718%  (published  4.9718%)
PASS  ethena-susde         realized  4.0305%  (published  4.0305%)
PASS  frax-sfrxusd         realized  4.0822%  (published  4.0822%)
PASS  maple-syrupusdc      realized  4.9086%  (published  4.9086%)
PASS  maple-syrupusdt      realized  4.2200%  (published  4.2200%)
PASS  neutrl-snusd         realized  4.1092%  (published  4.1092%)
PASS  sky-susds            realized  3.5436%  (published  3.5436%)
PASS  noon-susn            realized  7.6944%  (published  7.6944%)
PASS  spark-susdc          realized  3.5443%  (published  3.5443%)
PASS  usual-susd0          realized  4.0942%  (published  4.0942%)
PASS  stableslabs-susdx    realized  0.0000%  (published  0.0000%)
PASS  resolv-wstusr        realized  0.0000%  (published  0.0000%)
PASS  tori-strusd          realized 12.0370%  (published 12.0370%)
PASS  yieldfi-yusd         realized  0.0000%  (published  0.0000%)
PASS  level-slvlusd        realized  0.0000%  (published  0.0000%)
PASS  elixir-sdeusd        realized  0.0000%  (published  0.0000%)

21 reproduced, 0 did not, 0 publish no figure, 0 could not be read, in 34.8s.
```

The first row is Kerne's own, and it reads zero.

## Why this repository exists

A board that measures other companies, published by one of the companies on it,
carries an obvious objection: it is still the author vouching for the author.
The only answer to that objection is for somebody else to run the measurement
and say what they got. Nobody does that if checking costs an afternoon, so the
point of this repository is to make it cost one command.

Everything here is a second implementation. It shares no code with the engine
that produces the board. It reads the same public chain state, decodes it with
its own decoder, does the arithmetic in its own arithmetic, and verifies the
signature with keccak256 and secp256k1 written from scratch in this repository
rather than with a library. If the two agree, that is two independent programs
agreeing about a public fact. If they disagree, the board is wrong, and Kerne
would rather find out from you.

## The measurement, in four steps

An ERC-4626 vault will tell you, at any block, how many units of the underlying
one share redeems for. Ask it twice, thirty days apart, and divide. That is the
whole method, and each step below is there because skipping it produces a
confident wrong number.

1. **Ask the vault for its units.** `decimals()` on the vault, `asset()` for the
   underlying, then `decimals()` on the underlying. Never assume 18. Kerne's own
   skUSD reports **24** decimals, so `convertToAssets(1e18)` returns 1.0e-06 and
   a reader who hardcodes 1e18 publishes nonsense about Kerne.
2. **Find the window start by timestamp, not by block count.** Binary search
   real block timestamps for the block closest to 30 days before the end block.
   Thirty days is 216,000 blocks on Ethereum and 1,296,000 on Base, and neither
   number is stable across a slow hour. Assuming an interval shifts the window
   and every annualized figure with it.
3. **Read `convertToAssets(10**decimals)` at both blocks** and divide each by
   `10**asset_decimals`. That is the share price in units of the underlying,
   which is exactly what the vault itself would settle a redemption at.
4. **Annualize over the real elapsed seconds between the two blocks**, not over
   the nominal thirty days:

   ```
   growth      = pps_to / pps_from
   annualized  = (growth ** (31536000 / elapsed_seconds) - 1) * 100
   ```

Both block heights are published in the snapshot, so checking a row is not
re-deriving Kerne's window. It is checking Kerne's arithmetic inside a window
you have been handed.

## What PASS actually asserts

The comparison is deliberately unforgiving. Because both blocks are pinned,
there is no legitimate source of disagreement about the share price at either
one, so those two are compared **exactly, to the last digit**:

| checked | tolerance |
| --- | --- |
| share price at the start block | exact string match |
| share price at the end block | exact string match |
| annualized figure | 0.0002 percentage points, for float rounding across platforms |

Every read is taken from **two independent public endpoints that must return
the same bytes**. One endpoint is one party you are trusting, which is the thing
this exercise is trying to avoid. If two nodes disagree about state at a pinned
block, the tool says so and fails that row rather than picking a favourite.

## What this does not check

**The advertised column.** That is a human reading a marketing surface on a
date, and no script can confirm what a website said last Tuesday. The snapshot
carries `source_url`, `captured_at` and a `verbatim` quote for every advertised
figure precisely so you can open the page and diff the transcription yourself.
The signature binds those quotes, so a quote cannot be revised later while the
signature still verifies.

**Whether a protocol is any good.** A share price is denominated in its
underlying, not in dollars. A vault can grow steadily in units of an asset that
is itself broken. Three rows on the board carry a peg note for that reason and
the board says which. This tool measures one axis and is silent about the rest.

**The hedge, the reserves, the custody.** Not this instrument. Kerne's reserve
side is a separate page with a separate verifier.

## Other things it does

Measure any vault, whether or not Kerne has ever heard of it. No snapshot is
involved, and the thirty day window is found from scratch:

```
node bin/realized-apy.mjs vault 0x9D39A5DE30e57443BfF2A8307A4256c8797A3497
node bin/realized-apy.mjs vault 0x96F5102C15b839757f811A98CEc3725Ac21DfA14 --chain base
node bin/realized-apy.mjs vault 0x06d47F3fb376649c3A9Dafe069B3D6E35572219E --chain avalanche
```

```
skUSD  on base
  underlying          kUSD (18 decimals; the vault reports 24)
  window              block 48633828 -> 49929828, 30 days (2592000 seconds)
  share price start   1.000098667771066974
  share price end     1.000098667771066974
  growth              0%
  realized, annual    0%
```

Check one row, or a few:

```
node bin/realized-apy.mjs check ethena-susde sky-susds
node bin/realized-apy.mjs rows                 # list the row keys
node bin/realized-apy.mjs check --json         # machine readable
```

Check only the signature, including against a snapshot you saved months ago:

```
node bin/realized-apy.mjs signature --snapshot test/fixtures/honesty-index-2026-08-13.json
```

Full options:

```
--chain <name>          ethereum | base | avalanche
--rpc <url>             use your own endpoint instead of the built-in list (repeatable)
--one-endpoint          do not require two independent endpoints to agree
--window <days>         window length for `vault` (default 30)
--from <block>          pin the window start block
--to <block>            pin the window end block
--snapshot <url|path>   read the snapshot from somewhere else
--concurrency <n>       rows checked in parallel (default 5)
--json                  machine-readable output
```

The exit code is 1 if any row fails to reproduce or the signature does not
verify, so this drops into CI as it stands.

## The signature check, and why it has three parts

The snapshot is signed. That is what stops a published number from being
quietly revised after the fact into something the chain now agrees with. The
check has three parts and each can fail on its own:

1. `attestation_hash` really is sha256 over the published canonical **bytes**.
   Hash the bytes; never re-serialize and hash that.
2. The signature recovers, under EIP-191 `personal_sign`, to the published
   signer address.
3. Rebuilding the canonical form **from the rows in the document** reproduces
   those exact bytes.

Part 3 is the one that catches an edited row, and it is the one most signature
checkers skip. A snapshot with one figure changed still passes parts 1 and 2:
the signature is a perfectly good signature over the original bytes. There is a
test in this repository that edits one number and asserts exactly that, so the
distinction stays visible.

`secp256k1.mjs` enforces EIP-2 low-s and rejects the malleated twin, because
otherwise every signature has a second valid form.

## Archive RPC, which is where this usually goes wrong

A thirty day window means reading contract state from thirty days ago, and most
free endpoints quietly refuse. Every endpoint shipped in `src/rpc.mjs` was
probed with a real archive call on 2026-08-13 before it was written down, and
the ones that failed are listed beside them in a comment so nobody re-adds them:

| endpoint | archive |
| --- | --- |
| `eth.drpc.org`, `eth.merkle.io`, `eth-mainnet.public.blastapi.io`, `rpc.mevblocker.io`, `gateway.tenderly.co/public/mainnet` | works |
| `ethereum-rpc.publicnode.com` | 403, "Archive requests require a personal token" |
| `1rpc.io/eth`, `eth.blockrazor.xyz` | "historical state is not available" |
| `rpc.flashbots.net` | "rpc method is not whitelisted" |
| `mainnet.base.org`, `base-mainnet.public.blastapi.io`, `gateway.tenderly.co/public/base`, `1rpc.io/base` | works |
| `base-rpc.publicnode.com` | 403 archive |
| `base.drpc.org` | 408, "Request timeout on the free plan" |
| `api.avax.network/ext/bc/C/rpc`, `avalanche.drpc.org`, `avalanche-mainnet.gateway.tenderly.co` | works |
| `avalanche-c-chain-rpc.publicnode.com`, `1rpc.io/avax/c` | "missing trie node" |

If your own node is better than all of these, `--rpc` takes it.

## If you get a different answer

That is the interesting outcome and it is the one this repository is built for.

Publish it. Post the row, the two block heights, the two share prices you read
and the endpoint you read them from. Kerne's commitment, in writing, is that a
row shown to be wrong gets corrected on the public board with both values and a
date, in the append-only corrections log at
[kerne.fi/honesty-index#corrections](https://kerne.fi/honesty-index#corrections),
and your finding gets linked from
[kerne.fi/honesty-index/reproduce](https://kerne.fi/honesty-index/reproduce)
whether it agrees with us or not.

You can also just open an issue here.

## Tests

```
npm test          # offline, no network, 29 assertions
npm run test:live # hits public RPC and kerne.fi
```

The offline suite verifies a **real signed snapshot committed to this
repository** (`test/fixtures/honesty-index-2026-08-13.json`). A signature over a
table of numbers stays checkable forever, so the verifier can be proven correct
without anyone needing kerne.fi to be up, or needing to trust that it serves the
same document today that it served then.

keccak256 is pinned to the published vectors and to well-known function
selectors, because a hand-written hash is the one place this project could be
silently wrong while still printing a confident answer. Note that Node's
built-in `sha3-256` is **not** keccak256: Ethereum uses the original padding
byte, which is why `src/keccak.mjs` exists at all.

## Prior art and siblings

- [kerne.fi/honesty-index](https://kerne.fi/honesty-index), the board this
  checks, including its methodology, its coverage limits and its corrections log.
- [huggingface.co/datasets/kerne-protocol/honesty-index](https://huggingface.co/datasets/kerne-protocol/honesty-index),
  the same data as a CC BY 4.0 dataset.
- [kerne-protocol/solhonesty](https://github.com/kerne-protocol/solhonesty),
  the same question asked on Solana, where the finding is that most advertised
  versus realized gaps are measuring the clock rather than the product.
- [kerne-protocol/signed-por](https://github.com/kerne-protocol/signed-por),
  a vendor-neutral verifier for the reserve attestations.

MIT licensed. Kerne Protocol is a synthetic dollar on Base and is itself the
worst row on the board it publishes, which is the reason to hand you the tool
rather than the summary.
