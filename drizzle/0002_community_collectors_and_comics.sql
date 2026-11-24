DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE collectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#FF2E88',
  is_founder INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE comics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collector_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  issue TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  variant TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  is_signed INTEGER NOT NULL DEFAULT 0,
  purchase_price_cents INTEGER NOT NULL DEFAULT 0,
  current_value_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'owned',
  purchase_date TEXT,
  source TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  cover_color TEXT NOT NULL DEFAULT '#FF2E88',
  cover_blob_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX comics_collector_idx ON comics (collector_id);
