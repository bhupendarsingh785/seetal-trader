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

## Data kahan se

`data/live.json` GitHub Action banata hai (`tools/snapshot.py`), Yahoo Finance ke
free public chart API se. Action har 10 minute chalta hai, aur page khud har
minute file dobara padhta hai. Yahoo ka data delay ho sakta hai, aur market band
hone par wohi purana data rehta hai — page par "aakhri update" dikhta hai.

## Apna watchlist badalna

`config.json` mein `symbols` ki list badal do. NSE ke liye `RELIANCE.NS`,
BSE ke liye `RELIANCE.BO`, US ke liye `AAPL`, index ke liye `^NSEI`.

## Saaf baat

Yeh signal tool hai, guarantee nahi. Koi order apne aap nahi jaata. Day trading
mein zyadatar log paisa haarte hain. Jo paisa kho sakte ho wahi lagao.
