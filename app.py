import os
import re
import secrets
import sqlite3
import numpy as np
from flask import Flask, g, jsonify, request, render_template, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash

import recommender

BASE = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE, "skillloop.db")
SCHEMA_PATH = os.path.join(BASE, "schema.sql")
DEMO_PASSWORD = "skillloop123"
EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+(\.[\w-]+)+$")

app = Flask(__name__)


def _secret_key():
    """Stable session key: env var, else a random key saved next to the app."""
    if os.environ.get("SKILLLOOP_SECRET"):
        return os.environ["SKILLLOOP_SECRET"]
    path = os.path.join(BASE, ".secret_key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    return open(path).read().strip()


app.secret_key = _secret_key()
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        with open(SCHEMA_PATH) as f:
            conn.executescript(f.read())


def migrate():
    """Upgrade an older skillloop.db in place (adds passwords + team tables) without losing data."""
    with sqlite3.connect(DB_PATH) as conn:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='users'").fetchone():
            return init_db()
        sql = re.sub(r"^DROP TABLE.*$", "", open(SCHEMA_PATH).read(), flags=re.M)
        sql = re.sub(r"CREATE TABLE (?!IF NOT EXISTS)", "CREATE TABLE IF NOT EXISTS ", sql)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)")]
        if "password_hash" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''")
        conn.executescript(sql)
        # accounts created before login existed get the demo password
        conn.execute("UPDATE users SET password_hash = ? WHERE password_hash = ''", (generate_password_hash(DEMO_PASSWORD),))
        conn.commit()


# ---------- Auth ----------

PUBLIC_ENDPOINTS = {"login_page", "api_login", "api_register", "api_public_stats", "static"}


@app.before_request
def require_login():
    if request.endpoint in PUBLIC_ENDPOINTS or request.endpoint is None:
        return
    if session.get("user_id"):
        row = get_db().execute("SELECT 1 FROM users WHERE id = ?", (session["user_id"],)).fetchone()
        if row:
            return
        session.clear()
    if request.path.startswith("/api/"):
        return jsonify({"error": "Please sign in first"}), 401
    return redirect(url_for("login_page"))


def current_user_id():
    return session["user_id"]


def me_payload(db, uid):
    u = db.execute("""
        SELECT u.id, u.name, u.email, u.credits, u.no_show_count,
               COALESCE(t.trust_score, 5.0) AS trust_score,
               (SELECT COUNT(*) + 1 FROM users u2 LEFT JOIN trust_scores t2 ON t2.user_id = u2.id
                 WHERE COALESCE(t2.trust_score, 5.0) > COALESCE(t.trust_score, 5.0)) AS rank
        FROM users u LEFT JOIN trust_scores t ON t.user_id = u.id WHERE u.id = ?""", (uid,)).fetchone()
    d = dict(u)
    d["offers"] = [dict(r) for r in db.execute(
        "SELECT s.id, s.name, s.category FROM offers o JOIN skills s ON s.id = o.skill_id WHERE o.user_id = ? ORDER BY s.name", (uid,))]
    d["wants"] = [dict(r) for r in db.execute(
        "SELECT s.id, s.name, s.category FROM wants w JOIN skills s ON s.id = w.skill_id WHERE w.user_id = ? ORDER BY s.name", (uid,))]
    return d


@app.route("/login")
def login_page():
    if session.get("user_id"):
        return redirect(url_for("dashboard"))
    return render_template("login.html")


@app.route("/api/register", methods=["POST"])
def api_register():
    """Create an account: the name, email and (hashed) password are saved to the users table."""
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not name or not email or not password:
        return jsonify({"error": "Name, email and password are all required"}), 400
    if not EMAIL_RE.match(email):
        return jsonify({"error": "That doesn't look like a valid email address"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    db = get_db()
    try:
        cur = db.execute("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                         (name, email, generate_password_hash(password)))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account with that email already exists. Sign in instead."}), 409
    session.clear()
    session["user_id"] = cur.lastrowid
    return jsonify({"id": cur.lastrowid, "name": name, "email": email}), 201


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    db = get_db()
    user = db.execute("SELECT id, name, password_hash FROM users WHERE LOWER(email) = ?", (email,)).fetchone()
    if not user:
        return jsonify({"error": "No account uses that email yet. Create one to get started.", "code": "no_account"}), 404
    if not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "That password isn't right. Try again."}), 401
    session.clear()
    session["user_id"] = user["id"]
    return jsonify({"id": user["id"], "name": user["name"]})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))


@app.route("/api/me")
def api_me():
    return jsonify(me_payload(get_db(), current_user_id()))


# ---------- Pages ----------

def _page(template, active):
    db = get_db()
    return render_template(template, me=me_payload(db, current_user_id()), active=active)


