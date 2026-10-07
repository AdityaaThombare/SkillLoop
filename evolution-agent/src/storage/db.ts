import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

let dbInstance: Database.Database | null = null;

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migratePhase4Columns(db: Database.Database): void {
  for (const [column, definition] of Object.entries({
    calibration_method: 'TEXT', routing_decision: 'TEXT', secondary_model: 'TEXT', secondary_result: 'TEXT', final_policy_decision: 'TEXT',
  })) addColumnIfMissing(db, 'decision_log', column, definition);
  for (const [column, definition] of Object.entries({
    calibrated_confidence: 'REAL', calibration_method: 'TEXT', routing_decision: 'TEXT', secondary_model: 'TEXT', secondary_result: 'TEXT', final_policy_decision: 'TEXT', latency_ms: 'INTEGER',
  })) addColumnIfMissing(db, 'repair_attempts', column, definition);
  for (const [column, definition] of Object.entries({
    validation_samples: 'INTEGER NOT NULL DEFAULT 0', test_samples: 'INTEGER NOT NULL DEFAULT 0', reliability_json: 'TEXT',
  })) addColumnIfMissing(db, 'calibration_params', column, definition);
  db.exec(`
    CREATE TABLE IF NOT EXISTS phase4_decisions (
      decision_id TEXT PRIMARY KEY, repair_id TEXT NOT NULL, evidence_id INTEGER, target_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')), model_name TEXT, decision_type TEXT NOT NULL DEFAULT 'choice',
      raw_scores TEXT, raw_distribution TEXT, selected_candidate INTEGER, raw_confidence REAL,
      calibrated_distribution TEXT, calibrated_confidence REAL, calibration_method TEXT,
      risk_level TEXT NOT NULL, routing_decision TEXT NOT NULL CHECK(routing_decision IN ('EXECUTE','VERIFY_WITH_SECONDARY','ABSTAIN')),
      secondary_model TEXT, secondary_result TEXT, final_policy_decision TEXT NOT NULL CHECK(final_policy_decision IN ('EXECUTE','REVIEW','ABSTAIN')),
      latency_ms INTEGER NOT NULL DEFAULT 0, execution_attempted INTEGER NOT NULL DEFAULT 0, execution_success INTEGER,
      verification_attempted INTEGER NOT NULL DEFAULT 0, verification_success INTEGER, error_message TEXT
    );
    CREATE TABLE IF NOT EXISTS phase4_labels (
      decision_id TEXT PRIMARY KEY REFERENCES phase4_decisions(decision_id) ON DELETE CASCADE,
      actual_class INTEGER NOT NULL, data_split TEXT NOT NULL CHECK(data_split IN ('calibration','validation','test')),
      labelled_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_phase4_decisions_time ON phase4_decisions(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_phase4_labels_split ON phase4_labels(data_split);
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_calibration_data_split_model ON calibration_data(data_split, decision_log_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_decision_log_routing ON decision_log(routing_decision, risk_level)');
}

function migratePhase5Tables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_recommendations (
      recommendation_id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK(category IN ('QUICK_WIN','UX_IMPROVEMENT','FEATURE_OPPORTUNITY')),
      title TEXT NOT NULL, description TEXT NOT NULL, evidence_ids TEXT NOT NULL, affected_route TEXT NOT NULL,
      expected_benefit TEXT NOT NULL, risk TEXT NOT NULL CHECK(risk IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      confidence REAL NOT NULL, implementation_plan TEXT NOT NULL, status TEXT NOT NULL, evidence_grounded INTEGER NOT NULL DEFAULT 1,
      approval TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS evolution_patches (
      patch_id TEXT PRIMARY KEY, recommendation_id TEXT NOT NULL REFERENCES evolution_recommendations(recommendation_id),
      diff TEXT NOT NULL, backups_json TEXT NOT NULL, approval TEXT NOT NULL, test_result TEXT, visual_verification TEXT,
      rollback TEXT, final_status TEXT NOT NULL, error_message TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_evolution_recommendations_status ON evolution_recommendations(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evolution_patches_recommendation ON evolution_patches(recommendation_id, created_at DESC);
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS application_analyses (
    analysis_id TEXT PRIMARY KEY, input_type TEXT NOT NULL CHECK(input_type IN ('screenshot','url','codebase')),
    target TEXT NOT NULL, overview TEXT NOT NULL, evidence_json TEXT NOT NULL, recommendations_json TEXT NOT NULL,
    model_name TEXT NOT NULL, calibration_status TEXT NOT NULL DEFAULT 'CALIBRATION_REQUIRED', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  ); CREATE INDEX IF NOT EXISTS idx_application_analyses_time ON application_analyses(created_at DESC);`);
}

