# Last independent verification

Snapshot 2026-09-01T00:40:56.233Z, signer undefined.

| result | rows |
| --- | --- |
| reproduced exactly | 17 |
| did NOT reproduce | 0 |
| publish no realized figure | 0 |
| could not be read this run | 4 |

Signature: DID NOT VERIFY.

Run from a clean clone by a GitHub runner. Reproduce it yourself with
`node bin/realized-apy.mjs check`.

- unread aegis-syusd: One endpoint could not answer eth_call at "0x18ae178", which usually means it is behind. Retry, or pin an older block.
- unread avant-savusd: One endpoint could not answer eth_call at "0x59cccec", which usually means it is behind. Retry, or pin an older block.
- unread cap-stcusd: One endpoint could not answer eth_call at "0x18ae178", which usually means it is behind. Retry, or pin an older block.
- unread curve-scrvusd: One endpoint could not answer eth_call at "0x18ae178", which usually means it is behind. Retry, or pin an older block.