"""SkillLoop recommender: matrix factorization that learns from the live database.

Two models, both plain numpy (no ML framework needed):

1. Team matcher  - a two-tower matrix factorization. Users and teams are each
   projected into a shared latent space (score = user_factors . team_factors),
   trained with gradient descent (Adam) on synthetic "user joined team" data.
   Because the factors are learned from skill features, it also works for users
   and teams created after training (no cold-start problem).

2. Skill suggester - collaborative filtering with ALS matrix factorization on a
   user x skill matrix (real users' offers/wants + synthetic users), predicting
   skills a user is likely to want that they don't have yet.

Real data first: team-join requests, offers, wants and team needs are read from the database and the models
retrain automatically when they change. Synthetic users/teams (generated from skill "archetypes" plus noise) are
only a cold-start prior, mixed in until enough real data exists, and must be disclosed as such in the report.
"""
import hashlib
import os
import threading
import numpy as np

REAL_ONLY_MIN_POSITIVES = 60   # real join requests needed before synthetic data is dropped
REAL_ONLY_MIN_USERS = 40        # real users needed before the skill suggester drops synthetic users
REAL_WEIGHT = 8.0               # real user-team pairs count this much more than synthetic ones
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "team_model.npz")

ARCHETYPES = {
    "mobile":   ["Android Development", "Flutter", "UI/UX Design", "Figma"],
    "backend":  ["Node.js", "SQL & Databases", "Python Basics", "Web Development", "Docker", "Git & GitHub"],
    "security": ["Cybersecurity Basics", "Ethical Hacking", "Linux"],
    "web":      ["Web Development", "React", "UI/UX Design", "Python Basics"],
    "ml":       ["Machine Learning", "Deep Learning", "Data Analysis", "Data Visualization", "Python Basics"],
    "product":  ["Pitching", "Project Management", "Public Speaking", "UI/UX Design", "Resume Review"],
    "creative": ["Graphic Design", "Video Editing", "Photography", "UI/UX Design"],
    "hardware": ["Embedded Systems", "Python Basics", "Arduino", "Robotics"],
    "lifestyle": ["Guitar Lessons", "Football Coaching", "Photography"],
}


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))


def _clusters(skill_names):
    idx = {n: i for i, n in enumerate(skill_names)}
    out = [[idx[n] for n in names if n in idx] for names in ARCHETYPES.values()]
    return [c for c in out if len(c) >= 2] or [list(range(len(skill_names)))]


def synth_users(skill_names, n, rng):
    """Synthetic user skill sets (offers) drawn from archetype clusters + noise."""
    K, cl = len(skill_names), _clusters(skill_names)
    X = np.zeros((n, K))
    for u in range(n):
        for c in rng.choice(len(cl), size=rng.choice([1, 2], p=[.7, .3]), replace=False):
            for s in cl[c]:
                if rng.random() < 0.65:
                    X[u, s] = 1
        X[u, rng.random(K) < 0.05] = 1
        if X[u].sum() == 0:
            X[u, rng.integers(K)] = 1
    return X


def synth_teams(skill_names, n, rng):
    """Synthetic teams: each needs 2-4 skills, mostly from one archetype."""
    K, cl = len(skill_names), _clusters(skill_names)
    T = np.zeros((n, K))
    for t in range(n):
        c = cl[rng.integers(len(cl))]
        for s in rng.choice(c, size=min(len(c), rng.integers(2, 5)), replace=False):
            T[t, s] = 1
        if rng.random() < 0.25:
            T[t, rng.integers(K)] = 1
    return T


