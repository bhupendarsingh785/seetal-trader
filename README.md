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

`data/live.json` GitHub Action banata hai (`tools/snapshot.py`). Har symbol ke
liye providers ek ke baad ek try hote hain, jo pehla kaam kare wahi data deta hai:

1. **Yahoo query1** — 5-minute bars + last price (opening range aur entry ke liye zaroori)
2. **Yahoo query2** — wahi API, doosra host (ek block ho to doosra bacha le)
3. **Moneycontrol** — NSE/BSE ka last price (bars nahi)
4. **Stooq** — US symbols ka last price (bars nahi)

Sab fail ho jayein to **pichhla accha data** hi rehne deta hai, `stale` mark ke
saath — page band nahi hota. Page par har card ke neeche uska source likha hota
hai aur upar providers ki health dikhti hai. Action har 10 minute chalta hai,
page khud har minute file dobara padhta hai.

Agar kisi source se sirf price mila (bars nahi), card par `PRICE ONLY` likha
aata hai — us halat mein entry/stop/target nahi nikalti, kyunki opening range
ke bina woh jhooth hota.

## Apna watchlist badalna

`config.json` mein `symbols` ki list badal do. NSE ke liye `RELIANCE.NS`,
BSE ke liye `RELIANCE.BO`, US ke liye `AAPL`, index ke liye `^NSEI`.

## Saaf baat

Yeh signal tool hai, guarantee nahi. Koi order apne aap nahi jaata. Day trading
mein zyadatar log paisa haarte hain. Jo paisa kho sakte ho wahi lagao.
