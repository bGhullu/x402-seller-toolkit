#!/usr/bin/env node
// rank-probe — how does YOUR x402 host rank for the queries a buyer would actually type?
//
// The Bazaar exposes a public semantic search. Sellers edit descriptions, see nothing change, and
// conclude "discovery is broken". Two measured causes explain most of it:
//   1. the index only refreshes a listing when that route SETTLES again;
//   2. ranking is quality-ordered (payers, call volume, recency), not keyword-ordered.
// Vocabulary buys inclusion; calls buy position.
//
// Usage:
//   node tools/rank-probe.mjs --host my-host.ts.net --queries "token security,honeypot check"
//   node tools/rank-probe.mjs --host my-host.ts.net --queries-file queries.txt --json rank.json
//   node tools/rank-probe.mjs --host my-host.ts.net --queries "ping" --baseline rank.json
//
// Exit code is always 0 — this is a measurement tool, not a gate.

import fs from 'node:fs';

const SEARCH = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HELP = [
  'rank-probe — measure your x402 listing rank in the public Bazaar semantic search',
  '',
  '  --host <host>          listing host to match, e.g. my-host.ts.net',
  '  --queries "a,b,c"      literal queries a buyer would type',
  '  --queries-file <path>  one query per line, # comments allowed',
  '  --json <path>          write results as JSON (feed it back with --baseline to see movement)',
  '  --baseline <path>      compare against a previous JSON run',
  '',
  'Notes:',
  '  - the search returns at most ~20 results per query; keep each query single-intent',
  '  - absent from a query can mean thin competition OR bottom-decile quality, not necessarily no demand',
  '  - re-run after every metadata edit, and after the settle that follows it',
].join('\n');

function parseArgs(argv) {
  const out = { queries: [], host: '', json: '', baseline: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') out.host = argv[++i] || '';
    else if (a === '--queries') out.queries.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--queries-file') {
      const p = argv[++i];
      if (p && fs.existsSync(p)) {
        out.queries.push(
          ...fs.readFileSync(p, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
        );
      }
    } else if (a === '--json') out.json = argv[++i] || '';
    else if (a === '--baseline') out.baseline = argv[++i] || '';
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.host || !args.queries.length) {
  console.log(HELP);
  process.exit(0);
}

const baseline =
  args.baseline && fs.existsSync(args.baseline) ? JSON.parse(fs.readFileSync(args.baseline, 'utf8')) : null;

const host = args.host.toLowerCase();
const results = {};
let appeared = 0;

async function search(q) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(SEARCH + encodeURIComponent(q), { signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(700);
    }
  }
}

console.log('rank-probe  host=' + args.host + '  queries=' + args.queries.length + '  ' + new Date().toISOString());
console.log('');
console.log('query'.padEnd(28) + 'rank'.padEnd(14) + 'total  top hit');
console.log('-'.repeat(94));

for (const q of args.queries) {
  let data;
  try {
    data = await search(q);
  } catch (e) {
    console.log(q.slice(0, 27).padEnd(28) + 'ERROR'.padEnd(14) + e.message);
    continue;
  }
  const resources = data.resources || [];
  const mine = [];
  resources.forEach((r, i) => {
    const url = String(r.resource || '');
    if (url.toLowerCase().includes(host)) mine.push({ rank: i + 1, url, serviceName: r.serviceName || null });
  });
  if (mine.length) appeared++;

  const top = resources[0] ? String(resources[0].resource || '').slice(0, 42) : '-';
  let rankStr = mine.length ? mine.map((m) => '#' + m.rank).join(',') : 'absent';

  if (baseline && baseline.results && baseline.results[q]) {
    const before = baseline.results[q].ranks || [];
    const after = mine.map((m) => m.rank);
    if (!before.length && after.length) rankStr += ' NEW';
    else if (before.length && !after.length) rankStr += ' LOST';
    else if (before.length && after.length && before[0] !== after[0]) rankStr += ' ' + before[0] + '->' + after[0];
    else if (before.length) rankStr += ' =';
  }

  console.log(q.slice(0, 27).padEnd(28) + rankStr.padEnd(14) + String(resources.length).padStart(5) + '  ' + top);
  results[q] = { ranks: mine.map((m) => m.rank), total: resources.length, matched: mine, topHit: resources[0] ? resources[0].resource : null };
  await sleep(400);
}

console.log('-'.repeat(94));
console.log('');
console.log('appeared in ' + appeared + '/' + args.queries.length + ' queries');
if (args.json) {
  fs.writeFileSync(args.json, JSON.stringify({ host: args.host, at: new Date().toISOString(), results }, null, 2));
  console.log('wrote ' + args.json + ' (pass it as --baseline next time to see movement)');
}