@app.route("/")
def dashboard():
    return _page("dashboard.html", "dashboard")


@app.route("/network")
def network_page():
    return _page("network.html", "network")


@app.route("/loops")
def loops_page():
    return _page("loops.html", "loops")


@app.route("/marketplace")
def marketplace_page():
    return _page("marketplace.html", "marketplace")


@app.route("/leaderboard")
def leaderboard_page():
    return _page("leaderboard.html", "leaderboard")


@app.route("/teams")
def teams_page():
    return _page("teams.html", "teams")


@app.route("/profile")
def profile_page():
    return _page("profile.html", "profile")


# ---------- Users ----------

@app.route("/api/users", methods=["GET"])
def list_users():
    db = get_db()
    rows = db.execute("""
        SELECT u.id, u.name, u.email, u.credits, u.no_show_count,
               COALESCE(t.trust_score, 5.0) AS trust_score,
               RANK() OVER (ORDER BY COALESCE(t.trust_score, 5.0) DESC) AS rank
        FROM users u
        LEFT JOIN trust_scores t ON t.user_id = u.id
        ORDER BY trust_score DESC
    """).fetchall()
    return jsonify([{k: r[k] for k in r.keys() if k != "email"} for r in rows])


# ---------- Skills ----------

@app.route("/api/skills", methods=["GET"])
def list_skills():
    db = get_db()
    rows = db.execute("""SELECT p.*, s.category FROM skill_pricing p JOIN skills s ON s.id = p.skill_id
                         ORDER BY p.name""").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/skills", methods=["POST"])
def create_skill():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    category = data.get("category", "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    db = get_db()
    try:
        cur = db.execute("INSERT INTO skills (name, category) VALUES (?, ?)", (name, category))
        db.commit()
    except sqlite3.IntegrityError as e:
        return jsonify({"error": "That skill already exists"}), 400
    return jsonify({"id": cur.lastrowid, "name": name, "category": category}), 201


# ---------- Offers / Wants (always for the signed-in user) ----------

def _list_insert(table):
    skill_id = request.get_json(force=True).get("skill_id")
    db = get_db()
    try:
        cur = db.execute(f"INSERT INTO {table} (user_id, skill_id) VALUES (?, ?)", (current_user_id(), skill_id))
        db.commit()
    except sqlite3.IntegrityError as e:
        msg = str(e)
        return jsonify({"error": "You've already added that skill" if "UNIQUE" in msg else msg}), 400
    except sqlite3.DatabaseError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"id": cur.lastrowid}), 201


@app.route("/api/offer", methods=["POST"])
def add_offer():
    return _list_insert("offers")


@app.route("/api/want", methods=["POST"])
def add_want():
    return _list_insert("wants")


@app.route("/api/offer/<int:skill_id>", methods=["DELETE"])
def remove_offer(skill_id):
    db = get_db()
    db.execute("DELETE FROM offers WHERE user_id = ? AND skill_id = ?", (current_user_id(), skill_id))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/want/<int:skill_id>", methods=["DELETE"])
def remove_want(skill_id):
    db = get_db()
    db.execute("DELETE FROM wants WHERE user_id = ? AND skill_id = ?", (current_user_id(), skill_id))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/endorse", methods=["POST"])
def endorse():
    data = request.get_json(force=True)
    db = get_db()
    try:
        db.execute("INSERT INTO endorsements (offer_id, endorsed_by) VALUES (?, ?)", (data.get("offer_id"), current_user_id()))
        db.commit()
    except sqlite3.IntegrityError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"ok": True}), 201


# ---------- Graph data (for visualization) ----------

@app.route("/api/graph")
def graph():
    db = get_db()
    users = db.execute("SELECT id, name FROM users").fetchall()
    edges = db.execute("""
        SELECT e.giver, e.receiver, e.skill_id, s.name AS skill_name
        FROM edges e JOIN skills s ON s.id = e.skill_id
    """).fetchall()
    return jsonify({
        "me": current_user_id(),
        "nodes": [{"id": u["id"], "label": u["name"]} for u in users],
        "edges": [{"from": e["giver"], "to": e["receiver"], "label": e["skill_name"]} for e in edges],
    })


# ---------- Trade-loop detection (recursive CTE) ----------

LOOP_QUERY = """
WITH RECURSIVE walk(start_user, current_user, path, offer_ids, skills, length) AS (
    SELECT giver, receiver,
           ',' || giver || ',' || receiver || ',',
           CAST(offer_id AS TEXT),
           CAST(skill_id AS TEXT),
           1
    FROM edges

    UNION ALL

    SELECT w.start_user, e.receiver,
           w.path || e.receiver || ',',
           w.offer_ids || ',' || e.offer_id,
           w.skills || ',' || e.skill_id,
           w.length + 1
    FROM walk w
    JOIN edges e ON e.giver = w.current_user
    WHERE w.length < 5
      AND instr(w.path, ',' || e.receiver || ',') = 0
)
SELECT w.start_user, w.current_user, w.path, w.offer_ids, w.skills, w.length,
       e2.skill_id AS closing_skill_id, e2.offer_id AS closing_offer_id
FROM walk w
JOIN edges e2 ON e2.giver = w.current_user AND e2.receiver = w.start_user
WHERE w.length >= 2
ORDER BY w.length ASC;
"""


