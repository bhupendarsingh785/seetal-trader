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

import json
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import providers  # noqa: E402
from providers import HEALTH, note  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config.json")
OUT = os.path.join(ROOT, "data", "live.json")

DEFAULT_SYMBOLS = [
    "^NSEI", "^NSEBANK", "^BSESN", "^GSPC", "^IXIC",
    "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "SBIN.NS", "INFY.NS",
    "ICICIBANK.NS", "BAJFINANCE.NS", "ADANIENT.NS", "ITC.NS",
    "AAPL", "TSLA", "NVDA", "SPY",
]

INDEX_SET = {"^NSEI", "^NSEBANK", "^BSESN", "^GSPC", "^IXIC", "^DJI"}


def _num(x):
    try:
        if x is None:
            return None
        v = float(x)
        return None if v != v else v
    except (TypeError, ValueError):
        return None


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


BAR_PROVIDERS = providers.BAR_PROVIDERS
QUOTE_PROVIDERS = providers.QUOTE_PROVIDERS


def build_row(symbol: str, previous: dict | None) -> dict:
    errors = []
    for name, fn in BAR_PROVIDERS:
        try:
            row = analyse_bars(symbol, fn(symbol), name)
            note(name, True)
            return row
        except Exception as exc:  # noqa: BLE001
            note(name, False, str(exc))
            errors.append(f"{name}: {exc}")

    for name, fn in QUOTE_PROVIDERS:
        try:
            row = quote_row(symbol, fn(symbol), name)
            note(name, True)
            return row
        except Exception as exc:  # noqa: BLE001
            note(name, False, str(exc))
            errors.append(f"{name}: {exc}")

    if previous:
        kept = dict(previous)
        kept["stale"] = True
        kept["src"] = (previous.get("src") or "?") + " (purana)"
        print(f"  ~ {symbol}: sab provider fail, pichhla data rakha", file=sys.stderr)
        return kept

    raise RuntimeError(" | ".join(errors)[:300])



PROBE_SYMBOLS = {
    "tencent": "600519.SS",
    "sina": "600519.SS",
    "eastmoney": "600519.SS",
    "moneycontrol": "RELIANCE.NS",
    "nse": "RELIANCE.NS",
    "stooq": "AAPL",
    "nasdaq": "AAPL",
    "twelvedata": "AAPL",
    "finnhub": "AAPL",
}


def probe_backups() -> dict:
    """Backup providers ko chup-chaap check karta hai - jo chain mein aage hai
    woh chal jaata hai, isliye backup kabhi test hi nahi hote. Yeh unhe test
    karta hai taki pata rahe kaun zinda hai."""
    out = {}
    for name, fn in providers.QUOTE_PROVIDERS + providers.BAR_PROVIDERS:
        sym = PROBE_SYMBOLS.get(name)
        if not sym:
            continue
        if name in ("twelvedata", "finnhub") and not (
            os.environ.get("TWELVEDATA_KEY") or os.environ.get("FINNHUB_KEY")
        ):
            out[name] = {"ok": False, "skipped": True, "note": "key nahi hai"}
            continue
        try:
            r = fn(sym)
            price = r.get("last") if isinstance(r, dict) and "last" in r else None
            if price is None and isinstance(r, dict):
                try:
                    price = r["chart"]["result"][0]["meta"]["regularMarketPrice"]
                except Exception:  # noqa: BLE001
                    price = None
            out[name] = {"ok": True, "symbol": sym, "price": price}
        except Exception as exc:  # noqa: BLE001
            out[name] = {"ok": False, "symbol": sym, "note": str(exc)[:100]}
    return out


def sanity(row: dict) -> tuple[bool, str]:
    """Ek row ko check karta hai. Jhootha ya toota data aage nahi jaata."""
    last = row.get("last")
    if last is None or last <= 0:
        return False, "price khaali/zero"
    prev = row.get("prev_close") or 0
    if prev > 0:
        chg = abs(last - prev) / prev * 100
        # 60% se zyada ek din mein = galat tick ya split, signal ke liye khatarnak
        if chg > 60 and not row.get("is_index"):
            return False, f"price sanity fail ({chg:.0f}% jump)"
    if row.get("has_bars") and row.get("or_high") is not None:
        if row["or_high"] <= 0 or row.get("or_low") is None or row["or_low"] > row["or_high"]:
            return False, "opening range galat"
    if row.get("state") == "ENTRY" and (not row.get("entry") or not row.get("stop")):
        return False, "entry hai par stop nahi"
    return True, ""


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

    rows, errors, repairs = [], [], []
    for sym in symbols:
        try:
            row = build_row(sym, previous_rows.get(sym))
            ok, why = sanity(row)
            if not ok:
                # doctor: galat row ko cache se badlo, warna hata do
                cached = previous_rows.get(sym)
                if cached and sanity(cached)[0]:
                    cached = dict(cached)
                    cached["stale"] = True
                    cached["src"] = (cached.get("src") or "?") + " (doctor)"
                    rows.append(cached)
                    repairs.append({"symbol": sym, "fix": f"{why} -> purana accha data lagaya"})
                else:
                    repairs.append({"symbol": sym, "fix": f"{why} -> row hata di"})
                print(f"  ~ doctor {sym}: {why}", file=sys.stderr)
            else:
                rows.append(row)
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
        "probe": probe_backups(),
        "rules": {
            "opening_range_minutes": 15,
            "entry": "pehli bar jo range high ke upar CLOSE ho",
            "stop": "opening range ka midpoint",
            "target": "2R",
        },
        "rows": rows,
        "repairs": repairs,
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

    # Supabase mein bhi daal do (agar secret diya ho) - data ka chheva rasta
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if supabase_url and supabase_key and rows:
        try:
            import urllib.request as _r
            body = json.dumps([{"generated_epoch": payload["generated_epoch"], "payload": payload}]).encode()
            req = _r.Request(
                supabase_url.rstrip("/") + "/rest/v1/snapshots",
                data=body,
                headers={
                    "apikey": supabase_key,
                    "Authorization": "Bearer " + supabase_key,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                method="POST",
            )
            with _r.urlopen(req, timeout=20) as resp:
                print("supabase: saved", resp.status)
        except Exception as exc:  # noqa: BLE001
            print(f"supabase: nahi gaya ({exc})", file=sys.stderr)
    else:
        print("supabase: secret nahi hai - skip")

    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
