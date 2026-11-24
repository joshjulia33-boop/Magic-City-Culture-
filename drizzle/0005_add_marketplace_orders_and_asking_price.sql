ALTER TABLE comics ADD COLUMN asking_price_cents INTEGER;
--> statement-breakpoint
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comic_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX orders_seller_idx ON orders (seller_id);
--> statement-breakpoint
CREATE INDEX orders_buyer_idx ON orders (buyer_id);