def _canonical_cycle(user_ids):
    """Rotate a cycle so it starts at its smallest user id, for de-duplication."""
    n = len(user_ids)
    min_idx = user_ids.index(min(user_ids))
    return tuple(user_ids[min_idx:] + user_ids[:min_idx])


def _compute_loops(db):
    rows = db.execute(LOOP_QUERY).fetchall()

    name_rows = db.execute("SELECT id, name FROM users").fetchall()
    names = {r["id"]: r["name"] for r in name_rows}
    price_rows = db.execute("SELECT skill_id, price_per_hour, name FROM skill_pricing").fetchall()
    prices = {r["skill_id"]: r["price_per_hour"] for r in price_rows}
    skill_names = {r["skill_id"]: r["name"] for r in price_rows}
    trust_rows = db.execute("SELECT user_id, trust_score FROM trust_scores").fetchall()
    trust = {r["user_id"]: r["trust_score"] for r in trust_rows}

    seen = set()
    loops = []
    for r in rows:
        path_ids = [int(x) for x in r["path"].strip(",").split(",")]
        skill_ids = [int(x) for x in r["skills"].split(",")] + [r["closing_skill_id"]]
        cycle_users = path_ids  # closes back to start, don't repeat start at the end
        key = _canonical_cycle(cycle_users)
        if key in seen:
            continue
        seen.add(key)

        legs = []
        for i in range(len(cycle_users)):
            giver = cycle_users[i]
            receiver = cycle_users[(i + 1) % len(cycle_users)]
            skill_id = skill_ids[i]
            legs.append({
                "giver_id": giver,
                "giver_name": names.get(giver, "?"),
                "receiver_id": receiver,
                "receiver_name": names.get(receiver, "?"),
                "skill_id": skill_id,
                "skill_name": skill_names.get(skill_id, "?"),
                "price_per_hour": prices.get(skill_id, 1.0),
            })

        avg_trust = sum(trust.get(u, 5.0) for u in cycle_users) / len(cycle_users)
        total_value = sum(l["price_per_hour"] for l in legs)

        loops.append({
            "users": [{"id": u, "name": names.get(u, "?")} for u in cycle_users],
            "length": len(cycle_users),
            "legs": legs,
            "avg_trust": round(avg_trust, 2),
            "total_value": round(total_value, 2),
        })

    # Rank: shorter loops and higher trust first (fairness heuristic)
    loops.sort(key=lambda l: (l["length"], -l["avg_trust"]))
    return loops


@app.route("/api/loops")
def find_loops():
    db = get_db()
    me = current_user_id()
    loops = _compute_loops(db)
    for l in loops:
        l["includes_me"] = any(u["id"] == me for u in l["users"])
    loops.sort(key=lambda l: (not l["includes_me"], l["length"], -l["avg_trust"]))
    return jsonify(loops)


# ---------- Execute a trade loop atomically ----------

@app.route("/api/trade/execute", methods=["POST"])
def execute_trade():
    legs = request.get_json(force=True).get("legs", [])
    if len(legs) < 2:
        return jsonify({"error": "a trade loop needs at least 2 legs"}), 400
    db = get_db()
    me = current_user_id()
    if not any(l.get("giver_id") == me or l.get("receiver_id") == me for l in legs):
        return jsonify({"error": "You can only execute loops you're part of"}), 403
    try:
        db.execute("BEGIN IMMEDIATE")   # lock so two people can't settle the same loop at once
        prices = {r["skill_id"]: r["price_per_hour"] for r in db.execute("SELECT skill_id, price_per_hour FROM skill_pricing")}
        for leg in legs:   # every leg must still be a real offer -> want match
            ok = db.execute("SELECT 1 FROM edges WHERE giver=? AND receiver=? AND skill_id=?",
                            (leg["giver_id"], leg["receiver_id"], leg["skill_id"])).fetchone()
            if not ok:
                raise ValueError("This loop is out of date. Someone changed their skills or already settled it.")
        cur = db.execute("INSERT INTO trades (status, loop_length) VALUES ('completed', ?)", (len(legs),))
        trade_id = cur.lastrowid
        for leg in legs:
            db.execute("""
                INSERT INTO trade_legs (trade_id, giver_id, receiver_id, skill_id, hours, credit_value)
                VALUES (?, ?, ?, ?, 1.0, ?)
            """, (trade_id, leg["giver_id"], leg["receiver_id"], leg["skill_id"], prices.get(leg["skill_id"], 1.0)))
        for leg in legs:   # the lesson was received, so that want is fulfilled
            db.execute("DELETE FROM wants WHERE user_id = ? AND skill_id = ?", (leg["receiver_id"], leg["skill_id"]))
        db.execute("COMMIT")
    except Exception as e:
        try:
            db.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        return jsonify({"error": str(e)}), 400
    return jsonify({"trade_id": trade_id, "legs_executed": len(legs)}), 201


