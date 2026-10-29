#!/usr/bin/env node
// metadata-lint — find the silent mistakes that stop an x402 listing from ever being called.
//
// Checks each paid route of a live seller:
//   1. GET variant exists (directory crawlers and trust probes send GET/HEAD only — a POST-only
//      route fails every probe and cannot be listed)
//   2. the route itself answers 402 with a payment-required header (a 200 at the registered URL
//      fails the "probe the submitted URL" check)
//   3. the route appears in /openapi.json with x-payment info (x402scan and some catalogs treat
//      OpenAPI as canonical discovery)
//   4. the discovery description contains the words a BUYER would type (vocabulary buys inclusion)
//
// Usage:
//   node tools/metadata-lint.mjs --base https://my-host.example [--terms "honeypot,rug pull,token security"]
//                                [--openapi https://my-host.example/openapi.json] [--json out.json]
//
// Notes: --base must be the PUBLIC url advertised in your 402 challenge (not localhost), because
// that is what the index lists. Exit code 1 if any route fails a hard check, 0 otherwise.

function parseArgs(argv) {
  const out = { base: '', terms: ['honeypot', 'rug pull', 'scam', 'token security', 'due diligence', 'x402 test'], openapi: '', json: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || '').replace(/\/$/, '');
    else if (a === '--terms') out.terms = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--openapi') out.openapi = argv[++i] || '';
    else if (a === '--json') out.json = argv[++i] || '';
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.base) {
  console.log(`metadata-lint — check a live x402 seller for listing-blocking mistakes

  --base <url>          public base URL (the one advertised in your 402 challenge)
  --terms "a,b,c"       buyer-vocabulary terms your descriptions should contain
  --openapi <url>       override the OpenAPI location (default: <base>/openapi.json)
  --json <path>         write machine-readable results

Hard failures (exit 1): no GET variant for a paid path, route not answering 402, route missing
from OpenAPI. Soft warnings: description missing all buyer terms, missing 402 header.`);
  process.exit(0);
}

const openapiUrl = args.openapi || `${args.base}/openapi.json`;
const results = { at: new Date().toISOString(), base: args.base, routes: [], problems: [], warnings: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function head(method, url) {
  try {
    const res = await fetch(url, { method, signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
    const hdr = res.headers.get('payment-required') || res.headers.get('x-payment-required');
    return { status: res.status, hasChallenge: Boolean(hdr), challenge: hdr };
  } catch (e) {
    return { status: 'ERR', error: e.message };
  }
}

function decodeChallenge(hdr) {
  try {
    const j = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8'));
    const a = (j.accepts || [{}])[0];
    return { network: a.network, amount: a.amount, payTo: a.payTo, price: a.amount ? `$${(Number(a.amount) / 1e6).toString()}` : null };
  } catch { return null; }
}

// ---- load declared routes from OpenAPI ------------------------------------------------------
let spec = null;
try {
  const res = await fetch(openapiUrl, { signal: AbortSignal.timeout(15000) });
  spec = await res.json();
} catch (e) {
  console.log(`! could not read ${openapiUrl}: ${e.message}`);
  console.log('  (publish /openapi.json — several catalogs treat it as the canonical discovery format)');
  results.problems.push({ check: 'openapi-unreadable', url: openapiUrl, error: e.message });
}

const paidPaths = [];
if (spec?.paths) {
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (op?.['x-payment']?.required) paidPaths.push({ path, method: method.toUpperCase(), description: op.description || '' });
    }
  }
}

if (!paidPaths.length) {
  console.log('! no paid routes found in OpenAPI (x-payment.required) — nothing to lint');
}

const seen = new Set();
console.log(`\nmetadata-lint — ${args.base}\n${'route'.padEnd(34)} ${'status'.padEnd(9)} ${'challenge'.padEnd(10)} checks`);
console.log('-'.repeat(96));

for (const r of paidPaths) {
  const key = `${r.path}`;
  const url = args.base + r.path;
  const rows = [];

  // 1. the route as declared (usually POST)
  const asDeclared = await head(r.method === 'GET' ? 'GET' : 'POST', url);
  rows.push(`${r.method}:${asDeclared.status}${asDeclared.hasChallenge ? '+hdr' : ''}`);

  // 2. GET variant — the listing blocker nobody notices
  let getRes = r.method === 'GET' ? asDeclared : await head('GET', url);
  if (r.method !== 'GET') rows.push(`GET:${getRes.status}${getRes.hasChallenge ? '+hdr' : ''}`);
  const getOk = getRes.status === 402;
  if (!getOk && r.method !== 'GET') results.problems.push({ check: 'no-get-variant', route: key, method: r.method, detail: `GET returned ${getRes.status}` });

  const hasChallenge = (asDeclared.hasChallenge || getRes.hasChallenge);
  if (!hasChallenge && asDeclared.status === 402) results.warnings.push({ check: 'missing-payment-required-header', route: key });

  const hardFail = (asDeclared.status !== 402 && getRes.status !== 402) || (!getOk && r.method !== 'GET');
  const row = { path: r.path, method: r.method, getStatus: getRes.status, declaredStatus: asDeclared.status, hasChallenge, description: r.description };
  const ch = decodeChallenge(asDeclared.challenge || getRes.challenge || '');
  if (ch) { row.price = ch.price; row.network = ch.network; row.payTo = ch.payTo; }
  results.routes.push(row);

  // 3. buyer vocabulary in the description
  const desc = String(r.description || '').toLowerCase();
  const hit = args.terms.filter((t) => desc.includes(t.toLowerCase()));
  if (!hit.length) { results.warnings.push({ check: 'no-buyer-vocabulary', route: key, terms: args.terms }); rows.push('no-vocab'); }
  else rows.push(`vocab:${hit.length}`);

  // dedupe report rows by path (GET+POST share a URL)
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`${key.slice(0, 33).padEnd(34)} ${(hardFail ? 'FAIL' : 'ok').padEnd(9)} ${String(hasChallenge).padEnd(10)} ${rows.join(' ')}${ch?.price ? `  ${ch.price} ${ch.network}` : ''}`);
  await sleep(150);
}

console.log('-'.repeat(96));
console.log(`routes checked: ${results.routes.length}`);
console.log(`hard problems:  ${results.problems.length}${results.problems.length ? '  <- these stop a listing from being probed or called' : ''}`);
for (const p of results.problems) console.log(`   - ${p.check}: ${p.route || p.url} ${p.detail ? '(' + p.detail + ')' : ''}`);
console.log(`warnings:       ${results.warnings.length}`);
for (const w of results.warnings.slice(0, 12)) console.log(`   - ${w.check}: ${w.route || ''}`);

console.log(`
reminders this lint cannot check for you:
  - a description edit does NOT reach the index until that route settles again
  - register each paid route's FULL url, not the root (directories probe the submitted URL)
  - write descriptions in the buyer's words, then prove the rank with rank-probe.mjs`);

if (args.json) {
  const fs = await import('node:fs');
  fs.writeFileSync(args.json, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${args.json}`);
}
process.exit(results.problems.length ? 1 : 0);
