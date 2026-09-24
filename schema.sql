-- SkillLoop schema
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS team_needs;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS ratings;
DROP TABLE IF EXISTS trade_legs;
DROP TABLE IF EXISTS trades;
DROP TABLE IF EXISTS endorsements;
DROP TABLE IF EXISTS wants;
DROP TABLE IF EXISTS offers;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    credits       REAL NOT NULL DEFAULT 5.0,
    no_show_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE skills (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT UNIQUE NOT NULL,
    category TEXT
);

CREATE TABLE offers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id    INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, skill_id)
);

CREATE TABLE wants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id    INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, skill_id)
);

CREATE TABLE endorsements (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id         INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    endorsed_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(offer_id, endorsed_by)
);

CREATE TABLE trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    status          TEXT NOT NULL DEFAULT 'completed', -- completed | cancelled
    cancelled_by    INTEGER REFERENCES users(id),
    loop_length     INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE trade_legs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id      INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    giver_id      INTEGER NOT NULL REFERENCES users(id),
    receiver_id   INTEGER NOT NULL REFERENCES users(id),
    skill_id      INTEGER NOT NULL REFERENCES skills(id),
    hours         REAL NOT NULL DEFAULT 1.0,
    credit_value  REAL NOT NULL
);

CREATE TABLE ratings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id     INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id   INTEGER NOT NULL REFERENCES users(id),
    score        INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ===== HACKATHON TEAM SYNTHESIZER =====

CREATE TABLE teams (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    hackathon   TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    max_size    INTEGER NOT NULL CHECK (max_size BETWEEN 2 AND 12),
    creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Skills a team still needs
CREATE TABLE team_needs (
    team_id  INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, skill_id)
);

-- status: member | pending | declined
CREATE TABLE team_members (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('member','pending','declined')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, user_id)
);

-- ===== VIEWS =====

-- Directed "can-give" graph: giver offers a skill that receiver wants
CREATE VIEW IF NOT EXISTS edges AS
SELECT o.user_id AS giver, w.user_id AS receiver, o.skill_id AS skill_id, o.id AS offer_id
FROM offers o
JOIN wants w ON o.skill_id = w.skill_id
WHERE o.user_id != w.user_id;

-- Dynamic pricing: price rises with demand, falls with supply
CREATE VIEW IF NOT EXISTS skill_pricing AS
SELECT
    s.id AS skill_id,
    s.name,
    (SELECT COUNT(*) FROM wants w WHERE w.skill_id = s.id) AS demand,
    (SELECT COUNT(*) FROM offers o WHERE o.skill_id = s.id) AS supply,
    ROUND(
        1.0 * (1.0 + 0.15 * (
            (SELECT COUNT(*) FROM wants w WHERE w.skill_id = s.id) -
            (SELECT COUNT(*) FROM offers o WHERE o.skill_id = s.id)
        )),
        2
    ) AS price_per_hour
FROM skills s;

-- Trust-decay score per user: recent ratings count more (exponential decay, half-life ~14 days)
CREATE VIEW IF NOT EXISTS trust_scores AS
SELECT
    to_user_id AS user_id,
    ROUND(
        SUM(score * EXP(-0.05 * (julianday('now') - julianday(created_at)))) /
        NULLIF(SUM(EXP(-0.05 * (julianday('now') - julianday(created_at)))), 0),
        2
    ) AS trust_score,
    COUNT(*) AS rating_count
FROM ratings
GROUP BY to_user_id;

-- ===== TRIGGERS =====

-- Auto-settle credits when a trade leg is recorded: giver earns, receiver spends
CREATE TRIGGER IF NOT EXISTS trg_trade_leg_settle
AFTER INSERT ON trade_legs
BEGIN
    UPDATE users SET credits = credits + NEW.credit_value WHERE id = NEW.giver_id;
    UPDATE users SET credits = credits - NEW.credit_value WHERE id = NEW.receiver_id;
END;

-- Flag no-shows automatically when a trade is cancelled
CREATE TRIGGER IF NOT EXISTS trg_trade_cancel_flag
AFTER UPDATE OF status ON trades
WHEN NEW.status = 'cancelled' AND NEW.cancelled_by IS NOT NULL
BEGIN
    UPDATE users SET no_show_count = no_show_count + 1 WHERE id = NEW.cancelled_by;
END;

-- A skill offer requires the offering user to not already be flagged 3+ times (basic integrity trigger)
CREATE TRIGGER IF NOT EXISTS trg_block_flagged_offers
BEFORE INSERT ON offers
WHEN (SELECT no_show_count FROM users WHERE id = NEW.user_id) >= 3
BEGIN
    SELECT RAISE(ABORT, 'User has too many no-shows to list new offers');
END;

-- A team can never hold more accepted members than max_size
CREATE TRIGGER IF NOT EXISTS trg_team_full_insert
BEFORE INSERT ON team_members
WHEN NEW.status = 'member'
 AND (SELECT COUNT(*) FROM team_members WHERE team_id = NEW.team_id AND status = 'member')
     >= (SELECT max_size FROM teams WHERE id = NEW.team_id)
BEGIN
    SELECT RAISE(ABORT, 'This team is already full');
END;

CREATE TRIGGER IF NOT EXISTS trg_team_full_update
BEFORE UPDATE OF status ON team_members
WHEN NEW.status = 'member' AND OLD.status != 'member'
 AND (SELECT COUNT(*) FROM team_members WHERE team_id = NEW.team_id AND status = 'member')
     >= (SELECT max_size FROM teams WHERE id = NEW.team_id)
BEGIN
    SELECT RAISE(ABORT, 'This team is already full');
END;
