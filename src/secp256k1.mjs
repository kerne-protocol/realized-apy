// SPDX-License-Identifier: MIT
// secp256k1 public-key recovery, in BigInt, with no dependencies.
//
// This exists for one narrow job: given the 32-byte attestation hash and the
// 65-byte signature Kerne publishes beside a snapshot, work out which Ethereum
// address produced it, without trusting anything that Kerne wrote. A verifier
// that has to `npm install` a wallet SDK to check a signature is a verifier
// most people will not run.
//
// Fail closed. Every malformed, out-of-range or non-canonical input returns
// null. A caller that treats null as "unverified" cannot be tricked.

const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function mod(a, m = P) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function powMod(base, exp, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function invMod(a, m) {
  // Extended Euclid. Returns null when a is not invertible.
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) return null;
  return mod(old_s, m);
}

// Points are Jacobian {X, Y, Z}; Z === 0n is the point at infinity.
const INF = { X: 0n, Y: 1n, Z: 0n };

function jDouble(p) {
  if (p.Z === 0n || p.Y === 0n) return INF;
  const { X: X1, Y: Y1, Z: Z1 } = p;
  const A = mod(X1 * X1);
  const B = mod(Y1 * Y1);
  const C = mod(B * B);
  const D = mod(2n * (mod((X1 + B) * (X1 + B)) - A - C));
  const E = mod(3n * A);
  const F = mod(E * E);
  const X3 = mod(F - 2n * D);
  const Y3 = mod(E * (D - X3) - 8n * C);
  const Z3 = mod(2n * Y1 * Z1);
  return { X: X3, Y: Y3, Z: Z3 };
}

function jAdd(p, q) {
  if (p.Z === 0n) return q;
  if (q.Z === 0n) return p;
  const Z1Z1 = mod(p.Z * p.Z);
  const Z2Z2 = mod(q.Z * q.Z);
  const U1 = mod(p.X * Z2Z2);
  const U2 = mod(q.X * Z1Z1);
  const S1 = mod(p.Y * q.Z * Z2Z2);
  const S2 = mod(q.Y * p.Z * Z1Z1);
  if (U1 === U2) {
    if (S1 !== S2) return INF;
    return jDouble(p);
  }
  const H = mod(U2 - U1);
  const I = mod(mod(2n * H) * mod(2n * H));
  const J = mod(H * I);
  const r = mod(2n * (S2 - S1));
  const V = mod(U1 * I);
  const X3 = mod(r * r - J - 2n * V);
  const Y3 = mod(r * (V - X3) - 2n * S1 * J);
  const Z3 = mod((mod((p.Z + q.Z) * (p.Z + q.Z)) - Z1Z1 - Z2Z2) * H);
  return { X: X3, Y: Y3, Z: Z3 };
}

function jMul(k, p) {
  let acc = INF;
  let addend = p;
  let n = mod(k, N);
  while (n > 0n) {
    if (n & 1n) acc = jAdd(acc, addend);
    addend = jDouble(addend);
    n >>= 1n;
  }
  return acc;
}

function toAffine(p) {
  if (p.Z === 0n) return null;
  const zInv = invMod(p.Z, P);
  if (zInv === null) return null;
  const zInv2 = mod(zInv * zInv);
  return { x: mod(p.X * zInv2), y: mod(p.Y * zInv2 * zInv) };
}

function strip0x(h) {
  return typeof h === 'string' && (h.startsWith('0x') || h.startsWith('0X')) ? h.slice(2) : h;
}

function hexToBytes(hex) {
  const h = strip0x(hex);
  if (typeof h !== 'string' || h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Recover the uncompressed public key (64 bytes, X||Y) for a signature over a
 * 32-byte digest. `recid` is 0..3. Returns null on any failure.
 */
export function recoverPublicKey(digestBytes, r, s, recid) {
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  if (recid < 0 || recid > 3) return null;
  // EIP-2: reject the malleable high-s twin outright. Every conformant signer
  // emits low-s, so this rejects only a mutated copy, never a genuine signature.
  if (s > N / 2n) return null;

  const x = recid >= 2 ? r + N : r;
  if (x >= P) return null;

  // y^2 = x^3 + 7
  const alpha = mod(mod(x * x * x) + 7n);
  const beta = powMod(alpha, (P + 1n) / 4n, P);
  if (mod(beta * beta) !== alpha) return null; // x is not on the curve
  const y = (beta & 1n) === BigInt(recid & 1) ? beta : mod(P - beta);

  const R = { X: x, Y: y, Z: 1n };
  const G = { X: GX, Y: GY, Z: 1n };

  let z = 0n;
  for (const b of digestBytes) z = (z << 8n) | BigInt(b);
  // Left-align: the digest is exactly 32 bytes here, so only the reduction mod n applies.
  z = mod(z, N);

  const rInv = invMod(r, N);
  if (rInv === null) return null;

  // Q = r^-1 (sR - zG)
  const sR = jMul(s, R);
  const zG = jMul(mod(N - z, N), G); // -zG
  const sum = jAdd(sR, zG);
  const Q = jMul(rInv, sum);
  const aff = toAffine(Q);
  if (!aff) return null;

  const out = new Uint8Array(64);
  const xb = aff.x.toString(16).padStart(64, '0');
  const yb = aff.y.toString(16).padStart(64, '0');
  out.set(hexToBytes(xb), 0);
  out.set(hexToBytes(yb), 32);
  return out;
}

/**
 * Split a 65-byte hex signature into {r, s, recid}. Accepts v of 27/28 or 0/1
 * (and the 31/32 form some libraries emit). Returns null on anything else.
 */
export function splitSignature(sigHex) {
  const bytes = hexToBytes(sigHex);
  if (!bytes || bytes.length !== 65) return null;
  let r = 0n;
  let s = 0n;
  for (let i = 0; i < 32; i++) r = (r << 8n) | BigInt(bytes[i]);
  for (let i = 32; i < 64; i++) s = (s << 8n) | BigInt(bytes[i]);
  let v = bytes[64];
  if (v === 27 || v === 28) v -= 27;
  else if (v === 31 || v === 32) v -= 31;
  if (v !== 0 && v !== 1) return null;
  return { r, s, recid: v };
}

export { P, N, GX, GY, hexToBytes };
