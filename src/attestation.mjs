// SPDX-License-Identifier: MIT
// Verify that the numbers you are about to check are the numbers Kerne signed.
//
// This matters more than it sounds. Reproducing a row against a JSON document
// that the publisher can silently rewrite proves nothing: the publisher can
// serve you whatever agrees with chain state today. The signature is what turns
// "these are the numbers we are showing you now" into "these were the numbers,
// and here is the key that says so".
//
// Three checks, all of which must pass, and each of which can fail on its own:
//
//   1. the published attestation_hash really is sha256 over the published
//      canonical string BYTES (hash the bytes; never re-serialize to verify);
//   2. the signature recovers to the published signer address;
//   3. rebuilding the canonical form from the rows in the document reproduces
//      those exact bytes, so the signature is bound to THESE rows and not to
//      some other table that was signed once and quoted forever.
//
// Check 3 is the one that catches an edited row, and it is the one most
// signature checkers skip.

import { createHash } from 'node:crypto';
import { keccak256 } from './keccak.mjs';
import { recoverPublicKey, splitSignature, hexToBytes } from './secp256k1.mjs';

export function sha256Hex(str) {
  return '0x' + createHash('sha256').update(Buffer.from(str, 'utf8')).digest('hex');
}

/** keccak256("\x19Ethereum Signed Message:\n32" || hashBytes) */
function personalSignDigest(msgBytes) {
  const prefix = new TextEncoder().encode('Ethereum Signed Message:\n' + msgBytes.length);
  const full = new Uint8Array(prefix.length + msgBytes.length);
  full.set(prefix, 0);
  full.set(msgBytes, prefix.length);
  return keccak256(full);
}

/**
 * Recover the address that signed the raw bytes of `hashHex` under EIP-191
 * personal_sign. Returns a lowercase 0x address, or null.
 */
export function recoverPersonalSign(hashHex, signatureHex) {
  const msgBytes = hexToBytes(hashHex);
  if (!msgBytes || msgBytes.length !== 32) return null;
  const parts = splitSignature(signatureHex);
  if (!parts) return null;
  const digest = personalSignDigest(msgBytes);
  const pub = recoverPublicKey(digest, parts.r, parts.s, parts.recid);
  if (!pub) return null;
  const addr = keccak256(pub).slice(12);
  return '0x' + Buffer.from(addr).toString('hex');
}

/**
 * Rebuild the canonical signed payload from the rows of a snapshot.
 *
 * The field order below is the field order of the producer. JSON.stringify
 * preserves insertion order for string keys, so a canonical form built here has
 * to declare its keys in the same sequence or the bytes differ and check 3
 * fails for a document that was never tampered with. If Kerne ever changes this
 * shape, this function is what has to change with it, and the mismatch is loud
 * rather than silent.
 */
export function buildSignablePayload(snapshot) {
  return {
    kind: snapshot.kind,
    generated_at: snapshot.generated_at,
    window_days: snapshot.window_days,
    rows: snapshot.rows.map((r) => ({
      key: r.key,
      protocol: r.protocol,
      symbol: r.symbol,
      chain: r.chain,
      address: String(r.address).toLowerCase(),
      status: r.status,
      realized_ok: r.realized?.ok === true,
      realized_reason: r.realized?.reason ?? null,
      realized_annualized_pct: r.realized?.annualizedPct ?? null,
      realized_growth_pct: r.realized?.growthPct ?? null,
      pps_from: r.realized?.ppsFrom ?? null,
      pps_to: r.realized?.ppsTo ?? null,
      from_block: r.realized?.fromBlock ?? null,
      to_block: r.realized?.toBlock ?? null,
      window_days: r.realized?.windowDays ?? null,
      advertised: (r.advertised ?? []).map((a) => ({
        label: a.label,
        pct: a.pct,
        basis: a.basis,
        source_url: a.sourceUrl,
        captured_at: a.capturedAt,
        verbatim: a.verbatim,
      })),
    })),
    signer: String(snapshot.signer).toLowerCase(),
  };
}

/**
 * Run all three checks. Returns a result object rather than a boolean, because
 * "the signature is bad" and "the rows were edited after signing" are different
 * accusations and a verifier should be able to tell you which one it is making.
 */
export function verifySnapshot(snapshot) {
  const out = {
    hashMatches: false,
    signerRecovered: null,
    signerMatches: false,
    rowsBound: false,
    ok: false,
    notes: [],
  };

  const { signature, signer, attestation_hash: hash, signed_payload_canonical: canonical } = snapshot;
  if (typeof signature !== 'string' || typeof signer !== 'string' || typeof hash !== 'string' || typeof canonical !== 'string') {
    out.notes.push('The document is missing one of signature, signer, attestation_hash, signed_payload_canonical.');
    return out;
  }

  out.hashMatches = sha256Hex(canonical).toLowerCase() === hash.toLowerCase();
  if (!out.hashMatches) out.notes.push('attestation_hash is not sha256 of the published canonical bytes.');

  out.signerRecovered = recoverPersonalSign(hash, signature);
  out.signerMatches = !!out.signerRecovered && out.signerRecovered.toLowerCase() === signer.toLowerCase();
  if (!out.signerMatches) {
    out.notes.push(
      out.signerRecovered
        ? `Signature recovers to ${out.signerRecovered}, not to the published signer ${signer}.`
        : 'Signature did not recover to any address.',
    );
  }

  try {
    const rebuilt = JSON.stringify(buildSignablePayload(snapshot));
    out.rowsBound = rebuilt === canonical;
    if (!out.rowsBound) {
      out.notes.push('The rows in this document do not rebuild the canonical bytes that were signed.');
    }
  } catch (e) {
    out.notes.push('Could not rebuild the canonical payload: ' + e.message);
  }

  out.ok = out.hashMatches && out.signerMatches && out.rowsBound;
  return out;
}
