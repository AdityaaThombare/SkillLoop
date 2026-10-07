import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ChoiceOutputSchema,
  ScoreOutputSchema,
  NoulOutputSchema,
  CandidateSchema,
  computeArgmax,
  isChoiceArgmaxConsistent,
} from '../src/decision/schemas.js';
import { initDb, closeDb } from '../src/storage/db.js';
import fs from 'fs';
import path from 'path';

describe('ChoiceOutputSchema', () => {
  it('parses valid choice output with correct types', () => {
    const valid = {
      type: 'choice',
      scores: [4.8, 1.3, 0.5, -0.4],
      choice: 0,
      reasoning: 'Candidate 0 matches the login button semantics and text best.',
    };

    const result = ChoiceOutputSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choice).toBe(0);
      expect(result.data.scores.length).toBe(4);
      expect(isChoiceArgmaxConsistent(result.data)).toBe(true);
    }
  });

  it('detects model choice inconsistency with argmax', () => {
    const inconsistent = {
      type: 'choice',
      scores: [1.2, 5.8, 0.5],
      choice: 0, // argmax is index 1, but model claims index 0
    };

    const result = ChoiceOutputSchema.safeParse(inconsistent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(isChoiceArgmaxConsistent(result.data)).toBe(false);
      expect(computeArgmax(result.data.scores)).toBe(1);
    }
  });

  it('rejects choice when choice index is out of bounds', () => {
    const outOfBounds = {
      type: 'choice',
      scores: [2.5, 1.0],
      choice: 3, // length is 2, choice 3 is invalid
    };

    const result = ChoiceOutputSchema.safeParse(outOfBounds);
    expect(result.success).toBe(false);
  });

  it('rejects choice when scores length is less than 2', () => {
    const tooFew = {
      type: 'choice',
      scores: [2.5],
      choice: 0,
    };

    const result = ChoiceOutputSchema.safeParse(tooFew);
    expect(result.success).toBe(false);
  });

  it('rejects NaN and Infinite scores', () => {
    const nanScores = {
      type: 'choice',
      scores: [NaN, 1.0],
      choice: 1,
    };
    expect(ChoiceOutputSchema.safeParse(nanScores).success).toBe(false);

    const infScores = {
      type: 'choice',
      scores: [Infinity, 1.0],
      choice: 0,
    };
    expect(ChoiceOutputSchema.safeParse(infScores).success).toBe(false);
  });
});

describe('ScoreOutputSchema (5-bin ordinal scale)', () => {
  it('parses valid 5-bin score output', () => {
    const valid = {
      type: 'score',
      scores: [0.2, 1.1, 3.5, 6.2, 0.7],
      reasoning: 'Severity is high (bin 4).',
    };

    const result = ScoreOutputSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scores).toHaveLength(5);
    }
  });

  it('rejects score output with incorrect bin count', () => {
    const wrongLength = {
      type: 'score',
      scores: [0.2, 1.1, 3.5], // length 3 instead of 5
    };

    const result = ScoreOutputSchema.safeParse(wrongLength);
    expect(result.success).toBe(false);
  });
});

describe('NoulOutputSchema (binary decisions)', () => {
  it('parses valid yes/no scores', () => {
    const valid = {
      type: 'noul',
      scores: {
        yes: 2.4,
        no: -0.8,
      },
      reasoning: 'Element should be healed.',
    };

    const result = NoulOutputSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric binary scores', () => {
    const invalid = {
      type: 'noul',
      scores: {
        yes: 'yes',
        no: 0,
      },
    };

    const result = NoulOutputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('CandidateSchema', () => {
  it('validates a structured candidate representation', () => {
    const candidate = {
      selector: '#assistant-button',
      tag: 'button',
      role: 'button',
      text: 'Open assistant',
      ariaLabel: 'Open assistant',
      visible: true,
      enabled: true,
      deterministicScore: 0.88,
    };

    const result = CandidateSchema.safeParse(candidate);
    expect(result.success).toBe(true);
  });
});

describe('Database Schema Initialization', () => {
  const testDbPath = './test_evolution.db';

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('creates all 6 required tables in SQLite', () => {
    const db = initDb(testDbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('decision_log');
    expect(tableNames).toContain('repair_memory');
    expect(tableNames).toContain('calibration_params');
    expect(tableNames).toContain('calibration_data');
    expect(tableNames).toContain('evidence_cache');
    expect(tableNames).toContain('benchmark_runs');
  });
});
