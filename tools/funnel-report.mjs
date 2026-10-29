#!/usr/bin/env node
// funnel-report — read an x402 seller's ledger and separate TRAFFIC from DEMAND.
//
// The number that matters is not "calls": it is distinct paying wallets and how often each one
// comes back. This tool classifies every settled payment into:
//
//   self-pay  — a wallet you control (listing triggers, sweeps). Not revenue.
//   sweep     — one payment, one call, never returns. The characteristic crawler signature.
//   repeat    — the same wallet paid 3+ times (r >= 3). The only honest demand signal.
//   one-shot  — an external wallet that paid once or twice (may become repeat, may be a sweep)
//
// Usage:
//   node tools/funnel-report.mjs --db ./data/ledger.db --ours 0xYou1,0xYou2 [--days 30] [--json out.json]
//
// Expected schema (see examples/ledger-schema.sql):
//   calls(endpoint TEXT, status TEXT, ts INTEGER)                       status: '402-challenge' | 'settled' | 'error'
//   settlements(endpoint TEXT, amount_usdc REAL, payer TEXT, tx_hash TEXT, ts INTEGER)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const out = { db: '', ours: [], days: 0, json: '', all: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') out.db = argv[++i] || '';
    else if (a === '--ours') out.ours = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--days') out.days = Number(argv[++i] || 0);
    else if (a === '--json') out.json = argv[++i] || '';
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.db) {
  console.log(`funnel-report — separate traffic from demand in an x402 seller ledger

  --db <path>        path to the SQLite ledger (node:sqlite, Node >= 22)
  --ours 0xA,0xB     wallets YOU control (listing triggers / self-pay sweeps) — excluded from revenue
  --days <n>         only consider the last n days (0 = all time)
  --json <path>      also write the report as JSON

Why --ours matters: a listing trigger (paying your own endpoint so the index picks it up) is
indistinguishable in public dashboards from a genuine first sale. Marking your own wallets is the
only way to keep the number honest.`);
  process.exit(0);
}

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('node:sqlite unavailable — needs Node >= 22. Error: ' + e.message);
  process.exit(1);
}

const db = new DatabaseSync(args.db, { readOnly: true });
const since = args.days > 0 ? Date.now() - args.days * 86400000 : 0;
const ours = new Set(args.ours.map((a) => a.toLowerCase()));

const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);

// ---- traffic --------------------------------------------------------------------------------
const challenges = one(
  `SELECT COUNT(*) n FROM calls WHERE status='402-challenge' AND ts >= ?`, since).n;
const perRoute = all(
  `SELECT endpoint,
          SUM(CASE WHEN status='402-challenge' THEN 1 ELSE 0 END) challenges,
          SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END)        settles
     FROM calls WHERE ts >= ? GROUP BY endpoint ORDER BY challenges DESC`, since);

// ---- settlements, classified ----------------------------------------------------------------
const rows = all(
  `SELECT payer, endpoint, amount_usdc, tx_hash, ts FROM settlements WHERE ts >= ?`, since);

const byPayer = new Map();
for (const r of rows) {
  const key = String(r.payer || 'unknown').toLowerCase();
  const e = byPayer.get(key) || { payer: r.payer, payments: 0, usdc: 0, routes: new Set(), first: r.ts, last: r.ts, self: ours.has(key) };
  e.payments += 1;
  e.usdc += Number(r.amount_usdc || 0);
  e.routes.add(r.endpoint);
  e.first = Math.min(e.first, r.ts);
  e.last = Math.max(e.last, r.ts);
  byPayer.set(key, e);
}

const wallets = [...byPayer.values()];
const selfPay = wallets.filter((w) => w.self);
const external = wallets.filter((w) => !w.self);
const sweep = external.filter((w) => w.payments === 1);
const repeat = external.filter((w) => w.payments >= 3);
const oneshot = external.filter((w) => w.payments === 2);

const sum = (arr) => arr.reduce((s, w) => s + w.usdc, 0);
const fmt = (n) => '$' + n.toFixed(4);

// ---- report ---------------------------------------------------------------------------------
console.log(`\nx402 funnel report — ${args.db}${args.days ? ` — last ${args.days} days` : ' — all time'}`);
console.log('='.repeat(78));
console.log(`challenges (402s served)      ${challenges}`);
console.log(`settlements                   ${rows.length}`);
console.log(`conversion                    ${challenges ? ((rows.length / challenges) * 100).toFixed(2) : '0.00'}%  (settles / challenges)\n`);

console.log(`REVENUE THAT IS REAL          ${fmt(sum(external))}   from ${external.length} external wallet(s)`);
console.log(`  repeat (r >= 3)             ${fmt(sum(repeat))}   ${repeat.length} wallet(s)   <- the only honest demand signal`);
console.log(`  one-shot (2 payments)       ${fmt(sum(oneshot))}   ${oneshot.length} wallet(s)`);
console.log(`  single-payment wallets      ${fmt(sum(sweep))}   ${sweep.length} wallet(s)   <- sweep signature`);
console.log(`SELF-PAY (your own wallets)   ${fmt(sum(selfPay))}   ${selfPay.length} wallet(s)   <- listing triggers, NOT revenue\n`);

const byBand = {};
for (const w of external) (byBand[w.routes.size] ||= []).push(w);
console.log('per-route funnel:');
console.log(`  ${'route'.padEnd(22)} ${'challenges'.padStart(10)} ${'settles'.padStart(8)} ${'conv'.padStart(7)}`);
for (const r of perRoute) {
  const conv = r.challenges ? ((r.settles / r.challenges) * 100).toFixed(2) + '%' : '-';
  console.log(`  ${String(r.endpoint).padEnd(22)} ${String(r.challenges).padStart(10)} ${String(r.settles).padStart(8)} ${conv.padStart(7)}`);
}

if (external.length) {
  console.log('\nexternal wallets (newest first):');
  for (const w of external.sort((a, b) => b.last - a.last)) {
    const kind = w.payments >= 3 ? 'repeat' : w.payments === 2 ? 'one-shot' : 'single';
    console.log(`  ${w.payer}  ${String(w.payments).padStart(2)}x  ${fmt(w.usdc).padStart(9)}  ${kind.padEnd(8)}  ${[...w.routes].join(',')}`);
  }
}

console.log(`
reading this honestly:
  - challenges are crawlers, monitors and liveness probes. They cannot buy.
  - a single-payment external wallet is the sweep signature: one call, never returns.
  - repeat wallets are the business. Everything else is a rounding error.
  - if challenges are high, settles are low, and the priced routes have zero external settles,
    the problem is demand, not your description.`);

if (args.json) {
  const fs = require('node:fs');
  fs.writeFileSync(args.json, JSON.stringify({
    at: new Date().toISOString(), db: args.db, days: args.days,
    challenges, settlements: rows.length,
    revenue: { external: sum(external), selfPay: sum(selfPay) },
    wallets: { external: external.length, repeat: repeat.length, oneShot: oneshot.length, single: sweep.length, selfPay: selfPay.length },
    perRoute,
  }, null, 2));
  console.log(`\nwrote ${args.json}`);
}
