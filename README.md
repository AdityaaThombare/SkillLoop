# SkillLoop

A DBMS-driven peer-to-peer skill-barter platform. Students exchange skills using
time-credits instead of money, and the database itself finds multi-party trade
loops (A teaches B, B teaches C, C teaches A) that a normal one-to-one barter
app would miss.

This is a real, runnable full-stack app: SQLite database (with views, triggers,
and a recursive CTE), a Flask backend, and an HTML/JS frontend with a live
network graph.

## Run it

```bash
cd skillloop
pip install -r requirements.txt
python seed.py        # creates skillloop.db (users, skills, loops, teams) and trains the recommender
python app.py          # starts the server
```

Then open **http://localhost:5050** and click **Create account**. To see loops you need at least 3 members, so register a few
accounts (use a private window for each) or run `python demo_data.py` for sample people.
An existing `skillloop.db` from the old version is upgraded automatically on startup
(old accounts get the demo password).


## What's new

- **Real data only.** `python seed.py` creates an empty database: just a catalog of 43 skills, no people, no teams and no
  fake activity. Everything you see is created by real members: accounts, offers, wants, teams, join requests, trades and ratings.
  (Optional, for trying it alone: `python demo_data.py` adds a few sample people, password `skillloop123`.)
- **Live updates.** Every open page checks a database fingerprint every 3 seconds and redraws itself when anything changes:
  a new loop appears on the Home page, join requests show up (with a badge) for the team creator, the network graph, leaderboard,
  skill prices and the activity feed all update without reloading. The green "Live" dot in the sidebar shows the connection.
- **Login and accounts.** `/login` has Sign in and Create account. Registering saves the name, email and a *hashed* password
  (Werkzeug scrypt) into the `users` table. Every page and `/api/*` route needs login, and actions always act as the signed-in user.
- **Trades are real.** Only people in a loop can settle it, every leg is re-checked against the live offers/wants, prices come
  from the database, and settling removes the fulfilled wants so the same loop can't be settled twice. Trade partners then rate
  each other on the Profile page (1 to 5 stars), and that is what builds the trust leaderboard.
- **Hackathon Team Synthesizer.** Create a team (name, hackathon, description, size, skills still needed), browse open teams,
  request to join, and the creator accepts or declines. A database trigger stops a team going over its size.
- **ML recommender (`recommender.py`, plain numpy).** It learns from the live database and retrains by itself when the data changes:
  - *Team matcher*: two-tower matrix factorization trained on real join requests (a request or membership = positive,
    no interaction = negative, a creator's own team ignored).
  - *Skill suggester*: ALS collaborative filtering on the real user x skill matrix (offers + wants).
  - Until there is enough real data (60 real join requests / 40 real users) a small **synthetic warm-start set** is mixed in so a
    brand-new site still gives sensible suggestions. After that the models use real data only. The Teams page shows how many real
    join requests the model has learned from. Mention the synthetic warm start in your report.
- **Visual redesign:** sidebar layout, icons, an animated trade-loop ring that turns green when settled.

Bot commands: `add user Priya priya@vit.edu secret123`, `I offer Cooking`, `I want React`, `find loops`, `help`.

Set `SKILLLOOP_SECRET` in your environment for a fixed session key (otherwise one is generated in `.secret_key`).

## What to demo

1. **The graph** — shows every user and who-offers-what-to-whom-wants-what as a
   directed network (this is what the recursive query walks).
2. **"Find trade loops"** — runs the recursive SQL CTE (`app.py` → `LOOP_QUERY`)
   live against the database and returns every closed multi-party barter cycle
   it finds, ranked by loop length and trust. The best one is highlighted in
   green on the graph.
3. **"Execute this trade"** — commits every leg of the loop as one atomic SQL
   transaction (`/api/trade/execute`). A trigger (`trg_trade_leg_settle`)
   automatically updates every user's credit balance — no application code
   computes the balances, the database does it.
4. **Skill Pricing panel** — a SQL view (`skill_pricing`) recomputes each
   skill's credit value from live demand vs supply every time you load the page.
5. **Trust Leaderboard** — a SQL view (`trust_scores`) computes a decay-weighted
   trust score per user (recent ratings count more than old ones) using
   `EXP()` and a window function (`RANK()`) for the ranking.
6. **No-show protection** — cancel a trade 3 times as the same user
   (`POST /api/trade/<id>/cancel`) and a trigger (`trg_block_flagged_offers`)
   will start rejecting new offers from that user automatically.
7. **Data-Entry Bot** — a floating chat box where you can type plain-English
   commands instead of using the forms:
   - `add user Priya priya@vit.edu`
   - `add skill Cooking - Lifestyle`
   - `Priya offers Cooking`
   - `Priya wants Chess`
   - `find loops`, `leaderboard`, `pricing`, `help`

   This is a lightweight rule-based parser (`app.py` → `_bot_reply`) — no
   external API or model, so it works fully offline — but it inserts through
   the exact same SQL statements as the manual forms, so it's a real
   alternative data-entry path, not a gimmick.

## Project layout

```
skillloop/
├── app.py            Flask backend: auth, pages, API routes
├── recommender.py     Matrix-factorization recommender (synthetic training data)
├── schema.sql         Tables, views, and triggers (the DBMS core)
├── seed.py             Empty database with the skills catalog, then trains the warm-start model
├── demo_data.py        OPTIONAL sample people/teams for solo testing
├── requirements.txt
├── models/             Saved recommender weights
├── static/             style.css, app.js
└── templates/          base, login, dashboard, network, loops, marketplace, teams, leaderboard, profile
```

## The DBMS features, by file location (schema.sql)

| Feature | Where |
|---|---|
| Recursive CTE trade-loop detection | `app.py` → `LOOP_QUERY` |
| Dynamic skill pricing (supply/demand) | `schema.sql` → `VIEW skill_pricing` |
| Trust-decay scoring | `schema.sql` → `VIEW trust_scores` |
| Auto credit settlement | `schema.sql` → `TRIGGER trg_trade_leg_settle` |
| No-show flagging | `schema.sql` → `TRIGGER trg_trade_cancel_flag` |
| Block flagged users | `schema.sql` → `TRIGGER trg_block_flagged_offers` |
| Atomic multi-leg trade execution | `app.py` → `execute_trade()` (BEGIN/COMMIT/ROLLBACK) |
| Ranking | `RANK() OVER (...)` in `/api/leaderboard` |
| Natural-language data entry bot | `app.py` → `_bot_reply()`, `/api/bot` |

## Notes

- Uses **SQLite** (zero setup, one file, still supports recursive CTEs,
  triggers, views, and window functions) so it runs anywhere with no separate
  database server to install. If you want to present it as PostgreSQL for your
  report, the same `schema.sql` logic maps almost 1:1 — the recursive CTE
  syntax is identical, and Postgres additionally supports `pg_cron` for the
  auto-expiry feature mentioned in the synopsis.
- The frontend pulls `vis-network` and Google Fonts from a CDN, so you'll need
  internet access in the browser (not the server) for the graph and fonts to
  load.
- To reset all demo data: delete `skillloop.db` and re-run `python seed.py`.
