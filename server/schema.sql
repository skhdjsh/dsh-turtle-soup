CREATE TABLE IF NOT EXISTS puzzles (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL UNIQUE,
  payload   TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'pending',
  submitter TEXT,
  note      TEXT,
  created   INTEGER NOT NULL,
  updated   INTEGER NOT NULL,
  decided   INTEGER,
  reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_status ON puzzles (status);
CREATE INDEX IF NOT EXISTS idx_title ON puzzles (title);
