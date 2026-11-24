import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// A collector is a community member profile. Profiles are created in-app
// (no passwords — public hosting with real accounts comes later), and each
// collector owns their own shelf of comics.
export const collectors = sqliteTable("collectors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull(),
  handle: text("handle").notNull().unique(),
  city: text("city").notNull().default(""),
  bio: text("bio").notNull().default(""),
  avatarColor: text("avatar_color").notNull().default("#FF2E88"),
  isFounder: integer("is_founder").notNull().default(0),
  // The collector's own choice about their current values: 0 = values are
  // visible only to the collector on their private shelf (the default);
  // 1 = the collector opted in to show each book's current value (and their
  // shelf total) in the shared gallery and on their public profile. Price
  // paid, purchase date, source, and notes are never public either way.
  showValuesPublicly: integer("show_values_publicly").notNull().default(0),
  // The Muse identity (viewer key) that owns this profile. Private shelf
  // access and all edits are checked against it server-side. The founder
  // profile predates binding: it belongs to the space owner instead
  // (isFounder = 1, ownerKey null).
  ownerKey: text("owner_key"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const comics = sqliteTable("comics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  collectorId: integer("collector_id").notNull(),
  title: text("title").notNull(),
  issue: text("issue").notNull().default(""),
  publisher: text("publisher").notNull().default(""),
  variant: text("variant").notNull().default(""),
  grade: text("grade").notNull().default(""),
  isSigned: integer("is_signed").notNull().default(0),
  // Money is owner-private: these columns are only ever returned by the
  // shelf action (the owner's own view), never by community-facing actions.
  purchasePriceCents: integer("purchase_price_cents").notNull().default(0),
  currentValueCents: integer("current_value_cents").notNull().default(0),
  // Marketplace asking price, set only while the book is listed for sale.
  // Unlike the collection value above, a listing price is public by nature
  // — it's the offer to everyone. Cleared when the book isn't for sale.
  askingPriceCents: integer("asking_price_cents"),
  status: text("status", { enum: ["owned", "for_sale", "sold", "wishlist"] })
    .notNull()
    .default("owned"),
  purchaseDate: text("purchase_date"),
  source: text("source").notNull().default(""),
  notes: text("notes").notNull().default(""),
  coverColor: text("cover_color").notNull().default("#FF2E88"),
  // Optional photo of the collector's own copy, stored as an owned blob.
  coverBlobKey: text("cover_blob_key"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A marketplace order: one member buying another member's for-sale comic at
// its asking price. The price is snapshotted at purchase time so later
// edits to the listing never rewrite the deal. The comic itself stays on
// the seller's shelf with status "sold"; the order is the shared record
// both sides track (buyer's purchases, seller's sales).
export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  comicId: integer("comic_id").notNull(),
  sellerId: integer("seller_id").notNull(),
  buyerId: integer("buyer_id").notNull(),
  priceCents: integer("price_cents").notNull(),
  status: text("status", { enum: ["placed", "completed"] })
    .notNull()
    .default("placed"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});
