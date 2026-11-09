# Seetal Trader

Live market pulse + opening range breakout signals, Hinglish mein. Swag ke
SWAG Trader pack ke rules par bana hua, ek hi page par.

## Kya dikhata hai

- **Pulse** — har symbol ka last price, din ka change, momentum aur ek chhoti sparkline.
- **Opening range** — session ke pehle 15 minute ka high aur low.
- **Entry** — pehla 5-minute bar jo range high ke *upar close* kare. Wick upar nikalna entry nahi hai.
- **Stop aur target** — stop range ke midpoint par, target 2R.
- **Quantity** — tumhare max loss (₹) se nikalti hai, taki stop hit hone par loss limit ke andar rahe.
- **Scanner** — watchlist ki ranking: range high ke kitna kareeb + momentum.
- **Hisab** — paper trades browser mein save, P&L aur win rate.
- **Awaaz** — 🎤 dabao aur bolo ("market kaisa hai", "Reliance kaisa hai"), jawab bol kar sunata hai. Browser ke built-in speech kaam karte hain, koi API key nahi.

## Data kahan se (ek par nirbhar nahi)

`data/live.json` GitHub Action banata hai (`tools/snapshot.py` + `tools/providers.py`).
Har symbol ke liye providers ek ke baad ek try hote hain — jo pehla sahi jawab de,
wahi data deta hai. Sab fail ho jayein to **pichhla accha data** rehne deta hai,
`stale` mark ke saath.

**Bars (opening range + entry ke liye zaroori):**
1. Yahoo query1
2. Yahoo query2 (doosra host)
3. Twelve Data — *optional, apni free key daalo to chalta hai (NSE bhi cover karta hai)*
4. Finnhub — *optional, apni free key daalo to chalta hai (US)*

**Sirf price (bars nahi → card par `PRICE ONLY`, signal nahi):**
1. Moneycontrol (NSE/BSE) — best effort
2. NSE ka apna API — best effort (datacenter IP par aksar 403)
3. Nasdaq (US) — ✅ chal raha hai

**Browser live layer:** page khud bhi Yahoo se seedha data kheenchta hai, 4 CORS
proxy ke raste, har 5–30 second. Woh chal gaya to card par `live` likha aata hai,
warna snapshot dikhta hai.

**Har run par backup check hota hai.** `data/live.json` ke `probe` mein har backup
ka sach likha hota hai (✅ / ❌ / ➖ key nahi), aur wahi app ke upar "Backup:" line
mein dikhta hai. Jo mar gaya, woh chhup nahi sakta.

**Jo chain se hata diye:**
- **Stooq** — GitHub runner se har URL form par 404.
- **Google Finance** — NSE par 1295 dikhaya jab last 1324 tha. Galat price, price
  na hone se bura hai.

### India ke liye sabse asli backup

Yahoo ke baad NSE ka data free mein bharosemand nahi milta. Sabse seedha rasta:
**Twelve Data ki free key** (800 requests/din, NSE + BSE + US) — repo ke secrets
mein `TWELVEDATA_KEY` daal do, chain khud use karne lagegi.

### Apni key add karna (optional)

Repo → Settings → Secrets and variables → Actions → New repository secret:
`TWELVEDATA_KEY` ya `FINNHUB_KEY`. Dono ki free tier hai. Key daalne ke baad
agla run unhe bhi chain mein try karega — koi code badalne ki zaroorat nahi.

## Apna watchlist badalna

`config.json` mein `symbols` ki list badal do. NSE ke liye `RELIANCE.NS`,
BSE ke liye `RELIANCE.BO`, US ke liye `AAPL`, index ke liye `^NSEI`.

## Saaf baat

Yeh signal tool hai, guarantee nahi. Koi order apne aap nahi jaata. Day trading
mein zyadatar log paisa haarte hain. Jo paisa kho sakte ho wahi lagao.