export const SCHEMA_SQL = `
-- Decision audit log (immutable)
CREATE TABLE IF NOT EXISTS decision_log (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id              TEXT NOT NULL,
    timestamp               TEXT NOT NULL DEFAULT (datetime('now')),
    model_name              TEXT NOT NULL,
    decision_type           TEXT NOT NULL CHECK (decision_type IN ('choice','score','noul')),
    question                TEXT NOT NULL,
    evidence_hash           TEXT NOT NULL,
    prompt_version          TEXT NOT NULL DEFAULT 'v1',

    raw_scores              TEXT NOT NULL,
    raw_distribution        TEXT NOT NULL,
    calibrated_distribution TEXT NOT NULL,
    chosen_index            INTEGER,

    raw_confidence          REAL NOT NULL,
    calibrated_confidence   REAL NOT NULL,
    entropy                 REAL,
    margin                  REAL,

    risk_score              REAL NOT NULL,
    risk_level              TEXT NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    threshold_used          REAL,

    secondary_invoked       INTEGER NOT NULL DEFAULT 0,
    secondary_choice        INTEGER,
    secondary_confidence    REAL,
    secondary_agreement     INTEGER,

    action                  TEXT NOT NULL CHECK (action IN ('execute','abstain','secondary','human')),
    outcome                 TEXT CHECK (outcome IN ('success','failure','pending','abstained')),

    latency_ms              INTEGER,
    primary_tokens          INTEGER,
    secondary_tokens        INTEGER,
    retry_count             INTEGER NOT NULL DEFAULT 0
);

-- Repair memory with mutation family tracking
CREATE TABLE IF NOT EXISTS repair_memory (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    original_selector   TEXT NOT NULL,
    repaired_selector   TEXT NOT NULL,
    page_url            TEXT NOT NULL,
    mutation_family     TEXT,
    context_hash        TEXT NOT NULL,
    attempted_at        TEXT NOT NULL DEFAULT (datetime('now')),
    succeeded           INTEGER NOT NULL,
    verification_method TEXT,
    failure_reason      TEXT
);

-- Calibration parameters (one row per model x decision_type)
CREATE TABLE IF NOT EXISTS calibration_params (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name          TEXT NOT NULL,
    decision_type       TEXT NOT NULL,
    calibration_method  TEXT NOT NULL DEFAULT 'temperature',
    temperature         REAL,
    platt_a             REAL,
    platt_b             REAL,
    ece                 REAL,
    brier_score         REAL,
    nll                 REAL,
    training_samples    INTEGER NOT NULL DEFAULT 0,
    fitted_at           TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(model_name, decision_type)
);

-- Calibration training data
CREATE TABLE IF NOT EXISTS calibration_data (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_log_id     INTEGER NOT NULL,
    raw_score           TEXT NOT NULL,
    predicted_class     INTEGER,
    actual_class        INTEGER,
    was_correct         INTEGER NOT NULL,
    data_split          TEXT NOT NULL DEFAULT 'calibration' CHECK (data_split IN ('calibration','validation','test')),
    recorded_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Evidence cache
CREATE TABLE IF NOT EXISTS evidence_cache (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    url                 TEXT NOT NULL,
    page_hash           TEXT NOT NULL,
    evidence_json       TEXT NOT NULL,
    extracted_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(url, page_hash)
);

-- Benchmark run results
CREATE TABLE IF NOT EXISTS benchmark_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              TEXT UNIQUE NOT NULL,
    baseline_id         TEXT NOT NULL,
    mutation_id         TEXT NOT NULL,
    mutation_variant    TEXT NOT NULL,
    repetition          INTEGER NOT NULL,
    seed                INTEGER NOT NULL,
    success             INTEGER NOT NULL,
    false_action        INTEGER NOT NULL DEFAULT 0,
    genuine_defect_detected INTEGER,
    latency_ms          INTEGER,
    tokens_primary      INTEGER,
    tokens_secondary    INTEGER,
    confidence          REAL,
    entropy             REAL,
    margin              REAL,
    secondary_invoked   INTEGER NOT NULL DEFAULT 0,
    prompt_version      TEXT NOT NULL DEFAULT 'v1',
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repair_attempts (
    repair_id               TEXT PRIMARY KEY,
    evidence_id             INTEGER,
    target_id               TEXT NOT NULL,
    timestamp               TEXT NOT NULL DEFAULT (datetime('now')),
    failure_type            TEXT NOT NULL,
    candidate_count         INTEGER NOT NULL DEFAULT 0,
    baseline_candidate      INTEGER,
    baseline_score          REAL,
    model_name              TEXT,
    selected_candidate      INTEGER,
    probabilities           TEXT,
    raw_confidence          REAL,
    risk_level              TEXT NOT NULL,
    policy_action           TEXT NOT NULL,
    execution_attempted     INTEGER NOT NULL DEFAULT 0,
    execution_success       INTEGER,
    verification_attempted  INTEGER NOT NULL DEFAULT 0,
    verification_success    INTEGER,
    final_status            TEXT NOT NULL,
    error_message           TEXT
);
`;

/**
 * Initializes and returns the SQLite database instance for EvoJev
 */
export function initDb(dbPath?: string): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const resolvedPath = dbPath || process.env.EVOLUTION_DB_PATH || './evolution.db';
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Execute table definitions
  db.exec(SCHEMA_SQL);
  migratePhase4Columns(db);
  migratePhase5Tables(db);

  dbInstance = db;
  return dbInstance;
}

/**
 * Gets the current active database instance or initializes it
 */
export function getDb(): Database.Database {
  if (!dbInstance) {
    return initDb();
  }
  return dbInstance;
}

/**
 * Closes the active database connection
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