@app.route("/api/trade/<int:trade_id>/rate", methods=["POST"])
def rate_trade(trade_id):
    data = request.get_json(force=True)
    db = get_db()
    me = current_user_id()
    try:
        to_user, score = int(data.get("to_user_id")), int(data.get("score"))
    except (TypeError, ValueError):
        return jsonify({"error": "Pick a person and a score from 1 to 5"}), 400
    if not 1 <= score <= 5 or to_user == me:
        return jsonify({"error": "Score must be 1 to 5, and you can't rate yourself"}), 400
    people = {r[0] for r in db.execute("SELECT giver_id FROM trade_legs WHERE trade_id = ? UNION SELECT receiver_id FROM trade_legs WHERE trade_id = ?", (trade_id, trade_id))}
    if me not in people or to_user not in people:
        return jsonify({"error": "You can only rate people you traded with"}), 403
    if db.execute("SELECT 1 FROM ratings WHERE trade_id=? AND from_user_id=? AND to_user_id=?", (trade_id, me, to_user)).fetchone():
        return jsonify({"error": "You've already rated this person for this trade"}), 400
    db.execute("INSERT INTO ratings (trade_id, from_user_id, to_user_id, score) VALUES (?, ?, ?, ?)", (trade_id, me, to_user, score))
    db.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/trades/mine")
def my_trades():
    db = get_db()
    me = current_user_id()
    out = []
    for t in db.execute("""SELECT DISTINCT t.id, t.created_at, t.loop_length FROM trades t JOIN trade_legs l ON l.trade_id = t.id
                           WHERE t.status = 'completed' AND (l.giver_id = ? OR l.receiver_id = ?) ORDER BY t.id DESC LIMIT 15""", (me, me)):
        partners = {}
        for l in db.execute("""SELECT l.giver_id, l.receiver_id, s.name AS skill, gu.name AS gname, ru.name AS rname FROM trade_legs l
                               JOIN skills s ON s.id = l.skill_id JOIN users gu ON gu.id = l.giver_id JOIN users ru ON ru.id = l.receiver_id
                               WHERE l.trade_id = ?""", (t["id"],)):
            if l["giver_id"] == me:
                partners.setdefault(l["receiver_id"], {"user_id": l["receiver_id"], "name": l["rname"], "taught": None, "learned": None})["taught"] = l["skill"]
            if l["receiver_id"] == me:
                partners.setdefault(l["giver_id"], {"user_id": l["giver_id"], "name": l["gname"], "taught": None, "learned": None})["learned"] = l["skill"]
        for uid, p in partners.items():
            r = db.execute("SELECT score FROM ratings WHERE trade_id=? AND from_user_id=? AND to_user_id=?", (t["id"], me, uid)).fetchone()
            p["my_rating"] = r["score"] if r else None
        out.append({"trade_id": t["id"], "created_at": t["created_at"], "loop_length": t["loop_length"], "partners": list(partners.values())})
    return jsonify(out)


@app.route("/api/trade/<int:trade_id>/cancel", methods=["POST"])
def cancel_trade(trade_id):
    db = get_db()
    db.execute("UPDATE trades SET status = 'cancelled', cancelled_by = ? WHERE id = ?", (current_user_id(), trade_id))
    db.commit()
    return jsonify({"ok": True})



# ---------- Hackathon Team Synthesizer ----------

def _skill_names(db):
    return [r["name"] for r in db.execute("SELECT name FROM skills ORDER BY id")]


def _team_rows(db):
    me = current_user_id()
    teams = [dict(t) for t in db.execute("""
        SELECT t.*, u.name AS creator_name,
               (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id AND m.status = 'member') AS member_count
        FROM teams t JOIN users u ON u.id = t.creator_id ORDER BY t.created_at DESC, t.id DESC""")]
    for t in teams:
        t["needs"] = [dict(r) for r in db.execute(
            "SELECT s.id, s.name FROM team_needs n JOIN skills s ON s.id = n.skill_id WHERE n.team_id = ? ORDER BY s.name", (t["id"],))]
        t["members"] = [dict(r) for r in db.execute(
            "SELECT u.id, u.name FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND m.status='member' ORDER BY m.id", (t["id"],))]
        mine = db.execute("SELECT status FROM team_members WHERE team_id = ? AND user_id = ?", (t["id"], me)).fetchone()
        t["my_status"] = "owner" if t["creator_id"] == me else (mine["status"] if mine else None)
        t["is_full"] = t["member_count"] >= t["max_size"]
        t["requests"] = [dict(r) for r in db.execute(
            "SELECT u.id, u.name FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND m.status='pending' ORDER BY m.id", (t["id"],))] if t["creator_id"] == me else []
    return teams