def _auc(scores, labels):
    order = np.argsort(scores)
    ranks = np.empty(len(scores))
    ranks[order] = np.arange(1, len(scores) + 1)
    pos = labels == 1
    n1, n0 = pos.sum(), (~pos).sum()
    return float((ranks[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else float("nan")


def _fit(X, T, Y, Wt, d=8, epochs=600, lr=0.03, l2=1e-3, seed=7):
    """Two-tower matrix factorization: score(u, t) = (x_u W) . (t_t V) + b, weighted cross-entropy, Adam."""
    rng = np.random.default_rng(seed)
    K = X.shape[1]
    W, V, b = rng.normal(0, .1, (K, d)), rng.normal(0, .1, (K, d)), np.array(-2.0)
    params, m, v = [W, V, b], [np.zeros_like(W), np.zeros_like(V), np.zeros(())], [np.zeros_like(W), np.zeros_like(V), np.zeros(())]
    total = max(float(Wt.sum()), 1e-9)
    for step in range(1, epochs + 1):
        P, Q = X @ W, T @ V
        G = (_sigmoid(P @ Q.T + b) - Y) * Wt / total
        grads = [X.T @ (G @ Q) + l2 * W, T.T @ (G.T @ P) + l2 * V, np.array(G.sum())]
        for i, g in enumerate(grads):
            m[i] = .9 * m[i] + .1 * g
            v[i] = .999 * v[i] + .001 * g * g
            params[i] -= lr * (m[i] / (1 - .9 ** step)) / (np.sqrt(v[i] / (1 - .999 ** step)) + 1e-8)
    return params


def train_team_model(skill_names, n_users=400, n_teams=150, seed=7, save=True):
    """Synthetic warm-start model (used until real join data exists). Reports held-out AUC."""
    rng = np.random.default_rng(seed)
    X, T = synth_users(skill_names, n_users, rng), synth_teams(skill_names, n_teams, rng)
    overlap = (X @ T.T) / np.maximum(T.sum(1), 1)
    Y = (rng.random(overlap.shape) < _sigmoid(5 * overlap - 2.3)).astype(float)
    train = rng.random(Y.shape) < 0.8
    W, V, b = _fit(X, T, Y, train.astype(float), seed=seed)
    S = (X @ W) @ (T @ V).T + b
    info = {"real_users": 0, "real_teams": 0, "real_positives": 0, "synthetic_prior": True,
            "real_only_after": REAL_ONLY_MIN_POSITIVES, "test_auc": round(_auc(S[~train], Y[~train]), 3)}
    if save:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
        np.savez(MODEL_PATH, W=W, V=V, b=b, names=np.array(skill_names))
    return {"W": W, "V": V, "b": b, "names": list(skill_names), "info": info, "metrics": info}


def train_hybrid(skill_names, Xr, Tr, Yr, Wr, seed=7):
    """Train on REAL users/teams/join requests. Below REAL_ONLY_MIN_POSITIVES real positives, synthetic
    users and teams are added as a warm-start prior (real pairs weighted higher); above it, real data only."""
    pos = int(((Yr > 0) & (Wr > 0)).sum())
    use_synth = pos < REAL_ONLY_MIN_POSITIVES
    if use_synth:
        rng = np.random.default_rng(seed)
        Xs, Ts = synth_users(skill_names, 400, rng), synth_teams(skill_names, 150, rng)
        Xa, Ta = np.vstack([Xs, Xr]), np.vstack([Ts, Tr])
        Y = (rng.random((len(Xa), len(Ta))) < _sigmoid(5 * ((Xa @ Ta.T) / np.maximum(Ta.sum(1), 1)) - 2.3)).astype(float)
        Wt = np.ones_like(Y)
        Y[len(Xs):, len(Ts):] = Yr
        Wt[len(Xs):, len(Ts):] = Wr * REAL_WEIGHT
    else:
        Xa, Ta, Y, Wt = Xr, Tr, Yr, Wr.astype(float)
    W, V, b = _fit(Xa, Ta, Y, Wt, seed=seed)
    info = {"real_users": int(len(Xr)), "real_teams": int(len(Tr)), "real_positives": pos,
            "synthetic_prior": use_synth, "real_only_after": REAL_ONLY_MIN_POSITIVES}
    return {"W": W, "V": V, "b": b, "names": list(skill_names), "info": info}


_cache, _lock = {}, threading.Lock()


def get_team_model(skill_names, real=None):
    """real = (X, T, Y, Wt) built from the live database, or None. The model is retrained automatically
    whenever that data changes (cached by content hash), so recommendations follow the real data."""
    with _lock:
        if real is None or len(real[0]) == 0 or len(real[1]) == 0:
            key = ("synthetic", tuple(skill_names))
            if _cache.get("key") == key:
                return _cache["model"]
            if os.path.exists(MODEL_PATH):
                z = np.load(MODEL_PATH)
                model = {"W": z["W"], "V": z["V"], "b": z["b"], "names": [str(x) for x in z["names"]],
                         "info": {"real_users": 0, "real_teams": 0, "real_positives": 0, "synthetic_prior": True,
                                  "real_only_after": REAL_ONLY_MIN_POSITIVES}}
            else:
                model = train_team_model(skill_names)
        else:
            h = hashlib.md5()
            for a in real:
                h.update(str(a.shape).encode()); h.update(np.ascontiguousarray(a).tobytes())
            key = ("hybrid", tuple(skill_names), h.hexdigest())
            if _cache.get("key") == key:
                return _cache["model"]
            model = train_hybrid(skill_names, *real)
        _cache["key"], _cache["model"] = key, model
        return model


def _vec(names, model_names):
    idx = {n: i for i, n in enumerate(model_names)}
    x = np.zeros(len(model_names))
    for n in names:
        if n in idx:
            x[idx[n]] = 1
    return x


def match_scores(model, user_skill_names, teams_needs_names):
    """0-1 match probability of this user for each team (each a list of needed skill names)."""
    if not teams_needs_names:
        return []
    p = _vec(user_skill_names, model["names"]) @ model["W"]
    Tm = np.array([_vec(t, model["names"]) for t in teams_needs_names])
    return [float(s) for s in _sigmoid((Tm @ model["V"]) @ p + model["b"])]


def suggest_skills(skill_names, real_rows, user_pos, k=4, d=6, iters=15, lam=0.3, seed=11):
    """ALS matrix factorization on user x skill (1 = offers or wants it). With fewer than
    REAL_ONLY_MIN_USERS real users, synthetic users are mixed in as a warm start; after that it is real data only.
    Returns [(skill_index, score 0-1)] for skills this person has not listed yet."""
    rng = np.random.default_rng(seed)
    K = len(skill_names)
    real = np.array([[1.0 if s in r else 0.0 for s in range(K)] for r in real_rows]).reshape(len(real_rows), K)
    if len(real_rows) < REAL_ONLY_MIN_USERS:
        syn = synth_users(skill_names, 250, rng)
        cl = _clusters(skill_names)
        for row in syn:
            for c in cl:
                if row[c].sum() >= 2:
                    row[[s for s in c if rng.random() < 0.3]] = 1
        R, row = np.vstack([syn, real]), syn.shape[0] + user_pos
    else:
        R, row = real, user_pos
    U, V = rng.normal(0, .1, (R.shape[0], d)), rng.normal(0, .1, (K, d))
    eye = lam * np.eye(d)
    for _ in range(iters):
        U = R @ V @ np.linalg.inv(V.T @ V + eye)
        V = R.T @ U @ np.linalg.inv(U.T @ U + eye)
    have = set(real_rows[user_pos])
    scores = U[row] @ V.T if have else R.sum(0)          # nothing listed yet -> most popular skills
    ranked = [s for s in sorted((s for s in range(K) if s not in have), key=lambda s: -scores[s])[:k]]
    top = max((scores[s] for s in ranked), default=0)
    return [(s, float(max(scores[s], 0) / top) if top > 0 else 0.0) for s in ranked]


if __name__ == "__main__":
    import sqlite3
    db = sqlite3.connect(os.path.join(os.path.dirname(__file__), "skillloop.db"))
    names = [r[0] for r in db.execute("SELECT name FROM skills ORDER BY id")]
    r = train_team_model(names)
    print("Trained synthetic warm-start model:", r["metrics"])
