# Last independent verification

Snapshot 2026-10-07T13:37:29.155Z, signer 0x84949170e0ad0f9bd8686a4aa4922c10f5fdc4ea.

| result | rows |
| --- | --- |
| reproduced exactly | 20 |
| did NOT reproduce | 0 |
| publish no realized figure | 0 |
| could not be read this run | 1 |

Signature: verified, and the rows are bound to it.

Run from a clean clone by a GitHub runner. Reproduce it yourself with
`node bin/realized-apy.mjs check`.

- unread avant-savusd: One endpoint could not answer eth_call at "0x5c777d0", which usually means it is behind. Retry, or pin an older block.