def _real_team_data(db, names):
    """Live training data: user skill vectors (offers), team need vectors, and who asked to join / joined which team."""
    users = [r["id"] for r in db.execute("SELECT id FROM users ORDER BY id")]
    teams = [dict(r) for r in db.execute("SELECT id, creator_id FROM teams ORDER BY id")]
    if not users or not teams:
        return None
    idx = {n: i for i, n in enumerate(names)}
    upos, tpos = {u: i for i, u in enumerate(users)}, {t["id"]: i for i, t in enumerate(teams)}
    X, T = np.zeros((len(users), len(names))), np.zeros((len(teams), len(names)))
    for r in db.execute("SELECT o.user_id, s.name FROM offers o JOIN skills s ON s.id = o.skill_id"):
        X[upos[r[0]], idx[r[1]]] = 1
    for r in db.execute("SELECT n.team_id, s.name FROM team_needs n JOIN skills s ON s.id = n.skill_id"):
        T[tpos[r[0]], idx[r[1]]] = 1
    Y, Wt = np.zeros((len(users), len(teams))), np.ones((len(users), len(teams)))
    for t in teams:
        Wt[upos[t["creator_id"]], tpos[t["id"]]] = 0        # a creator joining their own team says nothing
    for r in db.execute("SELECT team_id, user_id, status FROM team_members"):
        u, t = upos[r["user_id"]], tpos[r["team_id"]]
        if r["status"] in ("pending", "member") and Wt[u, t] > 0:
            Y[u, t] = 1
    return X, T, Y, Wt


def _team_model(db):
    names = _skill_names(db)
    return recommender.get_team_model(names, _real_team_data(db, names))


def _score_teams(db, teams):
    """Attach the matrix-factorization match score (0-100) and the overlapping skills."""
    me = current_user_id()
    mine = [r["name"] for r in db.execute("SELECT s.name FROM offers o JOIN skills s ON s.id=o.skill_id WHERE o.user_id=?", (me,))]
    scores = recommender.match_scores(_team_model(db), mine, [[n["name"] for n in t["needs"]] for t in teams])
    for t, s in zip(teams, scores):
        t["match"] = round(s * 100)
        t["you_bring"] = [n["name"] for n in t["needs"] if n["name"] in mine]
    return teams


@app.route("/api/model-info")
def model_info():
    return jsonify(_team_model(get_db())["info"])


@app.route("/api/teams")
def list_teams():
    db = get_db()
    return jsonify(_score_teams(db, _team_rows(db)))


@app.route("/api/teams", methods=["POST"])
def create_team():
    data = request.get_json(force=True)
    name, hackathon = (data.get("name") or "").strip(), (data.get("hackathon") or "").strip()
    needs = [int(n) for n in data.get("needs", [])]
    try:
        size = int(data.get("max_size"))
    except (TypeError, ValueError):
        size = 0
    if not name or not hackathon:
        return jsonify({"error": "Team name and hackathon are required"}), 400
    if not 2 <= size <= 12:
        return jsonify({"error": "Team size must be between 2 and 12"}), 400
    if not needs:
        return jsonify({"error": "Pick at least one skill your team still needs"}), 400
    db = get_db()
    try:
        cur = db.execute("INSERT INTO teams (name, hackathon, description, max_size, creator_id) VALUES (?,?,?,?,?)",
                         (name, hackathon, (data.get("description") or "").strip(), size, current_user_id()))
        tid = cur.lastrowid
        db.executemany("INSERT OR IGNORE INTO team_needs (team_id, skill_id) VALUES (?, ?)", [(tid, n) for n in needs])
        db.execute("INSERT INTO team_members (team_id, user_id, status) VALUES (?, ?, 'member')", (tid, current_user_id()))
        db.commit()
    except sqlite3.DatabaseError as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    return jsonify({"id": tid}), 201


@app.route("/api/teams/<int:team_id>/join", methods=["POST"])
def join_team(team_id):
    db = get_db()
    team = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team:
        return jsonify({"error": "Team not found"}), 404
    full = db.execute("SELECT COUNT(*) FROM team_members WHERE team_id=? AND status='member'", (team_id,)).fetchone()[0] >= team["max_size"]
    if full:
        return jsonify({"error": "This team is already full"}), 400
    try:
        db.execute("INSERT INTO team_members (team_id, user_id, status) VALUES (?, ?, 'pending')", (team_id, current_user_id()))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "You've already asked to join this team"}), 400
    return jsonify({"ok": True}), 201


