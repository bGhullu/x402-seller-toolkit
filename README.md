# x402-seller-toolkit

Diagnostic tools for **x402 sellers who are getting traffic but no revenue** — plus the measured
market data that explains why that happens.

Zero dependencies. Node ≥ 22. Nothing to install but the repo.

```bash
git clone https://github.com/bGhullu/x402-seller-toolkit && cd x402-seller-toolkit

# 1. why is my listing invisible?  (does it even answer 402 on GET, is it in OpenAPI, does the
#    description contain the words a buyer would type)
node tools/metadata-lint.mjs --base https://your-host.example

# 2. where do I actually rank for buyer-intent queries, and did my last edit change anything?
node tools/rank-probe.mjs --host your-host.example --queries "token security,honeypot check" --json rank.json

# 3. separate traffic from demand in my ledger: challenges vs settles, sweeps vs repeat callers
#    vs self-pay
node tools/funnel-report.mjs --db ./data/ledger.db --ours 0xYourWallet
```

## Why these exist

A live x402 seller was run on Base mainnet for four days with the whole funnel instrumented. The
headline result:

| measurement | value |
|---|---|
| HTTP-402 challenges served | **8,244** (~137/hour) |
| settlements | 27 |
| conversion (settles / challenges) | **0.33%** |
| external paying wallets, ever | **4** — each paid once, $0.001, all on the cheapest route |
| external revenue | **$0.004** |
| self-pay (own wallets, listing triggers) | $0.334 — 83× the real revenue |
| discovery: high-intent queries we appear in | 0/8 → **3/11 after rewriting descriptions to buyer vocabulary** |
| best rank achieved | **#1** for `x402 test endpoint` |

Traffic was never the problem. Three mechanisms were:

1. **Challenges are not demand.** Directory crawlers, monitors and liveness probes hit every listed
   route constantly and are structurally incapable of buying.
2. **Discovery is quality-ordered, not keyword-ordered.** Vocabulary buys *inclusion*; call volume and
   payer reach buy *position*. A brand-new listing with 1 call ranks bottom-decile no matter how good
   its description is.
3. **A description edit does not reach the index until that route settles again.** Sellers edit, see
   nothing change, and conclude discovery is broken. It isn't — it's silent. This one was measured
   by paying the settle and watching the served description change.

## The tools

### `tools/metadata-lint.mjs`
Checks a live seller for the mistakes that silently block listing and calling:
- **no GET variant** for a paid path (crawlers and trust probes only send GET/HEAD — a POST-only
  route fails every probe and cannot be listed);
- the registered URL does not answer **402** (a 200 at that URL fails "probe the submitted URL");
- the route is missing from `/openapi.json` (several catalogs treat it as canonical discovery);
- the discovery description contains none of the words a buyer would type.
Exit code 1 on hard failures, so it can run in CI.

### `tools/rank-probe.mjs`
Enumerates the literal queries a buyer would type, reads the public Bazaar semantic search, and records
which rank your host holds per query. `--json` output feeds back in as `--baseline` to show movement
(`#1`, `absent`, `5->2`, `NEW`, `LOST`). Run it before and after every metadata change.

### `tools/funnel-report.mjs`
Reads a SQLite ledger and classifies every settled payment:
- **self-pay** — wallets you mark with `--ours` (listing triggers, sweeps you paid for). Not revenue.
- **single-payment** external wallet — the sweep signature: one call, never returns.
- **one-shot** (2 payments) — may become a customer, may not.
- **repeat** (≥ 3 payments) — the only honest demand signal.
It also prints the per-route challenge→settle funnel.

Marking your own wallets is not optional bookkeeping: a listing trigger is **indistinguishable** in
public dashboards from a genuine first sale. In this repo's own data, self-pay was 83× the real
revenue — and the same distortion exists market-wide.

### `tools/bazaar-scan.py`
Crawls the public discovery index (no auth) and reports size, **mirror inflation** (how few distinct
`payTo` addresses own most of the listings), price bands, and the payer-to-call signature per band.
Use it to check whether a market's *listing count* bears any relation to its *demand*.

### `ref/buyer-ref.mjs`
Reference implementation of a **capped** x402 buyer agent: per-call maximum, daily cap read from the
ledger (not memory), pre-pay 402 validation using the request's real HTTP method, refusal paths logged,
and actual spend derived from the settlement tx's USDC `Transfer` logs (v2 receipts omit `amount`).
Needs `viem @x402/fetch @x402/evm` — see the header of that file.

## Measured findings in full

See **[docs/FINDINGS.md](docs/FINDINGS.md)** — revenue bands across 73,810 listings, the sweep vs
repeat signature, the self-pay distortion, the per-route payer-count trap, the settle-refresh rule,
and the handler-before-settlement ordering with its live repro.

## Honest limitations

- Numbers come from one operator's deployment plus public index data; treat them as a baseline, not a
  census. The index's own counters (`l30DaysTotalCalls`, `l30DaysUniquePayers`) **lag by hours** —
  never use them to confirm a settle landed; read your own ledger.
- `l30DaysUniquePayers` is **per route**: summing it across routes overcounts your customers (it
  reported our 4 wallets as 8).
- The search endpoint returns at most ~20 results per query and ignores ordering parameters; absence
  from a query is a weak signal, not proof of invisibility.
- Nothing here manufactures demand. If the priced routes get probes and no settles, the constraint is
  demand — this toolkit tells you that honestly instead of letting you tune descriptions forever.

## License

MIT — see [LICENSE](LICENSE). Contributions welcome; the crawler and prober are deliberately
dependency-free so they keep working when SDKs drift.
