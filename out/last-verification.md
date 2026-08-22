# Last independent verification

Snapshot 2026-08-22T07:37:19.700Z, signer 0x84949170e0ad0f9bd8686a4aa4922c10f5fdc4ea.

| result | rows |
| --- | --- |
| reproduced exactly | 15 |
| did NOT reproduce | 0 |
| publish no realized figure | 0 |
| could not be read this run | 6 |

Signature: verified, and the rows are bound to it.

Run from a clean clone by a GitHub runner. Reproduce it yourself with
`node bin/realized-apy.mjs check`.

- unread cap-stcusd: One endpoint could not answer eth_call at "0x189d151", which usually means it is behind. Retry, or pin an older block.
- unread curve-scrvusd: One endpoint could not answer eth_call at "0x189d151", which usually means it is behind. Retry, or pin an older block.
- unread ethena-susde: One endpoint could not answer eth_call at "0x189d151", which usually means it is behind. Retry, or pin an older block.
- unread spark-susdc: One endpoint could not answer eth_call at "0x189d151", which usually means it is behind. Retry, or pin an older block.
- unread usual-susd0: One endpoint could not answer eth_call at "0x189d151", which usually means it is behind. Retry, or pin an older block.
- unread yieldfi-yusd: One endpoint could not answer eth_call at "0x189d151", which usually means it is behind. Retry, or pin an older block.