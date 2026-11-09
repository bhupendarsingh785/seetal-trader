#!/usr/bin/env python3
"""
Seetal Trader - data snapshot builder (multi-provider).

Ek hi source par nirbhar nahi. Har symbol ke liye providers ek ke baad ek
try hote hain; jo pehla kaam kare wahi data deta hai. Sab fail ho jayein to
pichhla accha data hi rehne deta hai (stale mark ke saath) - system band nahi
hota.

Providers (sab free, koi API key nahi):
  1. Yahoo query1   - 5-minute bars + last price  (OR/entry ke liye zaroori)
  2. Yahoo query2   - wahi API, doosra host (ek host block ho to bacha le)
  3. Stooq          - CSV quote (US symbols), sirf last price
  4. Moneycontrol   - NSE/BSE quote, sirf last price

Rules (SWAG Trader pack se):
  15-minute opening range, entry sirf jab bar range high ke upar CLOSE kare,
  stop = range midpoint, target = 2R.

Run:  python3 tools/snapshot.py
"""

from __future__ import annotations

import csv
import io
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
    "^NSEI", "^NSEBANK", "^BSESN", "^GSPC", "^IXIC",
    "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "SBIN.NS", "INFY.NS",
    "ICICIBANK.NS", "BAJFINANCE.NS", "ADANIENT.NS", "ITC.NS",
    "AAPL", "TSLA", "NVDA", "SPY",
]

INDEX_SET = {"^NSEI", "^NSEBANK", "^BSESN", "^GSPC", "^IXIC", "^DJI"}

HEALTH: dict = {}


def _note(provider: str, ok: bool, err: str = "") -> None:
    h = HEALTH.setdefault(provider, {"ok": 0, "fail": 0, "last_error": ""})
    if ok:
        h["ok"] += 1
    else:
        h["fail"] += 1
        h["last_error"] = err[:120]


def http_get(url: str, tries: int = 2, timeout: int = 18, headers: dict | None = None) -> str:
    last = None
    hdrs = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if headers:
        hdrs.update(headers)
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.0 * (i + 1))
    raise RuntimeError(str(last))


def _num(x):
    try:
        if x is None:
            return None
        v = float(x)
        return None if v != v else v
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- providers
def yahoo_bars(symbol: str, host: str = "query1") -> dict:
    s = urllib.parse.quote(symbol, safe="")
    url = (
        f"https://{host}.finance.yahoo.com/v8/finance/chart/{s}"
        f"?range=1d&interval=5m&includePrePost=false"
    )
    return json.loads(http_get(url))


def stooq_quote(symbol: str) -> dict:
    """Sirf US symbols. Delayed quote, koi bars nahi."""
    if symbol.startswith("^") or symbol.endswith((".NS", ".BO")):
        raise RuntimeError("stooq: yeh symbol support nahi")
    st = symbol.lower() + ".us"
    url = f"https://stooq.com/q/l/?s={st}&f=sd2t2ohlcv&h&e=csv"
    text = http_get(url, headers={"Accept": "text/csv"})
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise RuntimeError("stooq: khaali jawab")
    r = rows[0]
    close = _num(r.get("Close"))
    if close is None:
        raise RuntimeError("stooq: close nahi mila")
    return {
        "last": close,
        "prev": _num(r.get("Open")) or close,
        "name": symbol,
        "currency": "USD",
        "exchange": "Stooq",
        "ts": None,
    }


def moneycontrol_quote(symbol: str) -> dict:
    """NSE (.NS) symbols ke liye. Sirf last price."""
    if not symbol.endswith(".NS"):
        raise RuntimeError("moneycontrol: sirf .NS")
    code = symbol[:-3]
    url = f"https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/{code}"
    data = json.loads(http_get(url, headers={"Accept": "application/json"}))
    d = data.get("data") or {}
    last = _num(d.get("pricecurrent") or d.get("lastvalue"))
    prev = _num(d.get("pricepreviousclose") or d.get("prevclose"))
    if last is None:
        raise RuntimeError("moneycontrol: price nahi mila")
    return {
        "last": last,
        "prev": prev or last,
        "name": d.get("company") or code,
        "currency": "INR",
        "exchange": "NSE (Moneycontrol)",
        "ts": None,
    }


