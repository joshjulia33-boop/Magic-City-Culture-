// Actions for Magic City Culture Community.
//
// Privacy rule (Joshua's call): what a collector paid and what their books
// are worth is personal. By default, community-facing actions
// (getCommunity, getCollectorProfile) never return money fields at all.
// Each collector can opt in (collectors.showValuesPublicly) to make their
// books' current values — and their shelf's total value — visible in the
// gallery and on their public profile; that choice is theirs alone and can
// be switched back off at any time. Price paid, purchase date, source, and
// notes are never public either way: they only come back from getShelf,
// and getShelf — plus every profile/comic mutation — first checks that the
// authenticated caller (ctx.viewer) owns the profile in question: the
// founder profile belongs to the space owner, and every joined profile is
// bound to the Muse identity that created it (collectors.ownerKey).

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { asc, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import { COLLECTION_IMPORT } from "./collection-import";

const AVATAR_COLORS = ["#FF2E88", "#00D4FF", "#B537F2", "#FF6EC7", "#0090FF", "#FF8A00", "#00E5A0", "#FF2E5F"];

const collectorShape = z.object({
  id: z.number(),
  displayName: z.string(),
  handle: z.string(),
  city: z.string(),
  bio: z.string(),
  avatarColor: z.string(),
  isFounder: z.boolean(),
  isMine: z.boolean(),
  // Whether this collector chose to show their books' current values
  // publicly. Default false — values are private unless they opt in.
  showValuesPublicly: z.boolean(),
  // The shelf's total current value, present only when the collector opted
  // in to public values; null while values are private.
  totalValueCents: z.number().nullable(),
  joinedAt: z.string(),
  comicCount: z.number(),
  signedCount: z.number(),
  forSaleCount: z.number(),
});

// Public comic shape: deliberately NO price paid, source, or notes.
// currentValueCents is the one exception, and only by the owner's choice:
// it carries the book's current value when that collector opted in to
// public values (collectors.showValuesPublicly), and is null otherwise.
const publicComicShape = z.object({
  id: z.number(),
  collectorId: z.number(),
  collectorName: z.string(),
  collectorHandle: z.string(),
  title: z.string(),
  issue: z.string(),
  publisher: z.string(),
  variant: z.string(),
  grade: z.string(),
  isSigned: z.boolean(),
  status: z.enum(["owned", "for_sale", "sold", "wishlist"]),
  coverColor: z.string(),
  coverUrl: z.string().nullable(),
  currentValueCents: z.number().nullable(),
  // Marketplace asking price — public whenever the book is listed for
  // sale (a listing price is an offer, not a private value); null otherwise.
  askingPriceCents: z.number().nullable(),
  addedAt: z.string(),
});

// Owner-private comic shape: everything, including money.
const shelfComicShape = publicComicShape.extend({
  purchasePriceCents: z.number(),
  currentValueCents: z.number(),
  purchaseDate: z.string().nullable(),
  source: z.string(),
  notes: z.string(),
});

type CollectorRow = typeof schema.collectors.$inferSelect;
type ComicRow = typeof schema.comics.$inferSelect;

// Stable identity key for the authenticated caller, or null when the call
// carries no viewer context. Local and peer viewers are individual Muse
// users; a cloudflare share token identifies the share, not a person, so
// only the owner flag is trusted there (handled in canAccessPrivate).
function viewerKey(ctx: Ctx): string | null {
  const v = ctx.viewer;
  if (!v) return null;
  if (v.source === "local") return `muse:${v.userId}`;
  if (v.source === "peer") return `muse:${v.museId}`;
  return null;
}

// True only when the authenticated caller owns this collector profile:
// the founder profile belongs to the space owner; a joined profile belongs
// to the Muse identity that created it.
function canAccessPrivate(ctx: Ctx, collector: CollectorRow): boolean {
  if (!ctx.viewer) return false;
  if (collector.isFounder === 1) return ctx.viewer.isOwner === true;
  const key = viewerKey(ctx);
  return key !== null && collector.ownerKey !== null && collector.ownerKey === key;
}

function requirePrivateAccess(ctx: Ctx, collector: CollectorRow): void {
  if (!canAccessPrivate(ctx, collector)) {
    throw new Error(
      "This shelf's private details belong to its owner. You can browse the books in the gallery, or join to start your own shelf.",
    );
  }
}

async function loadCollector(ctx: Ctx, collectorId: number): Promise<CollectorRow> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.collectors)
    .where(eq(schema.collectors.id, collectorId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("That collector profile doesn't exist anymore.");
  return row;
}

async function loadComicOwner(ctx: Ctx, comicId: number): Promise<{ comic: ComicRow; owner: CollectorRow }> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.comics).where(eq(schema.comics.id, comicId)).limit(1);
  const comic = rows[0];
  if (!comic) throw new Error("That comic doesn't exist anymore.");
  const owner = await loadCollector(ctx, comic.collectorId);
  requirePrivateAccess(ctx, owner);
  return { comic, owner };
}