@app.route("/api/teams/<int:team_id>/requests/<int:user_id>", methods=["POST"])
def answer_request(team_id, user_id):
    db = get_db()
    team = db.execute("SELECT creator_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team or team["creator_id"] != current_user_id():
        return jsonify({"error": "Only the team creator can answer requests"}), 403
    status = "member" if request.get_json(force=True).get("action") == "approve" else "declined"
    try:
        db.execute("UPDATE team_members SET status = ? WHERE team_id = ? AND user_id = ? AND status = 'pending'", (status, team_id, user_id))
        db.commit()
    except sqlite3.DatabaseError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"ok": True})


# ---------- Live data: change pulse, activity feed, public stats ----------

@app.route("/api/pulse")
def pulse():
    """A short fingerprint of the whole database; browsers poll it and refresh when it changes."""
    db = get_db()
    row = db.execute("""SELECT
        (SELECT COUNT(*) || '.' || COALESCE(MAX(id),0) || '.' || ROUND(COALESCE(SUM(credits),0),4) FROM users),
        (SELECT COUNT(*) || '.' || COALESCE(MAX(id),0) FROM skills),
        (SELECT COUNT(*) || '.' || COALESCE(MAX(id),0) FROM offers),
        (SELECT COUNT(*) || '.' || COALESCE(MAX(id),0) FROM wants),
        (SELECT COUNT(*) || '.' || COALESCE(MAX(id),0) FROM trades),
        (SELECT COUNT(*) FROM ratings),
        (SELECT COUNT(*) || '.' || COALESCE(MAX(id),0) FROM teams),
        (SELECT COUNT(*) FROM team_needs),
        (SELECT COUNT(*) || '.' || COALESCE(MAX(id),0) || '.' || COALESCE(SUM(status='member'),0) || '.' || COALESCE(SUM(status='declined'),0) FROM team_members)
    """).fetchone()
    pending = db.execute("""SELECT COUNT(*) FROM team_members m JOIN teams t ON t.id = m.team_id
                            WHERE m.status = 'pending' AND t.creator_id = ?""", (current_user_id(),)).fetchone()[0]
    return jsonify({"v": "|".join(str(x) for x in row), "pending": pending})


@app.route("/api/activity")
def activity():
    db = get_db()
    ev = []
    for r in db.execute("SELECT created_at, name FROM users ORDER BY id DESC LIMIT 10"):
        ev.append((r["created_at"], "signup", f"{r['name']} joined SkillLoop"))
    for r in db.execute("SELECT o.created_at, u.name, s.name AS skill FROM offers o JOIN users u ON u.id=o.user_id JOIN skills s ON s.id=o.skill_id ORDER BY o.id DESC LIMIT 10"):
        ev.append((r["created_at"], "offer", f"{r['name']} can now teach {r['skill']}"))
    for r in db.execute("SELECT w.created_at, u.name, s.name AS skill FROM wants w JOIN users u ON u.id=w.user_id JOIN skills s ON s.id=w.skill_id ORDER BY w.id DESC LIMIT 10"):
        ev.append((r["created_at"], "want", f"{r['name']} wants to learn {r['skill']}"))
    for r in db.execute("SELECT t.created_at, u.name, t.name AS team, t.hackathon FROM teams t JOIN users u ON u.id=t.creator_id ORDER BY t.id DESC LIMIT 10"):
        ev.append((r["created_at"], "team", f"{r['name']} started {r['team']} for {r['hackathon']}"))
    for r in db.execute("""SELECT m.created_at, u.name, t.name AS team, m.status FROM team_members m JOIN users u ON u.id=m.user_id
                           JOIN teams t ON t.id=m.team_id WHERE m.user_id != t.creator_id AND m.status != 'declined' ORDER BY m.id DESC LIMIT 10"""):
        ev.append((r["created_at"], "request", f"{r['name']} joined {r['team']}" if r["status"] == "member" else f"{r['name']} asked to join {r['team']}"))
    for r in db.execute("""SELECT t.created_at, t.loop_length, (SELECT GROUP_CONCAT(name, ', ') FROM (SELECT DISTINCT u.name FROM trade_legs l
                           JOIN users u ON u.id = l.giver_id WHERE l.trade_id = t.id)) AS names
                           FROM trades t WHERE t.status = 'completed' ORDER BY t.id DESC LIMIT 10"""):
        ev.append((r["created_at"], "trade", f"A {r['loop_length']}-way loop was settled: {r['names']}"))
    ev.sort(key=lambda e: e[0], reverse=True)
    return jsonify([{"ts": t, "kind": k, "text": x} for t, k, x in ev[:12]])