# ---------------------------------------------------------------- analysis
def analyse_bars(symbol: str, data: dict, provider: str) -> dict:
    res = (data.get("chart") or {}).get("result") or []
    if not res:
        raise RuntimeError("no chart result")
    r = res[0]
    meta = r.get("meta") or {}
    ts = r.get("timestamp") or []
    quote = ((r.get("indicators") or {}).get("quote") or [{}])[0]
    opens, highs = quote.get("open") or [], quote.get("high") or []
    lows, closes = quote.get("low") or [], quote.get("close") or []

    bars = []
    for i in range(min(len(ts), len(closes))):
        c = _num(closes[i])
        if c is None:
            continue
        bars.append({
            "t": int(ts[i]),
            "o": _num(opens[i]) if i < len(opens) else None,
            "h": _num(highs[i]) if i < len(highs) else None,
            "l": _num(lows[i]) if i < len(lows) else None,
            "c": c,
        })
    if not bars:
        raise RuntimeError("no usable bars")

    last = _num(meta.get("regularMarketPrice")) or bars[-1]["c"]
    prev = _num(meta.get("chartPreviousClose")) or _num(meta.get("previousClose")) or bars[0]["o"] or bars[0]["c"]

    or_bars = bars[:3]
    or_high = max((b["h"] or b["c"]) for b in or_bars)
    or_low = min((b["l"] or b["c"]) for b in or_bars)
    or_mid = (or_high + or_low) / 2.0

    state, entry, entry_time = "WAIT", None, None
    for b in bars[3:]:
        if b["c"] > or_high:
            state, entry, entry_time = "ENTRY", b["c"], b["t"]
            break

    stop = round(or_mid, 2)
    target = rr = None
    if entry:
        risk = entry - stop
        if risk <= 0:
            stop = round(or_low, 2)
            risk = entry - stop
        if risk > 0:
            target, rr = round(entry + 2.0 * risk, 2), 2.0

    tail = [b["c"] for b in bars[-6:]]
    mom = ((tail[-1] - tail[0]) / tail[0] * 100.0) if len(tail) >= 2 and tail[0] else 0.0

    return {
        "symbol": symbol,
        "name": meta.get("shortName") or symbol,
        "currency": meta.get("currency") or "",
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName") or "",
        "is_index": symbol in INDEX_SET,
        "last": round(last, 2),
        "prev_close": round(prev, 2),
        "change": round(last - prev, 2),
        "change_pct": round((last - prev) / prev * 100.0, 2) if prev else 0.0,
        "or_high": round(or_high, 2),
        "or_low": round(or_low, 2),
        "or_mid": round(or_mid, 2),
        "state": state,
        "entry": round(entry, 2) if entry else None,
        "entry_time": entry_time,
        "stop": stop if entry else round(or_mid, 2),
        "target": target,
        "rr": rr,
        "distance_points": round(or_high - last, 2),
        "distance_pct": round((or_high - last) / last * 100.0, 2) if last else 0.0,
        "momentum_pct": round(mom, 3),
        "spark": [round(b["c"], 4) for b in bars[-40:]],
        "bars": len(bars),
        "last_bar_age_sec": int(time.time()) - bars[-1]["t"],
        "market_time": meta.get("regularMarketTime"),
        "src": provider,
        "has_bars": True,
        "stale": False,
    }


def quote_row(symbol: str, q: dict, provider: str) -> dict:
    last, prev = q["last"], q["prev"]
    return {
        "symbol": symbol,
        "name": q.get("name") or symbol,
        "currency": q.get("currency") or "",
        "exchange": q.get("exchange") or provider,
        "is_index": symbol in INDEX_SET,
        "last": round(last, 2),
        "prev_close": round(prev, 2),
        "change": round(last - prev, 2),
        "change_pct": round((last - prev) / prev * 100.0, 2) if prev else 0.0,
        "or_high": None, "or_low": None, "or_mid": None,
        "state": "PRICE_ONLY",
        "entry": None, "entry_time": None, "stop": None, "target": None, "rr": None,
        "distance_points": None, "distance_pct": None,
        "momentum_pct": 0.0,
        "spark": [],
        "bars": 0,
        "last_bar_age_sec": None,
        "market_time": q.get("ts"),
        "src": provider,
        "has_bars": False,
        "stale": False,
    }


BAR_PROVIDERS = [
    ("yahoo-q1", lambda s: yahoo_bars(s, "query1")),
    ("yahoo-q2", lambda s: yahoo_bars(s, "query2")),
]
QUOTE_PROVIDERS = [
    ("moneycontrol", moneycontrol_quote),
    ("stooq", stooq_quote),
]


def build_row(symbol: str, previous: dict | None) -> dict:
    errors = []
    for name, fn in BAR_PROVIDERS:
        try:
            row = analyse_bars(symbol, fn(symbol), name)
            _note(name, True)
            return row
        except Exception as exc:  # noqa: BLE001
            _note(name, False, str(exc))
            errors.append(f"{name}: {exc}")

    for name, fn in QUOTE_PROVIDERS:
        try:
            row = quote_row(symbol, fn(symbol), name)
            _note(name, True)
            return row
        except Exception as exc:  # noqa: BLE001
            _note(name, False, str(exc))
            errors.append(f"{name}: {exc}")

    if previous:
        kept = dict(previous)
        kept["stale"] = True
        kept["src"] = (previous.get("src") or "?") + " (purana)"
        print(f"  ~ {symbol}: sab provider fail, pichhla data rakha", file=sys.stderr)
        return kept

    raise RuntimeError(" | ".join(errors)[:300])


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

    previous_rows = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, "r", encoding="utf-8") as fh:
                for r in (json.load(fh).get("rows") or []):
                    previous_rows[r.get("symbol")] = r
        except Exception:  # noqa: BLE001
            pass

    rows, errors = [], []
    for sym in symbols:
        try:
            rows.append(build_row(sym, previous_rows.get(sym)))
        except Exception as exc:  # noqa: BLE001
            errors.append({"symbol": sym, "error": str(exc)[:200]})
            print(f"  ! {sym}: {exc}", file=sys.stderr)
        time.sleep(0.2)

    now = datetime.now(timezone.utc)
    payload = {
        "generated_at": now.isoformat(timespec="seconds"),
        "generated_epoch": int(now.timestamp()),
        "source": "multi-provider: Yahoo q1/q2, Moneycontrol, Stooq (+ purana cache)",
        "providers": HEALTH,
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

    used = {}
    for r in rows:
        used[r.get("src", "?")] = used.get(r.get("src", "?"), 0) + 1
    print(f"wrote {OUT}: {len(rows)} symbols, {len(errors)} errors, sources={used}")
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
