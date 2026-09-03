# Last independent verification

Snapshot 2026-09-03T11:37:14.058Z, signer 0x84949170e0ad0f9bd8686a4aa4922c10f5fdc4ea.

| result | rows |
| --- | --- |
| reproduced exactly | 15 |
| did NOT reproduce | 0 |
| publish no realized figure | 0 |
| could not be read this run | 6 |

Signature: verified, and the rows are bound to it.

Run from a clean clone by a GitHub runner. Reproduce it yourself with
`node bin/realized-apy.mjs check`.

- unread aegis-syusd: One endpoint could not answer eth_call at "0x18b264d", which usually means it is behind. Retry, or pin an older block.
- unread cap-stcusd: One endpoint could not answer eth_call at "0x18b264d", which usually means it is behind. Retry, or pin an older block.
- unread neutrl-snusd: One endpoint could not answer eth_call at "0x18b264d", which usually means it is behind. Retry, or pin an older block.
- unread tori-strusd: One endpoint could not answer eth_call at "0x18b264d", which usually means it is behind. Retry, or pin an older block.
- unread stableslabs-susdx: One endpoint could not answer eth_call at "0x18b264d", which usually means it is behind. Retry, or pin an older block.
- unread resolv-wstusr: One endpoint could not answer eth_call at "0x18b264d", which usually means it is behind. Retry, or pin an older block.