@app.route("/api/public-stats")
def api_public_stats():
    db = get_db()
    q = lambda t, w="": db.execute(f"SELECT COUNT(*) FROM {t} {w}").fetchone()[0]
    return jsonify({"members": q("users"), "skills": q("skills"), "teams": q("teams"), "trades": q("trades", "WHERE status='completed'")})


# ---------- ML recommendations ----------

@app.route("/api/recommendations")
def recommendations():
    db = get_db()
    me = current_user_id()
    # skills: ALS collaborative filtering over everyone's offers + wants (plus synthetic users)
    skills = [dict(r) for r in db.execute("SELECT id, name, category FROM skills ORDER BY id")]
    pos = {s["id"]: i for i, s in enumerate(skills)}
    users = [r["id"] for r in db.execute("SELECT id FROM users ORDER BY id")]
    rows = []
    for u in users:
        ids = {pos[r[0]] for r in db.execute("SELECT skill_id FROM offers WHERE user_id=? UNION SELECT skill_id FROM wants WHERE user_id=?", (u, u))}
        rows.append(ids)
    picked = recommender.suggest_skills([s["name"] for s in skills], rows, users.index(me))
    skill_recs = [{**skills[i], "score": round(sc * 100)} for i, sc in picked]
    # teams: two-tower matrix factorization match score
    teams = [t for t in _score_teams(db, _team_rows(db)) if t["my_status"] is None and not t["is_full"]]
    teams.sort(key=lambda t: -t["match"])
    return jsonify({"skills": skill_recs, "teams": teams[:4]})


# ---------- Conversational data-entry bot ----------
# A lightweight, rule-based NL parser: no external API/model needed, so it
# works fully offline. Every recognized command still goes through the exact
# same SQL inserts / views as the manual forms above.

def _find_user(db, name_query):
    name_query = name_query.strip().strip(".").strip()
    if name_query.lower() in ("i", "me", "my") and session.get("user_id"):
        return db.execute("SELECT id, name FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    return db.execute(
        "SELECT id, name FROM users WHERE LOWER(name) LIKE ? ORDER BY LENGTH(name) ASC LIMIT 1",
        (f"%{name_query.lower()}%",)
    ).fetchone()


def _find_skill(db, skill_query):
    skill_query = skill_query.strip().strip(".").strip()
    return db.execute(
        "SELECT id, name FROM skills WHERE LOWER(name) LIKE ? ORDER BY LENGTH(name) ASC LIMIT 1",
        (f"%{skill_query.lower()}%",)
    ).fetchone()


BOT_PATTERNS = [
    ("add_user", re.compile(r"^add\s+user\s+([a-zA-Z][a-zA-Z .]*?)\s*[,]?\s+([\w.+-]+@[\w.-]+\.\w+)\s+(\S{6,})\s*$", re.I)),
    ("add_skill", re.compile(r"^add\s+skill\s+(.+?)(?:\s*(?:-|:|,|\bin\b|\bcategory\b)\s*(.+))?$", re.I)),
    ("offer", re.compile(r"^(.+?)\s+(?:offers?|can teach|teaches)\s+(.+)$", re.I)),
    ("want", re.compile(r"^(.+?)\s+(?:wants?(?: to learn)?|needs?)\s+(.+)$", re.I)),
    ("loops", re.compile(r"^(find|show|detect|check)?\s*(loops?|trade loops?|cycles?)\s*\??$", re.I)),
    ("leaderboard", re.compile(r"^(leaderboard|trust|rankings?|top users?)\s*\??$", re.I)),
    ("pricing", re.compile(r"^(pricing|prices?|skill prices?)\s*\??$", re.I)),
    ("help", re.compile(r"^(help|\?|what can you do)\s*\??$", re.I)),
]


