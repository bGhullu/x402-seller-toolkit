#!/usr/bin/env node
// buyer-ref — reference implementation of a CAPPED x402 buyer agent.
//
// The point of this file is the policy layer, not the payment call. An autonomous spender must not be
// able to raise its own limits, and its accounting must come from the chain, not from a response
// header the seller controls.
//
// Dependencies (optional — install only if you use this file):
//     npm i viem @x402/fetch @x402/evm
// Environment:
//     BUYER_PRIVATE_KEY       dedicated low-cap hot wallet. USDC only — EIP-3009 is gasless for the
//                             buyer (the facilitator submits and pays gas), so no ETH is needed.
//     BUYER_DAILY_CAP_USDC    hard daily ceiling (default 1.00)
//     BUYER_LEDGER            optional path to a SQLite ledger (node:sqlite) used for the daily total
//     BUYER_OURS              comma-separated addresses considered "ours" (excluded from spend)
//
// Usage:
//     node ref/buyer-ref.mjs <url> [maxPriceUsdc] [method]
//
// Policy enforced BEFORE any signature:
//   1. per-call maximum (argument, default 0.05)
//   2. daily total read from the ledger on disk — in-memory counters silently reset on restart
//   3. pre-pay probe with the request's REAL method: a GET probe on a POST-only route 404s and looks
//      like a dead endpoint, so the buyer would refuse a perfectly good seller
//   4. every refusal is logged, not swallowed

let wrapFetchWithPayment, x402Client, registerExactEvmScheme, privateKeyToAccount;

try {
  ({ wrapFetchWithPayment, x402Client } = await import('@x402/fetch'));
  ({ registerExactEvmScheme } = await import('@x402/evm/exact/client'));
  ({ privateKeyToAccount } = await import('viem/accounts'));
} catch (e) {
  console.error('buyer-ref needs: npm i viem @x402/fetch @x402/evm');
  console.error('install error: ' + e.message);
  process.exit(2);
}

const PK = process.env.BUYER_PRIVATE_KEY;
const CAP = Number(process.env.BUYER_DAILY_CAP_USDC || 1.0);
const LEDGER = process.env.BUYER_LEDGER || '';

if (!PK) {
  console.error('BUYER_PRIVATE_KEY not set. Use a dedicated low-cap wallet — never your main one.');
  process.exit(1);
}

const account = privateKeyToAccount(PK);

// ---- daily spend, read from disk so a restart cannot reset the cap --------------------------
async function spentTodayUtc() {
  if (!LEDGER) return 0;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(LEDGER, { readOnly: true });
    const dayStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const row = db.prepare('SELECT COALESCE(SUM(amount_usdc),0) s FROM buyer_spend WHERE ts >= ?').get(dayStart);
    return Number(row?.s || 0);
  } catch {
    // No ledger (or an older Node): the cap then only holds within this process. Say so loudly —
    // a silent fallback is how an agent outspends its budget after a restart.
    console.error('[buyer] WARNING: no ledger read — daily cap is per-process only for this run');
    return 0;
  }
}

const already = await spentTodayUtc();
const remaining = Math.max(0, CAP - already);

async function probe402(url, method) {
  try {
    const res = await fetch(url, { method, signal: AbortSignal.timeout(8000) });
    if (res.status !== 402) return { ok: false, reason: `expected 402, got ${res.status}` };
    const hdr = res.headers.get('payment-required') || res.headers.get('x-payment-required');
    if (!hdr) return { ok: false, reason: '402 without a payment-required header — not x402 v2' };
    let price = null;
    try {
      const j = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8'));
      const a = (j.accepts || [{}])[0];
      price = a.amount ? Number(a.amount) / 1e6 : null;
    } catch { /* header not decodable as JSON — treat price as unknown */ }
    return { ok: true, price };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Authoritative spend: the settlement tx's own USDC Transfer logs (v2 receipts omit `amount`).
async function actualSpendUsdc(txHash, usdc, rpcUrl) {
  const { createPublicClient, http } = await import('viem');
  const { base } = await import('viem/chains');
  const pc = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const receipt = await pc.getTransactionReceipt({ hash: txHash });
  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdc.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    const from = '0x' + log.topics[1].slice(26);
    if (from.toLowerCase() !== account.address.toLowerCase()) continue;
    total += BigInt(log.data);
  }
  return Number(total) / 1e6;
}

const [url, maxPriceArg, methodArg] = process.argv.slice(2);
if (!url) {
  console.log('usage: node ref/buyer-ref.mjs <url> [maxPriceUsdc] [method]');
  process.exit(0);
}
const maxPrice = Number(maxPriceArg || 0.05);
const method = (methodArg || 'GET').toUpperCase();

console.log(`[buyer] ${account.address} | cap $${CAP}/day | spent today $${already.toFixed(4)} | remaining $${remaining.toFixed(4)}`);

const probe = await probe402(url, method);
if (!probe.ok) {
  console.log(JSON.stringify({ ok: false, stage: 'probe', reason: probe.reason }));
  process.exit(1);
}
if (probe.price !== null && probe.price > maxPrice) {
  console.log(JSON.stringify({ ok: false, stage: 'policy', reason: `price $${probe.price} exceeds per-call max $${maxPrice}` }));
  process.exit(1);
}
if (maxPrice > remaining) {
  console.log(JSON.stringify({ ok: false, stage: 'policy', reason: `per-call max $${maxPrice} exceeds remaining daily budget $${remaining.toFixed(4)}` }));
  process.exit(1);
}

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(fetch, client);

try {
  const res = await paidFetch(url, { method });
  const hdr = res.headers.get('payment-response') || res.headers.get('x-payment-response');
  let settlement = null;
  if (hdr) { try { settlement = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')); } catch { /* plain receipt */ } }

  let spent = 0;
  if (res.ok && settlement?.transaction) {
    spent = await actualSpendUsdc(settlement.transaction, process.env.USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', process.env.RPC_URL || 'https://base-rpc.publicnode.com');
  }
  const body = await res.json().catch(() => null);
  console.log(JSON.stringify({ ok: res.ok, status: res.status, spentUsdc: spent, settlement, data: body }, null, 2));
} catch (e) {
  // A thrown error from the seller's handler means NO payment was taken (the middleware settles only
  // on handler success) — but do not assume: check your ledger before retrying.
  console.log(JSON.stringify({ ok: false, stage: 'pay', reason: e.message, note: 'check the ledger: a 5xx from the handler usually means nothing settled' }));
  process.exit(1);
}
