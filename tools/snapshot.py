#!/usr/bin/env python3
"""
Seetal Trader - data snapshot builder.

Reads free Yahoo Finance chart data for the watchlist, applies the SWAG Trader
rules (15-minute opening range, entry only on a bar CLOSING above the range
high, stop at the range midpoint, target at 2R) and writes data/live.json.

Standard library only. No API key, no signup.

Run:  python3 tools/snapshot.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config.json")
OUT = os.path.join(ROOT, "data", "live.json")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

DEFAULT_SYMBOLS = [
    "^NSEI", "^NSEBANK", "^BSESN",
    "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "SBIN.NS", "TATAMOTORS.NS",
    "INFY.NS", "ICICIBANK.NS", "ADANIENT.NS", "ITC.NS",
    "AAPL", "TSLA", "NVDA", "SPY", "^GSPC", "^IXIC",
]

INDEX_SET = {"^NSEI", "^NSEBANK", "^BSESN", "^GSPC", "^IXIC", "^DJI", "^NSEBANK"}


def fetch_json(url: str, tries: int = 3) -> dict:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": UA,
                    "Accept": "application/json,text/plain,*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"fetch failed: {last}")


def chart_url(symbol: str, interval: str = "5m", rng: str = "1d") -> str:
    s = urllib.parse.quote(symbol, safe="")
    return (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{s}"
        f"?range={rng}&interval={interval}&includePrePost=false"
    )


def _num(x):
    try:
        if x is None:
            return None
        v = float(x)
        if v != v:  # NaN
            return None
        return v
    except (TypeError, ValueError):
        return None


def analyse(symbol: str, data: dict) -> dict:
    """Turn one Yahoo chart response into the row the screen shows."""
    res = (data.get("chart") or {}).get("result") or []
    if not res:
        raise RuntimeError("no chart result")
    r = res[0]
    meta = r.get("meta") or {}
    ts = r.get("timestamp") or []
    quote = ((r.get("indicators") or {}).get("quote") or [{}])[0]

    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    vols = quote.get("volume") or []

    # keep only real, completed bars
    bars = []
    for i in range(min(len(ts), len(closes))):
        c = _num(closes[i])
        if c is None:
            continue
        bars.append(
            {
                "t": int(ts[i]),
                "o": _num(opens[i]) if i < len(opens) else None,
                "h": _num(highs[i]) if i < len(highs) else None,
                "l": _num(lows[i]) if i < len(lows) else None,
                "c": c,
                "v": _num(vols[i]) if i < len(vols) else None,
            }
        )

    if not bars:
        raise RuntimeError("no usable bars")

    last = _num(meta.get("regularMarketPrice")) or bars[-1]["c"]
    prev = _num(meta.get("chartPreviousClose")) or _num(meta.get("previousClose"))
    if prev is None:
        prev = bars[0]["o"] or bars[0]["c"]

    change = last - prev
    change_pct = (change / prev * 100.0) if prev else 0.0

    # 15-minute opening range = the first three 5-minute bars of the session
    or_bars = bars[:3]
    or_high = max((b["h"] or b["c"]) for b in or_bars)
    or_low = min((b["l"] or b["c"]) for b in or_bars)
    or_mid = (or_high + or_low) / 2.0

    # entry: first COMPLETED bar after the range that CLOSES above the range high
    state = "WAIT"
    entry = None
    entry_time = None
    if len(bars) > 3:
        for b in bars[3:]:
            if b["c"] > or_high:
                state = "ENTRY"
                entry = b["c"]
                entry_time = b["t"]
                break

    stop = round(or_mid, 2)
    target = None
    rr = None
    if entry:
        risk = entry - stop
        if risk <= 0:  # stop too close / invalid - fall back to the range low
            stop = round(or_low, 2)
            risk = entry - stop
        if risk > 0:
            target = round(entry + 2.0 * risk, 2)
            rr = 2.0

    # momentum from the last few closes
    tail = [b["c"] for b in bars[-6:]]
    mom = 0.0
    if len(tail) >= 2 and tail[0]:
        mom = (tail[-1] - tail[0]) / tail[0] * 100.0

    dist_pts = or_high - last
    dist_pct = (dist_pts / last * 100.0) if last else 0.0

    spark = [round(b["c"], 4) for b in bars[-40:]]

    last_bar_age = int(time.time()) - bars[-1]["t"]

    return {
        "symbol": symbol,
        "name": meta.get("shortName") or symbol,
        "currency": meta.get("currency") or "",
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName") or "",
        "is_index": symbol in INDEX_SET,
        "last": round(last, 2),
        "prev_close": round(prev, 2),
        "change": round(change, 2),
        "change_pct": round(change_pct, 2),
        "or_high": round(or_high, 2),
        "or_low": round(or_low, 2),
        "or_mid": round(or_mid, 2),
        "state": state,
        "entry": round(entry, 2) if entry else None,
        "entry_time": entry_time,
        "stop": stop if entry else round(or_mid, 2),
        "target": target,
        "rr": rr,
        "distance_points": round(dist_pts, 2),
        "distance_pct": round(dist_pct, 2),
        "momentum_pct": round(mom, 3),
        "spark": spark,
        "bars": len(bars),
        "last_bar_age_sec": last_bar_age,
        "market_time": meta.get("regularMarketTime"),
    }


def main() -> int:
    symbols = DEFAULT_SYMBOLS
    if os.path.exists(CONFIG):
        try:
            with open(CONFIG, "r", encoding="utf-8") as fh:
                cfg = json.load(fh)
            if isinstance(cfg.get("symbols"), list) and cfg["symbols"]:
                symbols = [str(s).strip() for s in cfg["symbols"] if str(s).strip()]
        except Exception as exc:  # noqa: BLE001
            print(f"config.json padha nahi gaya: {exc}", file=sys.stderr)

    rows, errors = [], []
    for sym in symbols:
        try:
            rows.append(analyse(sym, fetch_json(chart_url(sym))))
        except Exception as exc:  # noqa: BLE001
            errors.append({"symbol": sym, "error": str(exc)[:160]})
            print(f"  ! {sym}: {exc}", file=sys.stderr)
        time.sleep(0.25)

    now = datetime.now(timezone.utc)
    payload = {
        "generated_at": now.isoformat(timespec="seconds"),
        "generated_epoch": int(now.timestamp()),
        "source": "Yahoo Finance public chart API (free, can lag)",
        "rules": {
            "opening_range_minutes": 15,
            "entry": "pehli bar jo range high ke upar CLOSE ho",
            "stop": "opening range ka midpoint",
            "target": "2R",
        },
        "rows": rows,
        "errors": errors,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)
    print(f"wrote {OUT}: {len(rows)} symbols, {len(errors)} errors")
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
