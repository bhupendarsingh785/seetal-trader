# Seetal Trader ko live karna (teen jagah, sab free)

App static hai (HTML + JS + JSON) — koi build nahi, koi server nahi. Isliye
jahan bhi host karo, wahi files chalti hain.

## 1. GitHub Pages (pehle se chalu)

https://bhupendarsingh785.github.io/seetal-trader/

## 2. Netlify (card nahi maangta)

1. https://app.netlify.com/start kholo
2. **GitHub** se login karo
3. `seetal-trader` repo chuno
4. Build command khaali, Publish directory `.` — Deploy dabao
5. Link milega: `https://<naam>.netlify.app`

`netlify.toml` repo mein already hai, isliye settings khud bhar jaati hain.
Har GitHub push par Netlify khud naya version publish kar deta hai.

## 3. Cloudflare Pages (card nahi maangta)

1. https://dash.cloudflare.com/sign-up
2. Workers & Pages → Create → Pages → Connect to Git
3. `seetal-trader` repo chuno, framework: None, build output directory: `/`
4. Link milega: `https://seetal-trader.pages.dev`

## GitLab (code ka mirror, pehle se chalu)

https://gitlab.com/Bhuprndar785/bhupendarsingh785

GitLab Pages yahan nahi chalega jab tak account verify na ho (GitLab card
maangta hai) — uski zaroorat nahi, code ka backup wahan ban chuka hai.

## Data kaise taza rehta hai

- `data/live.json` GitHub Action har 5 minute par banata hai (Yahoo + backup providers)
- Browser khud bhi Yahoo se seedha data kheenchta hai (5–30 second)
- Host sirf files serve karta hai, isliye koi bhi host same data dikhayega
