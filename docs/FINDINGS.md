# Measured findings: why x402 sellers get traffic and no revenue

All numbers are from (a) a live x402 v2 seller on Base mainnet settling USDC through the CDP
facilitator, and (b) public reads of the CDP Bazaar discovery index. Dates are in the measurement
column. Every claim is labelled: **VERIFIED** (measured directly), **CORROBORATED** (two independent
sources), **PROXY** (derived, formula stated), **NO DATA FOUND**.

---

## 1. The funnel, measured end to end (VERIFIED, 2026-10-24 → 10-29)

| stage | value |
|---|---|
| HTTP-402 challenges served | 8,244 |
| settlements (incl. self-pay) | 27 |
| conversion | 0.33% |
| **external paying wallets, ever** | **4** |
| external revenue | **$0.004** |
| self-pay (own wallets) | $0.334 |

Per-route challenges ranged 859–2,384 with conversion 0.12%–0.46% — i.e. **every** route received
sustained probe traffic, including the ones that never earned a cent. Traffic is not a proxy for
demand at any price point.

## 2. Revenue bands across the market (PROXY: price × 30-day calls, n = 73,810 listings with ≥1 call)

| band | listings | share of calls | share of est. revenue |
|---|---|---|---|
| REPEAT (`calls/payer ≥ 10`) | 852 (1.2%) | 77% | **49%** |
| MID (3–10) | 8,350 | 11% | 6% |
| PREMIUM one-shot (≥ $0.05, `calls/payer < 3`) | 4,247 | 2% | **40%** |
| SWEEP (< $0.05, `calls/payer < 3`) | 60,129 | 20% | **5%** |

A cheap route at the floor price is a funnel, never a business. The money is in repeat callers and in
premium one-shots; sub-cent one-shots are 80% of payer *events* and 5% of the *dollars*.

## 3. The sweep signature (VERIFIED)

Classify any listing by `r = calls / payer`:
- `payers ≈ calls` → every call came from a fresh wallet: **swept once, never returns**.
- `payers ≪ calls` → the same wallets come back: **repeat customers**.

Deep-tail sample (n = 300 listings at offsets 50k–70k): **100% had exactly one call and one payer** —
the once-swept pattern is sharpest at the end of the index. A 694-listing stratified sample in the
premium band (≥ $0.05) showed 87% one-shot, median 1 call, and only 8% developing repeat use, versus
26–30% repeat in the $0.005–0.05 range.

## 4. Selling to sellers does not work yet (VERIFIED, parent-run index query, 2026-10-28)

Every product built *for* x402 sellers, and its actual paid usage in 30 days:

| product | calls | payers |
|---|---|---|
| seller-dossier | 73 | 5 |
| listing-visibility explainer | 5 | 2 |
| seller lookup | 3 | 2 |
| analytics incumbent | 2 | 1 |
| listing writers / rank checkers / optimisers (4 more) | 1 each | 1 each |

Eight-plus incumbents, every one at ≤ 2 payers. Sellers don't buy tooling because they aren't earning
either. This is the clearest supply/demand asymmetry measurable on the rail today.

## 5. The self-pay distortion (VERIFIED on our own service; CORROBORATED market-wide)

Indexing a route requires a settled payment, so sellers pay themselves to trigger listing. That
payment is indistinguishable in public dashboards from a genuine first sale. On this deployment
self-pay was **83× the real revenue** and 23 of 27 settlements. Any "revenue" or "demand" reading
taken from payer counts without knowing the seller's own wallets is unreliable.

## 6. Discovery mechanics (VERIFIED)

- The Bazaar has a **public semantic search**: `GET .../discovery/search?query=…` (the sibling
  `/resources` endpoint has no parameters — probing the wrong one is how "the index has no search"
  becomes a false conclusion).
- **Vocabular** matters for *inclusion*: rewriting descriptions to buyer vocabulary moved one seller
  from 0/8 to 3/11 high-intent queries, including #1 for `x402 test endpoint`, #2 `token due
  diligence`, #7 `rug pull detection`. It stayed absent for crowded queries (`token security`,
  `honeypot check`) where listings had 10-100× more calls.
- **Rank is quality-ordered**, not keyword-ordered: position follows payers/calls/recency.
- **A description edit does not propagate until that route settles again** (VERIFIED by paying the
  settle and watching the served description change minutes later).
- **Quality counters lag by hours**: after a 07:40 settle the listing still showed the previous day's
  `lastCalledAt`. Never use index counters to confirm a settle — read your own ledger.
- **`l30DaysUniquePayers` is per route.** Summing across a merchant's routes reported our 4 distinct
  wallets as 8. Metric rule: distinct customers come from your ledger or on-chain transfers only.
- **Index size is inflated by mirrors**: a 300-listing sample across three index regions found only 78
  distinct `payTo` addresses, with two hosts owning ~2/3 of it. Listing count is not market size.

## 7. Handler-before-settlement ordering (VERIFIED on `@x402/express` 2.28.0)

The middleware settles **only when the handler succeeds**. Consequence: a route that throws never
charges. Repro on a live route:

```
GET /chaos?failRate=1  →  500, settlement: null, buyer spend: 0, no ledger row
GET /chaos?failRate=0  →  200 and it settles
```

This is the operator-visible symptom of the ordering described in the ecosystem's
handler-before-settlement reports (side effects can persist when settlement later fails; conversely a
handler error means the payment is never taken). Any route that can fail *after* doing work is a
free-work generator — and any listing claiming "settles payment, then injects a failure" is describing
something the middleware does not do.

## 8. Practical takeaways

1. Instrument the funnel before optimising anything; challenges will mislead you.
2. Mark your own wallets, or your revenue number is fiction.
3. Price deliberately: $0.001 routes are discovery loss-leaders, not income.
4. Fix vocabulary for inclusion, then accept that position needs volume — or go get demand off-index.
5. Design for repeat use (one small verdict an agent re-asks) or for premium one-shots (one call worth
   ≥ $0.05). The middle is where nothing happens.
6. If priced routes get probes and no settles for weeks, stop tuning and change the distribution or the
   product. The rail is not hiding a demand pool that a better description would unlock.
