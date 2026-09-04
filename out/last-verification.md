# Last independent verification

Snapshot 2026-09-04T10:37:13.907Z, signer 0x84949170e0ad0f9bd8686a4aa4922c10f5fdc4ea.

| result | rows |
| --- | --- |
| reproduced exactly | 16 |
| did NOT reproduce | 0 |
| publish no realized figure | 0 |
| could not be read this run | 5 |

Signature: verified, and the rows are bound to it.

Run from a clean clone by a GitHub runner. Reproduce it yourself with
`node bin/realized-apy.mjs check`.

- unread kerne-skusd: One endpoint could not answer eth_call at "0x3082135", which usually means it is behind. Retry, or pin an older block.
- unread aegis-syusd: One endpoint could not answer eth_call at "0x18b4128", which usually means it is behind. Retry, or pin an older block.
- unread sky-susds: One endpoint could not answer eth_call at "0x18b4128", which usually means it is behind. Retry, or pin an older block.
- unread usual-susd0: One endpoint could not answer eth_call at "0x18b4128", which usually means it is behind. Retry, or pin an older block.
- unread yieldfi-yusd: One endpoint could not answer eth_call at "0x18b4128", which usually means it is behind. Retry, or pin an older block.