def _bot_reply(message, db):
    msg = message.strip()
    if not msg:
        return {"reply": "Type something like: add user Priya priya@vit.edu", "action": None}

    for action, pattern in BOT_PATTERNS:
        m = pattern.match(msg)
        if not m:
            continue

        if action == "add_user":
            name, email, pw = m.group(1).strip(), m.group(2).strip(), m.group(3)
            try:
                cur = db.execute("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                                 (name, email, generate_password_hash(pw)))
                db.commit()
                return {"reply": f"Added user \"{name}\" ({email}).", "action": "refresh"}
            except sqlite3.IntegrityError:
                return {"reply": f"A user with that email already exists.", "action": None}

        if action == "add_skill":
            name = m.group(1).strip()
            category = (m.group(2) or "").strip()
            try:
                cur = db.execute("INSERT INTO skills (name, category) VALUES (?, ?)", (name, category))
                db.commit()
                cat_txt = f" under \"{category}\"" if category else ""
                return {"reply": f"Added skill \"{name}\"{cat_txt}.", "action": "refresh"}
            except sqlite3.IntegrityError:
                return {"reply": f"Skill \"{name}\" already exists.", "action": None}

        if action == "offer":
            user_row = _find_user(db, m.group(1))
            skill_row = _find_skill(db, m.group(2))
            if not user_row:
                return {"reply": f"I don't recognize a user matching \"{m.group(1).strip()}\". Add them first: add user <name> <email> <password>", "action": None}
            if not skill_row:
                return {"reply": f"I don't recognize a skill matching \"{m.group(2).strip()}\". Add it first: add skill <name>", "action": None}
            try:
                db.execute("INSERT INTO offers (user_id, skill_id) VALUES (?, ?)", (user_row["id"], skill_row["id"]))
                db.commit()
                return {"reply": f"Noted: {user_row['name']} can now teach {skill_row['name']}.", "action": "refresh"}
            except sqlite3.IntegrityError:
                return {"reply": f"{user_row['name']} already offers {skill_row['name']}.", "action": None}

        if action == "want":
            user_row = _find_user(db, m.group(1))
            skill_row = _find_skill(db, m.group(2))
            if not user_row:
                return {"reply": f"I don't recognize a user matching \"{m.group(1).strip()}\". Add them first: add user <name> <email> <password>", "action": None}
            if not skill_row:
                return {"reply": f"I don't recognize a skill matching \"{m.group(2).strip()}\". Add it first: add skill <name>", "action": None}
            try:
                db.execute("INSERT INTO wants (user_id, skill_id) VALUES (?, ?)", (user_row["id"], skill_row["id"]))
                db.commit()
                return {"reply": f"Noted: {user_row['name']} wants to learn {skill_row['name']}.", "action": "refresh"}
            except sqlite3.IntegrityError:
                return {"reply": f"{user_row['name']} already wants {skill_row['name']}.", "action": None}

        if action == "loops":
            loops = _compute_loops(db)
            if not loops:
                return {"reply": "No closed trade loops right now. Add more offers/wants that form a cycle.", "action": None}
            best = loops[0]
            path = " -> ".join(u["name"] for u in best["users"]) + " -> " + best["users"][0]["name"]
            extra = f" ({len(loops)-1} more found.)" if len(loops) > 1 else ""
            return {"reply": f"Found a {best['length']}-way loop: {path}{extra}", "action": "show_loops"}

        if action == "leaderboard":
            rows = db.execute("""
                SELECT u.name, COALESCE(t.trust_score, 5.0) AS trust_score
                FROM users u LEFT JOIN trust_scores t ON t.user_id = u.id
                ORDER BY trust_score DESC LIMIT 3
            """).fetchall()
            if not rows:
                return {"reply": "No users yet.", "action": None}
            txt = ", ".join(f"{r['name']} ({r['trust_score']:.2f})" for r in rows)
            return {"reply": f"Top trust scores: {txt}", "action": None}

        if action == "pricing":
            rows = db.execute("SELECT name, price_per_hour FROM skill_pricing ORDER BY price_per_hour DESC LIMIT 3").fetchall()
            if not rows:
                return {"reply": "No skills yet.", "action": None}
            txt = ", ".join(f"{r['name']} ({r['price_per_hour']:.2f} cr/hr)" for r in rows)
            return {"reply": f"Highest-priced skills right now: {txt}", "action": None}

        if action == "help":
            return {"reply": (
                "Try commands like:\n"
                "- add user Priya priya@vit.edu secret123\n"
                "- I offer Cooking / I want Guitar Lessons\n"
                "- add skill Cooking - Lifestyle\n"
                "- Priya offers Cooking\n"
                "- Priya wants Guitar Lessons\n"
                "- find loops\n"
                "- leaderboard\n"
                "- pricing"
            ), "action": None}

    return {"reply": "I didn't understand that. Type \"help\" to see example commands.", "action": None}


@app.route("/api/bot", methods=["POST"])
def bot():
    data = request.get_json(force=True)
    message = data.get("message", "")
    db = get_db()
    result = _bot_reply(message, db)
    return jsonify(result)


@app.route("/api/leaderboard")
def leaderboard():
    db = get_db()
    rows = db.execute("""
        SELECT u.id, u.name, u.credits, u.no_show_count,
               COALESCE(t.trust_score, 5.0) AS trust_score,
               COALESCE(t.rating_count, 0) AS rating_count,
               RANK() OVER (ORDER BY COALESCE(t.trust_score, 5.0) DESC) AS rank
        FROM users u
        LEFT JOIN trust_scores t ON t.user_id = u.id
        ORDER BY rank, u.name
    """).fetchall()
    return jsonify([dict(r) for r in rows])


migrate()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)