// The collector profile the authenticated caller owns, if any — the
// founder profile for the space owner, or the joined profile bound to
// their Muse identity. Marketplace buying is tied to this: you buy as
// your own profile, never as one you merely claim.
async function loadOwnCollector(ctx: Ctx): Promise<CollectorRow | null> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.collectors);
  return rows.find((r) => canAccessPrivate(ctx, r)) ?? null;
}

// A for-sale listing needs a real asking price; any other status clears it
// so a stale price never lingers on a book that isn't listed.
function listingPriceFor(status: string, askingPriceCents: number | null): number | null {
  if (status !== "for_sale") return null;
  if (askingPriceCents === null || askingPriceCents <= 0) {
    throw new Error("Set an asking price to list this book for sale.");
  }
  return askingPriceCents;
}

function collectorOut(ctx: Ctx, row: CollectorRow, comics: ComicRow[]): z.infer<typeof collectorShape> {
  const mine = comics.filter((c) => c.collectorId === row.id);
  const valuesPublic = row.showValuesPublicly === 1;
  return {
    id: row.id,
    displayName: row.displayName,
    handle: row.handle,
    city: row.city,
    bio: row.bio,
    avatarColor: row.avatarColor,
    isFounder: row.isFounder === 1,
    isMine: canAccessPrivate(ctx, row),
    showValuesPublicly: valuesPublic,
    totalValueCents: valuesPublic ? mine.reduce((sum, c) => sum + c.currentValueCents, 0) : null,
    joinedAt: row.createdAt.toISOString(),
    comicCount: mine.length,
    signedCount: mine.filter((c) => c.isSigned === 1).length,
    forSaleCount: mine.filter((c) => c.status === "for_sale").length,
  };
}

async function publicComicOut(
  ctx: Ctx,
  row: ComicRow,
  collectorById: Map<number, CollectorRow>,
): Promise<z.infer<typeof publicComicShape>> {
  const owner = collectorById.get(row.collectorId);
  return {
    id: row.id,
    collectorId: row.collectorId,
    collectorName: owner?.displayName ?? "Unknown collector",
    collectorHandle: owner?.handle ?? "",
    title: row.title,
    issue: row.issue,
    publisher: row.publisher,
    variant: row.variant,
    grade: row.grade,
    isSigned: row.isSigned === 1,
    status: row.status,
    coverColor: row.coverColor,
    coverUrl: row.coverBlobKey ? await ctx.blobs.getUrl(row.coverBlobKey) : null,
    // The value rides along only when this book's owner chose to make
    // their values public; everyone else's stays null here.
    currentValueCents: owner?.showValuesPublicly === 1 ? row.currentValueCents : null,
    askingPriceCents: row.status === "for_sale" ? row.askingPriceCents : null,
    addedAt: row.createdAt.toISOString(),
  };
}

async function loadAll(ctx: Ctx) {
  const db = ctx.db<typeof schema>();
  const collectorRows = await db.select().from(schema.collectors).orderBy(asc(schema.collectors.id));
  const comicRows = await db.select().from(schema.comics).orderBy(desc(schema.comics.id));
  const collectorById = new Map(collectorRows.map((c) => [c.id, c]));
  return { db, collectorRows, comicRows, collectorById };
}

const comicFields = {
  title: z.string().trim().min(1, "Give the book a title").max(200),
  issue: z.string().trim().max(40).default(""),
  publisher: z.string().trim().max(80).default(""),
  variant: z.string().trim().max(300).default(""),
  grade: z.string().trim().max(60).default(""),
  isSigned: z.boolean().default(false),
  purchasePriceCents: z.number().int().min(0).max(100_000_000).default(0),
  currentValueCents: z.number().int().min(0).max(100_000_000).default(0),
  askingPriceCents: z.number().int().min(0).max(100_000_000).nullable().default(null),
  status: z.enum(["owned", "for_sale", "sold", "wishlist"]).default("owned"),
  purchaseDate: z.string().trim().max(10).nullable().default(null),
  source: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(2000).default(""),
  coverColor: z.string().trim().max(9).default("#FF2E88"),
};

