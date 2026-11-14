# OpenYug — mera apna agent

Ye ek chhota, **bina API key** chalne wala agent hai. GitHub Actions par har 15 minute chalta hai.

## Andar kya hai

| File | Kaam |
|---|---|
| `agent/brain.py` | **dimaag** — khud tay karta hai aaj kya karna hai (orders + knowledge + state padh kar), wajah bhi likhta hai |
| `agent/goals.md` | lakshya — inhe padh kar kaam chunta hai |
| `agent/orders.md` | Swag ke aadesh (`- [ ] kaam`) |
| `agent/run.py` | runner — orders chalata hai, report likhta hai |
| `agent/clock.py` | ghadi — kab aaya, kitna gap, kul kitna chala |
| `agent/learn.py` | seekhna — web se padh kar 3-line sabak `knowledge.md` me (ab sirf NAYA, dedup) |
| `agent/spawn.py` | bade kaam ko chhote steps (jobs) me todta hai |
| `agent/skills.py` | **skills** — jo kaam baar-baar ho uska pakka tareeka `agent/skills/` me |
| `agent/self_improve.py` | **khud sudhaar** — behtar hone ke sujhav `agent/suggestions.md` me (PR ke liye) |
| `agent/shortcuts.md` | jo kaam ho gaya uska chhota tareeka |
| `agent/state.json` | score, history, pause |
| `agent/reports/` | har run ki report |

## Chalane ka tareeka

```bash
python3 agent/brain.py           # aaj ka faisla dekho (ab priority + memory se)
python3 agent/run.py             # poora run (report + skill note + sujhav)
python3 agent/clock.py           # time ka hisaab
python3 agent/learn.py           # naya seekho (sirf nayi headlines)
python3 agent/skills.py list     # OpenYug ki skills
python3 agent/self_improve.py    # khud ke sujhav (suggestions.md me)
```

## Naya (v2) — zyada samajhdaar, par control tere paas

- **Behtar dimaag** (`brain.py`): har kaam ko priority deta hai, pichhla run yaad
  rakhta hai (dohraata nahi), aur `goals.md` ke har lakshya ko baari-baari chhoota hai.
- **Skills** (`skills.py`): jo kaam baar-baar aata hai uski ek chhoti file ban jaati
  hai `agent/skills/` me. Agli baar runner wahi tareeka dikhata hai. Skill sirf
  *tareeka* batati hai — khud code chalaakar kuch badalti nahi (isliye safe).
- **Khud sudhaar — review-gate** (`self_improve.py` + `openyug-propose.yml`):
  OpenYug khud sochta hai "main behtar kaise ho sakta hun" aur sujhav ek **PR** me
  bhejta hai. Tu ek click me **merge** kare — tabhi badlaav aata hai.
  **Apna code OpenYug kabhi khud merge nahi karta. Auto-merge bilkul nahi.**
- **Smarter learning** (`learn.py`): ab purani headline dobara nahi likhta, sirf
  naya jodta hai.

GitHub par: **Actions → OpenYug → Run workflow**

## Pause / Resume
`agent/orders.md` me likho:
```
- [ ] pause
- [ ] resume
```

## Ek limit jo jaan-boojh kar rakhi hai
OpenYug **apna code khud badal kar merge nahi karta** — woh sirf `agent/suggestions.md` me sujhav likhta hai.
Wajah: jo agent apna code bina kisi ki haan ke badal de, woh system chup-chaap tod sakta hai.

## Kya nahi karta
- Kisi platform ka rule nahi todta
- Kisi ka account/credential nahi chhoota
- Paisa, delete, public post — bina Swag ki haan ke nahi
