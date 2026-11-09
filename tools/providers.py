#!/usr/bin/env python3
"""
Seetal Trader - provider registry.

Ek source par kabhi bhi bharosa mat karo. Yahan har source ka apna function
hai, apni health, apna error. snapshot.py inko ek ke baad ek try karta hai.

Do tarah ke provider:
  bars  - 5-minute bars + last price  (opening range, entry, stop, target ke liye)
  quote - sirf last price             (bars nahi, isliye signal nahi)

Sab free hain, koi key nahi chahiye - sirf do (Twelve Data, Finnhub) optional
hain: agar GitHub secrets mein TWELVEDATA_KEY / FINNHUB_KEY daal do to woh bhi
chain mein jud jaate hain, warna chup-chaap skip ho jaate hain.

Standard library only.
"""

from __future__ import annotations

import csv
import http.cookiejar
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

HEALTH: dict = {}


def note(provider: str, ok: bool, err: str = "") -> None:
    h = HEALTH.setdefault(provider, {"ok": 0, "fail": 0, "last_error": ""})
    if ok:
        h["ok"] += 1
        h["last_error"] = ""
    else:
        h["fail"] += 1
        h["last_error"] = err[:140]


def _get(url: str, tries: int = 2, timeout: int = 15, headers: dict | None = None,
         opener=None) -> str:
    hdrs = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}
    if headers:
        hdrs.update(headers)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            op = opener or urllib.request.urlopen
            with op(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.8 * (i + 1))
    raise RuntimeError(str(last))


def _num(x):
    """'$338.73', '₹1,324.00', '1,32,4.5' - sab se number nikaal deta hai."""
    try:
        if x is None:
            return None
        t = re.sub(r"[^0-9.\-]", "", str(x))
        if t in ("", "-", ".", "-."):
            return None
        v = float(t)
        return None if v != v else v
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ bars
def yahoo_bars(symbol: str, host: str = "query1") -> dict:
    s = urllib.parse.quote(symbol, safe="")
    url = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{s}"
           f"?range=1d&interval=5m&includePrePost=false")
    return json.loads(_get(url))


def twelvedata_bars(symbol: str) -> dict:
    key = os.environ.get("TWELVEDATA_KEY", "").strip()
    if not key:
        raise RuntimeError("TWELVEDATA_KEY nahi hai")
    sym = symbol.replace(".NS", ":NSE").replace(".BO", ":BSE")
    url = ("https://api.twelvedata.com/time_series?interval=5min&outputsize=80"
           f"&symbol={urllib.parse.quote(sym)}&apikey={key}")
    d = json.loads(_get(url))
    vals = d.get("values") or []
    if not vals:
        raise RuntimeError(d.get("message") or "twelvedata: khaali")
    # Twelve Data ulta kram deta hai (naya pehle)
    vals = list(reversed(vals))
    ts, o, h, l, c = [], [], [], [], []
    for v in vals:
        try:
            t = int(time.mktime(time.strptime(v["datetime"], "%Y-%m-%d %H:%M:%S")))
        except Exception:  # noqa: BLE001
            continue
        ts.append(t)
        o.append(_num(v.get("open")))
        h.append(_num(v.get("high")))
        l.append(_num(v.get("low")))
        c.append(_num(v.get("close")))
    last = c[-1] if c else None
    prev = o[0] if o else last
    return {"chart": {"result": [{
        "meta": {"symbol": symbol, "regularMarketPrice": last, "chartPreviousClose": prev,
                 "currency": "", "fullExchangeName": "TwelveData", "shortName": symbol},
        "timestamp": ts,
        "indicators": {"quote": [{"open": o, "high": h, "low": l, "close": c}]},
    }]}}


def finnhub_bars(symbol: str) -> dict:
    key = os.environ.get("FINNHUB_KEY", "").strip()
    if not key:
        raise RuntimeError("FINNHUB_KEY nahi hai")
    if symbol.startswith("^") or symbol.endswith((".NS", ".BO")):
        raise RuntimeError("finnhub: yeh symbol support nahi")
    now = int(time.time())
    frm = now - 86400
    url = (f"https://finnhub.io/api/v1/stock/candle?symbol={urllib.parse.quote(symbol)}"
           f"&resolution=5&from={frm}&to={now}&token={key}")
    d = json.loads(_get(url))
    if d.get("s") != "ok" or not d.get("c"):
        raise RuntimeError("finnhub: data nahi")
    return {"chart": {"result": [{
        "meta": {"symbol": symbol, "regularMarketPrice": d["c"][-1],
                 "chartPreviousClose": d["o"][0], "currency": "USD",
                 "fullExchangeName": "Finnhub", "shortName": symbol},
        "timestamp": d["t"],
        "indicators": {"quote": [{"open": d["o"], "high": d["h"],
                                  "low": d["l"], "close": d["c"]}]},
    }]}}


# ------------------------------------------------------------------ quote
def moneycontrol_quote(symbol: str) -> dict:
    m = re.match(r"^(.+)\.(NS|BO)$", symbol)
    if not m:
        raise RuntimeError("moneycontrol: sirf .NS/.BO")
    code, ex = m.group(1), ("nse" if m.group(2) == "NS" else "bse")
    url = f"https://priceapi.moneycontrol.com/pricefeed/{ex}/equitycash/{code}"
    d = (json.loads(_get(url, headers={"Accept": "application/json",
                                       "Referer": "https://www.moneycontrol.com/"})).get("data") or {})
    last = None
    for k in ("pricecurrent", "lastvalue", "lastprice", "price", "LTP"):
        last = _num(d.get(k))
        if last:
            break
    prev = None
    for k in ("pricepreviousclose", "prevclose", "previousclose", "close"):
        prev = _num(d.get(k))
        if prev:
            break
    if last is None:
        raise RuntimeError("moneycontrol: price nahi")
    return {"last": last, "prev": prev or last, "name": d.get("company") or code,
            "currency": "INR", "exchange": ex.upper() + " (Moneycontrol)"}


