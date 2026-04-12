-- Space Runner leaderboard schema
-- Idempotent: safe to run on every server start.

CREATE TABLE IF NOT EXISTS runs (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(32) NOT NULL,
  distance        INTEGER NOT NULL CHECK (distance >= 0 AND distance < 100000),
  planets_cleared INTEGER NOT NULL CHECK (planets_cleared >= 0 AND planets_cleared < 1000),
  crystals        INTEGER NOT NULL CHECK (crystals >= 0 AND crystals < 100000),
  score           INTEGER NOT NULL CHECK (score >= 0 AND score < 1000000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_score_desc ON runs (score DESC);
