#!/usr/bin/env python3
"""bazaar-scan — measure an x402 discovery index honestly.

Listing counts are inflated by mirrors and paid usage is distorted by sellers paying themselves.
This crawler reports size, concentration, price bands and the payer-per-call signature so you can
tell supply apart from demand.

Zero dependencies (stdlib only). Usage:

    python3 tools/bazaar-scan.py                        # sample ~700 listings across the index
    python3 tools/bazaar-scan.py --pages 10             # more pages = better estimates, slower
    python3 tools/bazaar-scan.py --json scan.json

Method
------
The public discovery index is paged: GET <base>/resources?offset=N&pageSize=100. Ordering is by
volume and the endpoint ignores filter parameters, so sampling across offsets is the only way to see
the whole distribution. Quality counters lag by hours; they are fine for a coarse scan and useless
for confirming a specific settle.
"""
import argparse
import json
import statistics as st
import time
import urllib.request
from collections import Counter

BASE = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources"


def fetch(offset, page_size=100, timeout=30):
    url = f"{BASE}?offset={offset}&pageSize={page_size}"
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def classify(calls, payers):
    if not payers:
        return "no-payer"
    r = calls / payers if payers else 0
    if r >= 10:
        return "repeat"
    if r >= 3:
        return "mid"
    return "one-shot-or-sweep"


def main():
    ap = argparse.ArgumentParser(description="scan an x402 discovery index")
    ap.add_argument("--pages", type=int, default=7, help="pages to sample (100 listings each)")
    ap.add_argument("--json", default="", help="write results as JSON")
    ap.add_argument("--sleep", type=float, default=0.6, help="seconds between requests (be polite)")
    args = ap.parse_args()

    # first call gives the total
    first = fetch(0, 1)
    total = (first.get("pagination") or {}).get("total")
    print(f"index reports total = {total} resources")

    offsets = [int(i * (total or 100_000) / args.pages) for i in range(args.pages)]
    rows, hosts, paytos = [], Counter(), Counter()

    for off in offsets:
        try:
            d = fetch(off)
        except Exception as e:  # noqa: BLE001
            print(f"  offset {off}: fetch failed ({e})")
            continue
        for it in d.get("items") or []:
            acc = (it.get("accepts") or [{}])[0]
            amount = acc.get("amount")
            q = it.get("quality") or {}
            calls = q.get("l30DaysTotalCalls") or 0
            payers = q.get("l30DaysUniquePayers") or 0
            url = it.get("resource") or ""
            if amount is None or not url:
                continue
            try:
                host = url.split("/")[2]
            except IndexError:
                host = "?"
            hosts[host] += 1
            if acc.get("payTo"):
                paytos[acc["payTo"]] += 1
            rows.append({
                "price": int(amount) / 1e6,
                "calls": calls,
                "payers": payers,
                "host": host,
                "service": it.get("serviceName") or "",
            })
        time.sleep(args.sleep)

    n = len(rows)
    if not n:
        print("no listings sampled")
        return

    print(f"\nsampled {n} listings across {len(offsets)} regions of the index\n")

    print("concentration (is the index as big as it looks?)")
    print(f"  distinct hosts in sample:  {len(hosts)}")
    top_host, top_host_n = hosts.most_common(1)[0]
    print(f"  largest host:              {top_host} ({top_host_n}/{n} listings = {100*top_host_n/n:.0f}%)")
    print(f"  distinct payTo addresses:  {len(paytos)}")
    if paytos:
        _, top_pay_n = paytos.most_common(1)[0]
        print(f"  largest payTo share:       {top_pay_n}/{n} = {100*top_pay_n/n:.0f}%")

    bands = [
        ("<$0.005", lambda x: x < 0.005),
        ("$0.005-0.01", lambda x: 0.005 <= x < 0.01),
        ("$0.01-0.05", lambda x: 0.01 <= x < 0.05),
        (">=$0.05", lambda x: x >= 0.05),
    ]
    print("\nprice bands and their payer signature")
    print(f"  {'band':12} {'n':>5} {'no payer':>9} {'one-shot':>9} {'repeat':>7} {'median calls':>13}")
    summary = {}
    for name, pred in bands:
        sub = [r for r in rows if pred(r["price"])]
        if not sub:
            continue
        nopay = sum(1 for r in sub if not r["payers"])
        one = sum(1 for r in sub if classify(r["calls"], r["payers"]) == "one-shot-or-sweep")
        rep = sum(1 for r in sub if classify(r["calls"], r["payers"]) == "repeat")
        med = st.median([r["calls"] for r in sub])
        print(f"  {name:12} {len(sub):>5} {100*nopay/len(sub):>8.0f}% {100*one/len(sub):>8.0f}% {100*rep/len(sub):>6.0f}% {med:>13.0f}")
        summary[name] = {"n": len(sub), "no_payer_pct": round(100 * nopay / len(sub)),
                         "one_shot_pct": round(100 * one / len(sub)), "repeat_pct": round(100 * rep / len(sub)),
                         "median_calls": med}

    print("""
reading this:
  - if one host/payTo owns a large share, the index size is mostly mirrors, not supply
  - 'one-shot' = every call from a fresh wallet (sweep signature); 'repeat' = wallets come back
  - the honest demand signal is the repeat share, not the listing count""")

    if args.json:
        with open(args.json, "w") as f:
            json.dump({"total_reported": total, "sampled": n, "distinct_hosts": len(hosts),
                       "distinct_payto": len(paytos), "bands": summary}, f, indent=2)
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