const okResponse = z.object({ ok: z.literal(true) });

export const Actions = {
  getCommunity: defineAction({
    description:
      "Returns the community overview: every collector profile with book counts, the shared gallery of comics, and community totals. Prices paid and notes are never included; a book's current value (and a collector's total) is included only for collectors who opted in to public values. A for-sale book's asking price is always included — it's a public listing.",
    request: z.object({}),
    response: z.object({
      collectors: z.array(collectorShape),
      gallery: z.array(publicComicShape),
      stats: z.object({
        collectorCount: z.number(),
        comicCount: z.number(),
        signedCount: z.number(),
        forSaleCount: z.number(),
        coverCount: z.number(),
      }),
    }),
    async handler(ctx) {
      const { collectorRows, comicRows, collectorById } = await loadAll(ctx);
      const gallery = await Promise.all(comicRows.map((row) => publicComicOut(ctx, row, collectorById)));
      return {
        collectors: collectorRows.map((row) => collectorOut(ctx, row, comicRows)),
        gallery,
        stats: {
          collectorCount: collectorRows.length,
          comicCount: comicRows.length,
          signedCount: comicRows.filter((c) => c.isSigned === 1).length,
          forSaleCount: comicRows.filter((c) => c.status === "for_sale").length,
          coverCount: gallery.filter((g) => g.coverUrl !== null).length,
        },
      };
    },
  }),

  getCollectorProfile: defineAction({
    description:
      "Returns one collector's public profile and their books for the shared gallery view. Prices paid and notes are never included; current values appear only if that collector opted in to public values.",
    request: z.object({ collectorId: z.number().int().positive() }),
    response: z.object({
      collector: collectorShape,
      comics: z.array(publicComicShape),
    }),
    async handler(ctx, args) {
      const { collectorRows, comicRows, collectorById } = await loadAll(ctx);
      const row = collectorById.get(args.collectorId);
      if (!row) throw new Error("That collector profile doesn't exist anymore.");
      const mine = comicRows.filter((c) => c.collectorId === args.collectorId);
      return {
        collector: collectorOut(ctx, row, comicRows),
        comics: await Promise.all(mine.map((c) => publicComicOut(ctx, c, collectorById))),
      };
    },
  }),

  getShelf: defineAction({
    description:
      "Returns a collector's own private shelf: their profile plus every book with the private fields (price paid, current value, purchase date, source, notes) that only the owner sees.",
    request: z.object({ collectorId: z.number().int().positive() }),
    response: z.object({
      collector: collectorShape,
      comics: z.array(shelfComicShape),
      totals: z.object({
        totalPaidCents: z.number(),
        totalValueCents: z.number(),
      }),
    }),
    async handler(ctx, args) {
      const { comicRows, collectorById } = await loadAll(ctx);
      const row = collectorById.get(args.collectorId);
      if (!row) throw new Error("That collector profile doesn't exist anymore.");
      // The full private record (price paid, source, notes, and the values
      // together) leaves the server only for the profile's owner — verified
      // against ctx.viewer, never against anything the caller claims in
      // the request. (A lone current value can also appear publicly, but
      // only when the owner opted in via setValuesVisibility.)
      requirePrivateAccess(ctx, row);
      const mine = comicRows.filter((c) => c.collectorId === args.collectorId);
      const comics: z.infer<typeof shelfComicShape>[] = [];
      for (const c of mine) {
        const pub = await publicComicOut(ctx, c, collectorById);
        comics.push({
          ...pub,
          purchasePriceCents: c.purchasePriceCents,
          currentValueCents: c.currentValueCents,
          purchaseDate: c.purchaseDate,
          source: c.source,
          notes: c.notes,
        });
      }
      return {
        collector: collectorOut(ctx, row, comicRows),
        comics,
        totals: {
          totalPaidCents: mine.reduce((sum, c) => sum + c.purchasePriceCents, 0),
          totalValueCents: mine.reduce((sum, c) => sum + c.currentValueCents, 0),
        },
      };
    },
  }),

  joinCommunity: defineAction({
    description:
      "Creates a new collector profile so someone can join the community and start their own shelf. Returns the new profile.",
    request: z.object({
      displayName: z.string().trim().min(1, "Add your name or collector name").max(60),
      handle: z.string().trim().max(40).default(""),
      city: z.string().trim().max(60).default(""),
      bio: z.string().trim().max(280).default(""),
    }),
    response: z.object({ collector: collectorShape }),
    async handler(ctx, args): Promise<{ collector: z.infer<typeof collectorShape> }> {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.collectors);
      const taken = new Set(existing.map((c) => c.handle.toLowerCase()));
      let base = (args.handle || args.displayName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
      if (!base) base = "collector";
      let handle = base;
      let n = 2;
      while (taken.has(handle)) {
        handle = `${base}-${n}`;
        n += 1;
      }
      const color = AVATAR_COLORS[existing.length % AVATAR_COLORS.length] ?? "#FF2E88";
      const inserted = await db
        .insert(schema.collectors)
        .values({
          displayName: args.displayName,
          handle,
          city: args.city,
          bio: args.bio,
          avatarColor: color,
          isFounder: 0,
          // Bind the profile to the Muse identity creating it; only that
          // identity can open its private shelf or edit its books.
          ownerKey: viewerKey(ctx),
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("joinCommunity: insert returned no rows");
      ctx.invalidateQueries();
      return { collector: collectorOut(ctx, row, []) };
    },
  }),

  setValuesVisibility: defineAction({
    description:
      "Sets whether a collector's own current values are shown publicly in the gallery and on their profile. Values are private by default; only the profile's owner can change this, for their own shelf.",
    request: z.object({
      collectorId: z.number().int().positive(),
      showValuesPublicly: z.boolean(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const collector = await loadCollector(ctx, args.collectorId);
      requirePrivateAccess(ctx, collector);
      await db
        .update(schema.collectors)
        .set({ showValuesPublicly: args.showValuesPublicly ? 1 : 0 })
        .where(eq(schema.collectors.id, args.collectorId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  updateProfile: defineAction({
    description: "Updates a collector's own profile: display name, city, and bio.",
    request: z.object({
      collectorId: z.number().int().positive(),
      displayName: z.string().trim().min(1, "Your name can't be blank").max(60),
      city: z.string().trim().max(60).default(""),
      bio: z.string().trim().max(280).default(""),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const collector = await loadCollector(ctx, args.collectorId);
      requirePrivateAccess(ctx, collector);
      await db
        .update(schema.collectors)
        .set({ displayName: args.displayName, city: args.city, bio: args.bio })
        .where(eq(schema.collectors.id, args.collectorId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addComic: defineAction({
    description: "Adds a comic to a collector's own shelf and returns the new book's id.",
    request: z.object({ collectorId: z.number().int().positive(), ...comicFields }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const owner = await loadCollector(ctx, args.collectorId);
      requirePrivateAccess(ctx, owner);
      const inserted = await db
        .insert(schema.comics)
        .values({
          collectorId: args.collectorId,
          title: args.title,
          issue: args.issue,
          publisher: args.publisher,
          variant: args.variant,
          grade: args.grade,
          isSigned: args.isSigned ? 1 : 0,
          purchasePriceCents: args.purchasePriceCents,
          currentValueCents: args.currentValueCents,
          askingPriceCents: listingPriceFor(args.status, args.askingPriceCents),
          status: args.status,
          purchaseDate: args.purchaseDate || null,
          source: args.source,
          notes: args.notes,
          coverColor: args.coverColor,
        })
        .returning({ id: schema.comics.id });
      const row = inserted[0];
      if (!row) throw new Error("addComic: insert returned no rows");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  updateComic: defineAction({
    description: "Edits one comic on its owner's shelf, including the private price and value fields.",
    request: z.object({ id: z.number().int().positive(), ...comicFields }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await loadComicOwner(ctx, args.id);
      await db
        .update(schema.comics)
        .set({
          title: args.title,
          issue: args.issue,
          publisher: args.publisher,
          variant: args.variant,
          grade: args.grade,
          isSigned: args.isSigned ? 1 : 0,
          purchasePriceCents: args.purchasePriceCents,
          currentValueCents: args.currentValueCents,
          askingPriceCents: listingPriceFor(args.status, args.askingPriceCents),
          status: args.status,
          purchaseDate: args.purchaseDate || null,
          source: args.source,
          notes: args.notes,
          coverColor: args.coverColor,
          updatedAt: new Date(),
        })
        .where(eq(schema.comics.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteComic: defineAction({
    description: "Removes one comic from its owner's shelf, along with its uploaded cover photo if it has one.",
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const { comic: row } = await loadComicOwner(ctx, args.id);
      if (row.coverBlobKey) {
        await ctx.blobs.delete(row.coverBlobKey);
      }
      await db.delete(schema.comics).where(eq(schema.comics.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setComicCover: defineAction({
    description:
      "Saves a photo of a collector's own copy as that comic's cover image (JPEG or PNG) and returns its URL.",
    request: z.object({
      id: z.number().int().positive(),
      image: z.object({ dataBase64: z.string().min(1), mimeType: z.string() }),
    }),
    response: z.object({ coverUrl: z.string() }),
    async handler(ctx, args) {
      if (args.image.mimeType !== "image/jpeg" && args.image.mimeType !== "image/png") {
        throw new Error("Cover photos must be JPEG or PNG images.");
      }
      const db = ctx.db<typeof schema>();
      await loadComicOwner(ctx, args.id);
      const key = `covers/comic-${args.id}`;
      const bytes = Buffer.from(args.image.dataBase64, "base64");
      await ctx.blobs.put(key, bytes, { contentType: args.image.mimeType });
      await db
        .update(schema.comics)
        .set({ coverBlobKey: key, updatedAt: new Date() })
        .where(eq(schema.comics.id, args.id));
      ctx.invalidateQueries();
      return { coverUrl: await ctx.blobs.getUrl(key) };
    },
  }),

  removeComicCover: defineAction({
    description: "Removes the uploaded cover photo from a comic, leaving its styled tile or verified cover art.",
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const { comic: row } = await loadComicOwner(ctx, args.id);
      if (row.coverBlobKey) {
        await ctx.blobs.delete(row.coverBlobKey);
        await db
          .update(schema.comics)
          .set({ coverBlobKey: null, updatedAt: new Date() })
          .where(eq(schema.comics.id, args.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  buyComic: defineAction({
    description:
      "Buys a comic listed for sale in the marketplace: creates an order at the listing's asking price for the caller's own collector profile and marks the book sold. The buyer and seller then arrange payment and handoff between themselves — no payment is taken in the app. A collector cannot buy their own book.",
    request: z.object({ comicId: z.number().int().positive() }),
    response: z.object({ orderId: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.comics).where(eq(schema.comics.id, args.comicId)).limit(1);
      const comic = rows[0];
      if (!comic) throw new Error("That comic doesn't exist anymore.");
      if (comic.status !== "for_sale" || comic.askingPriceCents === null) {
        throw new Error("That book isn't listed for sale anymore.");
      }
      const buyer = await loadOwnCollector(ctx);
      if (!buyer) {
        throw new Error("Join the community first — you need your own collector profile to buy.");
      }
      if (buyer.id === comic.collectorId) {
        throw new Error("That's your own book — you can't buy it from yourself.");
      }
      const inserted = await db
        .insert(schema.orders)
        .values({
          comicId: comic.id,
          sellerId: comic.collectorId,
          buyerId: buyer.id,
          priceCents: comic.askingPriceCents,
          status: "placed",
        })
        .returning({ id: schema.orders.id });
      const order = inserted[0];
      if (!order) throw new Error("buyComic: insert returned no rows");
      await db
        .update(schema.comics)
        .set({ status: "sold", askingPriceCents: null, updatedAt: new Date() })
        .where(eq(schema.comics.id, comic.id));
      ctx.invalidateQueries();
      return { orderId: order.id };
    },
  }),

  getOrders: defineAction({
    description:
      "Returns the caller's marketplace orders: their purchases (as buyer) and their sales (as seller), newest first, with the book, the other party, the price, and the order status. Empty when the caller has no collector profile of their own.",
    request: z.object({}),
    response: z.object({
      myCollectorId: z.number().nullable(),
      purchases: z.array(
        z.object({
          id: z.number(),
          comicId: z.number(),
          comicTitle: z.string(),
          comicIssue: z.string(),
          sellerId: z.number(),
          sellerName: z.string(),
          buyerId: z.number(),
          buyerName: z.string(),
          priceCents: z.number(),
          status: z.enum(["placed", "completed"]),
          createdAt: z.string(),
          completedAt: z.string().nullable(),
        }),
      ),
      sales: z.array(
        z.object({
          id: z.number(),
          comicId: z.number(),
          comicTitle: z.string(),
          comicIssue: z.string(),
          sellerId: z.number(),
          sellerName: z.string(),
          buyerId: z.number(),
          buyerName: z.string(),
          priceCents: z.number(),
          status: z.enum(["placed", "completed"]),
          createdAt: z.string(),
          completedAt: z.string().nullable(),
        }),
      ),
    }),
    async handler(ctx) {
      const me = await loadOwnCollector(ctx);
      if (!me) return { myCollectorId: null, purchases: [], sales: [] };
      const db = ctx.db<typeof schema>();
      const orderRows = await db.select().from(schema.orders).orderBy(desc(schema.orders.id));
      const collectorRows = await db.select().from(schema.collectors);
      const comicRows = await db.select().from(schema.comics);
      const collectorById = new Map(collectorRows.map((c) => [c.id, c]));
      const comicById = new Map(comicRows.map((c) => [c.id, c]));
      const shape = (o: typeof schema.orders.$inferSelect) => {
        const comic = comicById.get(o.comicId);
        return {
          id: o.id,
          comicId: o.comicId,
          comicTitle: comic?.title ?? "A book that's no longer on a shelf",
          comicIssue: comic?.issue ?? "",
          sellerId: o.sellerId,
          sellerName: collectorById.get(o.sellerId)?.displayName ?? "Unknown collector",
          buyerId: o.buyerId,
          buyerName: collectorById.get(o.buyerId)?.displayName ?? "Unknown collector",
          priceCents: o.priceCents,
          status: o.status,
          createdAt: o.createdAt.toISOString(),
          completedAt: o.completedAt ? o.completedAt.toISOString() : null,
        };
      };
      return {
        myCollectorId: me.id,
        purchases: orderRows.filter((o) => o.buyerId === me.id).map(shape),
        sales: orderRows.filter((o) => o.sellerId === me.id).map(shape),
      };
    },
  }),

  markOrderComplete: defineAction({
    description:
      "Marks one of the caller's sales as completed once payment and handoff are done. Only the order's seller can do this.",
    request: z.object({ orderId: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.orders).where(eq(schema.orders.id, args.orderId)).limit(1);
      const order = rows[0];
      if (!order) throw new Error("That order doesn't exist anymore.");
      const me = await loadOwnCollector(ctx);
      if (!me || order.sellerId !== me.id) {
        throw new Error("Only the seller can mark this order complete.");
      }
      if (order.status !== "completed") {
        await db
          .update(schema.orders)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(schema.orders.id, args.orderId));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  importFoundingCollection: defineAction({
    description:
      "One-time import: creates Joshua's founder profile and loads his real comic collection (from his Comic Collection Tracker) as the community's founding shelf. Does nothing if any collector already exists.",
    request: z.object({}),
    response: z.object({
      imported: z.boolean(),
      collectorCount: z.number(),
      comicCount: z.number(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const existingCollectors = await db.select().from(schema.collectors);
      const existingComics = await db.select().from(schema.comics);
      if (existingCollectors.length > 0) {
        return {
          imported: false,
          collectorCount: existingCollectors.length,
          comicCount: existingComics.length,
        };
      }
      const founder = await db
        .insert(schema.collectors)
        .values({
          displayName: "Joshua",
          handle: "joshua",
          city: "Miami, FL",
          bio: "Founder of Magic City Culture. Variant covers, signed books, and Miami heat.",
          avatarColor: "#FF2E88",
          isFounder: 1,
        })
        .returning({ id: schema.collectors.id });
      const founderRow = founder[0];
      if (!founderRow) throw new Error("importFoundingCollection: founder insert returned no rows");
      const statements: BatchItem<"sqlite">[] = COLLECTION_IMPORT.map((c) =>
        db.insert(schema.comics).values({
          collectorId: founderRow.id,
          title: c.title,
          issue: c.issue,
          publisher: c.publisher,
          variant: c.variant,
          grade: c.grade,
          isSigned: c.isSigned ? 1 : 0,
          purchasePriceCents: c.purchasePriceCents,
          currentValueCents: c.currentValueCents,
          status: "owned",
          purchaseDate: c.purchaseDate,
          source: c.source,
          notes: c.notes,
          coverColor: c.coverColor,
        }),
      );
      // Batch in chunks so one call never carries the whole shelf at once.
      for (let i = 0; i < statements.length; i += 40) {
        const chunk = statements.slice(i, i + 40);
        const [first, ...rest] = chunk;
        if (first) await db.batch([first, ...rest]);
      }
      ctx.invalidateQueries();
      return { imported: true, collectorCount: 1, comicCount: COLLECTION_IMPORT.length };
    },
  }),
} satisfies ActionsModule;