def stooq_quote(symbol: str) -> dict:
    if symbol.startswith("^") or symbol.endswith((".NS", ".BO")):
        raise RuntimeError("stooq: yeh symbol nahi")
    forms = [
        f"https://stooq.com/q/l/?s={symbol.lower()}.us&f=sd2t2ohlcv&h&e=csv",
        f"https://stooq.com/q/l/?s={symbol.lower()}.us&f=sd2t2ohlcv&e=csv",
        f"https://stooq.pl/q/l/?s={symbol.lower()}.us&f=sd2t2ohlcv&h&e=csv",
    ]
    text = ""
    err = None
    for u in forms:
        try:
            text = _get(u, headers={"Accept": "text/csv"})
            if "Close" in text or "," in text:
                break
        except Exception as exc:  # noqa: BLE001
            err = exc
    if not text:
        raise RuntimeError(f"stooq: {err}")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise RuntimeError("stooq: khaali")
    close = _num(rows[0].get("Close"))
    if close is None:
        raise RuntimeError("stooq: close nahi")
    return {"last": close, "prev": _num(rows[0].get("Open")) or close,
            "name": symbol, "currency": "USD", "exchange": "Stooq"}


def nasdaq_quote(symbol: str) -> dict:
    if symbol.startswith("^") or symbol.endswith((".NS", ".BO")):
        raise RuntimeError("nasdaq: yeh symbol nahi")
    url = f"https://api.nasdaq.com/api/quote/{urllib.parse.quote(symbol)}/info?assetclass=stocks"
    d = json.loads(_get(url, headers={"Accept": "application/json"}))
    p = (d.get("data") or {}).get("primaryData") or {}
    last = None
    for k in ("lastSalePrice", "lastSalePriceRaw", "netChange", "price"):
        last = _num(p.get(k))
        if last:
            break
    prev = _num(p.get("previousClose"))
    if last is None:
        raise RuntimeError("nasdaq: price nahi")
    return {"last": last, "prev": prev or last, "name": symbol,
            "currency": "USD", "exchange": "Nasdaq"}


def google_quote(symbol: str) -> dict:
    """Aakhri sahara. Page ka HTML badalta rehta hai, isliye teen pattern try
    karte hain aur price ko prev close ke aas-paas sanity-check karte hain."""
    if symbol.startswith("^"):
        raise RuntimeError("google: index skip")
    if symbol.endswith(".NS"):
        gsym = symbol[:-3] + ":NSE"
    elif symbol.endswith(".BO"):
        gsym = symbol[:-3] + ":BOM"
    else:
        gsym = symbol + ":NASDAQ"
    html = _get("https://www.google.com/finance/quote/" + urllib.parse.quote(gsym))

    def grab(pat):
        m = re.search(pat, html)
        return _num(m.group(1).replace(",", "")) if m else None

    last = grab(r'data-last-price="([0-9.]+)"')
    if last is None:
        last = grab(r'class="YMlKec fxKbKc">[^0-9]*([0-9,.]+)')
    if last is None:
        last = grab(r'class="dO6ijd">[^0-9]*([0-9,.]+)')
    if last is None:
        raise RuntimeError("google: price nahi mila")

    prev = grab(r'Previous close</div>.{0,400}?[^0-9]([0-9,.]+)</div>')
    if prev is None or prev <= 0:
        prev = last
    if prev and not (0.5 * prev <= last <= 1.5 * prev):
        raise RuntimeError("google: price sanity fail")

    ts = grab(r'data-last-normal-market-timestamp="(\d+)"')
    return {"last": last, "prev": prev, "name": symbol, "currency": "",
            "exchange": "Google Finance", "ts": int(ts) if ts else None}


def nse_quote(symbol: str) -> dict:
    """NSE ka apna API. Cookie warm-up chahiye, datacenter IP par aksar 403."""
    if not symbol.endswith(".NS"):
        raise RuntimeError("nse: sirf .NS")
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    try:
        opener.open(urllib.request.Request("https://www.nseindia.com",
                                           headers={"User-Agent": UA}), timeout=12).read()
    except Exception:  # noqa: BLE001
        pass
    code = symbol[:-3]
    url = f"https://www.nseindia.com/api/quote-equity?symbol={urllib.parse.quote(code)}"
    d = json.loads(_get(url, headers={"Accept": "application/json",
                                      "Referer": "https://www.nseindia.com/"},
                        opener=opener.open))
    pd = d.get("priceInfo") or {}
    last = _num(pd.get("lastPrice"))
    prev = _num(pd.get("previousClose"))
    if last is None:
        raise RuntimeError("nse: price nahi")
    return {"last": last, "prev": prev or last,
            "name": (d.get("info") or {}).get("companyName") or code,
            "currency": "INR", "exchange": "NSE"}


# ------------------------------------------------------------------ chains
BAR_PROVIDERS = [
    ("yahoo-q1", lambda s: yahoo_bars(s, "query1")),
    ("yahoo-q2", lambda s: yahoo_bars(s, "query2")),
    ("twelvedata", twelvedata_bars),
    ("finnhub", finnhub_bars),
]

QUOTE_PROVIDERS = [
    ("moneycontrol", moneycontrol_quote),
    ("nse", nse_quote),
    ("stooq", stooq_quote),
    ("nasdaq", nasdaq_quote),
    # google_quote chain mein nahi hai: NSE par isne 1295 dikhaya jab last 1324 tha.
    # Galat price, price na hone se bura hai. Function rakha hai, experiment ke liye.
]
