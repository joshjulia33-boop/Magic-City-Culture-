import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim, fileToBase64 } from "@hatch/space-sdk/client";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api, type ApiResponse } from "./api";
import logo from "./assets/logo.webp";
import coverColdDeadHands from "./assets/cover-cold-dead-hands-1.jpg";
import coverTmntRaphael from "./assets/cover-tmnt-300-raphael.jpg";
import coverNifeWars1ThreeD from "./assets/cover-nife-wars-1-3d.jpg";
import coverNifeWars1Foil from "./assets/cover-nife-wars-1-foil.jpg";
import coverNifeWars2Foil from "./assets/cover-nife-wars-2-foil.jpg";
import coverChainkataLiefeldBw from "./assets/cover-chainkata-1-liefeld-bw.jpg";
import coverNifeWars3Metal from "./assets/cover-nife-wars-3-metal.jpg";
import coverXMenUnited2Momoko from "./assets/cover-xmen-united-2-momoko.jpg";
import coverFrankensteinBw from "./assets/cover-frankenstein-bw-zavala.jpg";
import coverSecretWars8 from "./assets/cover-secret-wars-8-suayan.jpg";
import coverDarkseid1 from "./assets/cover-darkseid-vs-world-1-giang.jpg";
import coverWolverine4 from "./assets/cover-wolverine-4-grassetti.jpg";
import coverMarvelVsDc1 from "./assets/cover-marvel-vs-dc-1.jpg";
import coverWalkingDead1 from "./assets/cover-walking-dead-1.jpg";
import coverAbsoluteBatman6 from "./assets/cover-absolute-batman-6-mann-foil.jpg";
import coverGrifterBadrock1 from "./assets/cover-grifter-badrock-1-yaep.jpg";
import coverXMenUnited4Ross from "./assets/cover-xmen-united-4-ross.jpg";
import coverQueenInBlack4 from "./assets/cover-queen-in-black-4-stegman.jpg";
import coverAbsoluteBatman24Lacchei from "./assets/cover-absolute-batman-24-lacchei.jpg";
import coverAbsoluteBatman24Mora from "./assets/cover-absolute-batman-24-mora.jpg";
import coverAbsoluteBatman24CvrB from "./assets/cover-absolute-batman-24-cvr-b.jpg";
import coverSuperman501Foil from "./assets/cover-adventures-superman-501-foil.jpg";
import coverBatman14JimLee from "./assets/cover-batman-14-jim-lee.jpg";
import coverVenomSuayanSketch from "./assets/cover-venom-lethal-protector-1-suayan-sketch.jpg";
import coverAvengelyneBw from "./assets/cover-avengelyne-1-benitez-bw.jpg";
import coverNectar1Kirkham from "./assets/cover-nectar-1-kirkham.jpg";
import coverWalkingDead192Red from "./assets/cover-walking-dead-192-red.jpg";
import coverWalkingDead193 from "./assets/cover-walking-dead-193.jpg";
import coverThundercats1Barends from "./assets/cover-thundercats-1-barends.jpg";
import coverLookOut1 from "./assets/cover-look-out-1-bradstreet.jpg";

const FIELDS = actionFields<typeof Actions>();

type Community = ApiResponse<typeof api, "getCommunity">;
type Collector = Community["collectors"][number];
type PublicComic = Community["gallery"][number];
type ShelfData = ApiResponse<typeof api, "getShelf">;
type ShelfComic = ShelfData["comics"][number];

type View =
  | { kind: "gallery" }
  | { kind: "market" }
  | { kind: "collectors" }
  | { kind: "profile"; collectorId: number }
  | { kind: "shelf" };

const COVER_COLORS = ["#FF2E88", "#00D4FF", "#B537F2", "#FF6EC7", "#0090FF", "#12102E", "#FF8A00", "#00E5A0", "#FF2E5F", "#00BFFF"];
const PUBLISHERS = ["Marvel", "DC Comics", "Image Comics", "Dark Horse", "IDW", "Dynamite", "AWA", "BOOM! Studios", "Other"];
const GRADES = ["", "Raw — Near Mint", "Raw — Very Fine", "Raw — Fine", "Raw", "CGC 10.0", "CGC 9.9", "CGC 9.8", "CGC 9.6", "CGC 9.4", "CGC 9.2", "CGC 9.0", "CBCS 9.8", "CBCS 9.6", "PGX 9.8"];

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
function dollarsToCents(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}
function centsToDollars(cents: number): string {
  return cents ? String(cents / 100) : "";
}
function prettyDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function joinedLabel(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function orderDateLabel(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function isGraded(grade: string) {
  return /CGC|CBCS|PGX/.test(grade);
}

// Verified cover art for the editions whose exact cover is confirmed — the
// same verified set as Joshua's Comic Collection Tracker and his Magic City
// Culture app (31 books). Matching is by title + issue + variant. Books
// without a verified cover for their exact edition (live-auction lots and
// blind bags whose listings never named the book) keep the styled tile —
// never a cover that might not match the copy on the shelf. The remarqued
// Black Queen Darkseid #1 is John Giang's exclusive variant with a
// hand-drawn remarque on that same cover, so it shares the Giang art;
// Joshua's Walking Dead #192 is the red commemorative edition he confirmed,
// not Cover A.
function verifiedCoverFor(c: { title: string; issue: string; variant: string }): string | undefined {
  const t = c.title.toLowerCase();
  const v = c.variant.toLowerCase();
  const i = c.issue.replace(/\s/g, "").toLowerCase();
  if (t.includes("cold dead hands")) return coverColdDeadHands;
  if (t.includes("tmnt") || t.includes("teenage mutant")) return coverTmntRaphael;
  if (t.includes("chainkata")) return coverChainkataLiefeldBw;
  if (t.includes("nife wars")) {
    if (i === "#3" && v.includes("metal")) return coverNifeWars3Metal;
    if (i === "#1" && v.includes("3d")) return coverNifeWars1ThreeD;
    if (i === "#1" && v.includes("foil")) return coverNifeWars1Foil;
    if (i === "#2" && v.includes("foil")) return coverNifeWars2Foil;
    return undefined;
  }
  if (t.includes("x-men united")) {
    if (i === "#2") return coverXMenUnited2Momoko;
    if (i === "#4") return coverXMenUnited4Ross;
    return undefined;
  }
  if (t.includes("frankenstein")) return coverFrankensteinBw;
  if (t.includes("secret wars") && i === "#8") return coverSecretWars8;
  if (t.includes("darkseid")) return v.includes("giang") ? coverDarkseid1 : undefined;
  if (t.includes("wolverine") && i === "#4") return coverWolverine4;
  if (t.includes("marvel vs dc")) return coverMarvelVsDc1;
  if (t.includes("walking dead")) {
    if (i === "#1") return coverWalkingDead1;
    if (i === "#192") return coverWalkingDead192Red;
    if (i === "#193") return coverWalkingDead193;
    return undefined;
  }
  if (t.includes("absolute batman")) {
    if (i === "#6") return coverAbsoluteBatman6;
    if (i === "#24") {
      if (v.includes("lacchei")) return coverAbsoluteBatman24Lacchei;
      if (v.includes("mora")) return coverAbsoluteBatman24Mora;
      if (v.includes("cover b")) return coverAbsoluteBatman24CvrB;
    }
    return undefined;
  }
  if (t.includes("grifter")) return coverGrifterBadrock1;
  if (t.includes("queen in black") && i === "#4") return coverQueenInBlack4;
  if (t.includes("adventures of superman") && i === "#501") return coverSuperman501Foil;
  if (t === "batman" && i === "#14") return coverBatman14JimLee;
  if (t.includes("venom")) return coverVenomSuayanSketch;
  if (t.includes("avengelyne")) return coverAvengelyneBw;
  if (t.includes("nectar")) return coverNectar1Kirkham;
  if (t.includes("thundercats")) return coverThundercats1Barends;
  if (t.includes("look out")) return coverLookOut1;
  return undefined;
}

function coverSrc(c: PublicComic): string | undefined {
  return c.coverUrl ?? verifiedCoverFor(c);
}
function hasCover(c: PublicComic) {
  return coverSrc(c) !== undefined;
}

function Badges({ comic }: { comic: PublicComic }) {
  return (
    <>
      {comic.grade && (
        <span className="bg-[#00D4FF] text-black text-[10px] font-extrabold px-1.5 py-0.5 border border-black">{comic.grade}</span>
      )}
      {comic.isSigned && (
        <span className="bg-white text-black text-[10px] font-extrabold px-1.5 py-0.5 border border-black">✦ SIGNED</span>
      )}
      {comic.status === "for_sale" && (
        <span className="bg-[#FF2E88] text-white text-[10px] font-extrabold px-1.5 py-0.5 border border-black">FOR SALE</span>
      )}
      {comic.status === "wishlist" && (
        <span className="bg-[#FF8A00] text-black text-[10px] font-extrabold px-1.5 py-0.5 border border-black">WISHLIST</span>
      )}
    </>
  );
}

function CoverArt({ comic, large }: { comic: PublicComic; large?: boolean }) {
  const src = coverSrc(comic);
  if (src) {
    return (
      <div className="relative overflow-hidden bg-[#0d0b24]" style={{ aspectRatio: "2/3" }}>
        <img
          src={src}
          alt={`Cover of ${comic.title} ${comic.issue}${comic.variant ? ` — ${comic.variant}` : ""}`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent pt-8 pb-2 px-2 flex flex-wrap gap-1">
          <Badges comic={comic} />
        </div>
      </div>
    );
  }
  const initials = comic.title.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="relative overflow-hidden flex flex-col justify-between p-3 text-white" style={{ background: comic.coverColor, aspectRatio: "2/3" }}>
      <div className="halftone absolute inset-0 opacity-40" />
      <div className="relative">
        <div className="flex justify-between items-start gap-1">
          {comic.publisher ? (
            <span className="bg-white text-black text-[10px] font-black px-1.5 py-0.5 uppercase tracking-wider">{comic.publisher}</span>
          ) : (
            <span />
          )}
          {comic.issue && <span className="bg-black text-white text-[10px] font-black px-1.5 py-0.5">{comic.issue}</span>}
        </div>
        <p className={`font-display leading-[0.95] mt-3 ${large ? "text-3xl" : "text-[22px]"}`}>{comic.title}</p>
        {comic.variant && <p className="text-[11px] font-semibold mt-1.5 leading-tight opacity-95 line-clamp-3">{comic.variant}</p>}
      </div>
      <div className="relative">
        <p className="font-display text-4xl opacity-20 absolute -bottom-1 right-0">{initials}</p>
        <div className="flex flex-wrap gap-1 relative">
          <Badges comic={comic} />
        </div>
      </div>
    </div>
  );
}

function Avatar({ collector, size = "md" }: { collector: Collector; size?: "md" | "lg" }) {
  const initial = (collector.displayName.trim()[0] ?? "?").toUpperCase();
  const cls = size === "lg" ? "w-16 h-16 text-3xl" : "w-11 h-11 text-xl";
  return (
    <span
      aria-hidden="true"
      className={`${cls} shrink-0 rounded-full flex items-center justify-center font-display text-white border-2 border-black/60`}
      style={{ background: collector.avatarColor }}
    >
      {initial}
    </span>
  );
}

type ComicFormState = {
  title: string; issue: string; publisher: string; variant: string; grade: string; isSigned: boolean;
  purchasePrice: string; currentValue: string; askingPrice: string; status: "owned" | "for_sale" | "sold" | "wishlist";
  purchaseDate: string; source: string; notes: string; coverColor: string;
};
const emptyComicForm: ComicFormState = {
  title: "", issue: "", publisher: "Marvel", variant: "", grade: "", isSigned: false,
  purchasePrice: "", currentValue: "", askingPrice: "", status: "owned", purchaseDate: "", source: "", notes: "", coverColor: "#FF2E88",
};
function shelfComicToForm(c: ShelfComic): ComicFormState {
  return {
    title: c.title, issue: c.issue, publisher: c.publisher || "Marvel", variant: c.variant, grade: c.grade,
    isSigned: c.isSigned, purchasePrice: centsToDollars(c.purchasePriceCents), currentValue: centsToDollars(c.currentValueCents),
    askingPrice: centsToDollars(c.askingPriceCents ?? 0),
    status: c.status, purchaseDate: c.purchaseDate ?? "", source: c.source, notes: c.notes, coverColor: c.coverColor,
  };
}

const inputCls =
  "w-full rounded-lg bg-[#12102e] border border-[#3a3373] px-3 py-2 text-[15px] text-[#f5f2ff] placeholder:text-[#6f6aa3] focus:outline-none focus:border-[#ff2e88]";
const labelCls = "block text-xs font-bold uppercase tracking-wider text-[#a7a3cc] mb-1";

export function App() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>({ kind: "gallery" });
  const [activeId, setActiveId] = useState<number | null>(() => {
    const raw = window.localStorage.getItem("mcc-active-collector");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "signed" | "graded" | "for_sale" | "covers">("all");
  const [detail, setDetail] = useState<PublicComic | null>(null);
  const [shelfDetail, setShelfDetail] = useState<ShelfComic | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  const [showComicForm, setShowComicForm] = useState(false);
  const [editingComic, setEditingComic] = useState<ShelfComic | null>(null);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [notice, setNotice] = useState("");

  const communityQ = useQuery({ queryKey: ["community"], queryFn: () => api.getCommunity({}) });
  const community = communityQ.data;
  const collectors = useMemo(() => community?.collectors ?? [], [community]);
  const gallery = useMemo(() => community?.gallery ?? [], [community]);

  // Default the active profile to the viewer's own (the server marks it
  // isMine from the signed-in identity — the founder profile for Joshua)
  // until the viewer picks or creates their own.
  useEffect(() => {
    if (collectors.length === 0) return;
    const mine = collectors.find((c) => c.isMine);
    if (mine && activeId !== mine.id) {
      setActiveId(mine.id);
      window.localStorage.setItem("mcc-active-collector", String(mine.id));
    } else if (activeId === null) {
      const founder = collectors.find((c) => c.isFounder) ?? collectors[0];
      if (founder) {
        setActiveId(founder.id);
        window.localStorage.setItem("mcc-active-collector", String(founder.id));
      }
    }
  }, [activeId, collectors]);

  const activeCollector = collectors.find((c) => c.id === activeId) ?? null;
  const myCollector = collectors.find((c) => c.isMine) ?? null;
  const forSaleBooks = useMemo(() => gallery.filter((c) => c.status === "for_sale"), [gallery]);

  const profileQ = useQuery({
    queryKey: ["profile", view.kind === "profile" ? view.collectorId : 0],
    queryFn: () => api.getCollectorProfile({ collectorId: view.kind === "profile" ? view.collectorId : 0 }),
    enabled: view.kind === "profile",
  });
  const shelfQ = useQuery({
    queryKey: ["shelf", activeId ?? 0],
    queryFn: () => api.getShelf({ collectorId: activeId ?? 0 }),
    enabled: view.kind === "shelf" && activeId !== null,
  });
  const ordersQ = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.getOrders({}),
    enabled: view.kind === "market",
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["community"] });
    void qc.invalidateQueries({ queryKey: ["profile"] });
    void qc.invalidateQueries({ queryKey: ["shelf"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
  };
  const errOut = (e: unknown) => setNotice(e instanceof Error ? e.message : "Something went wrong — try again.");

  const valuesVisibilityMut = useMutation({
    mutationFn: async (args: { collectorId: number; showValuesPublicly: boolean }) =>
      await api.setValuesVisibility(args),
    onSuccess: invalidate,
    onError: errOut,
  });

  const buyMut = useMutation({
    mutationFn: async (comicId: number) => await api.buyComic({ comicId }),
    onSuccess: () => {
      invalidate();
      setDetail(null);
      setNotice("Order placed — the book is marked sold. You and the seller arrange payment and handoff between yourselves; the order is tracked in the Market tab.");
      setView({ kind: "market" });
    },
    onError: errOut,
  });

  const completeOrderMut = useMutation({
    mutationFn: async (orderId: number) => await api.markOrderComplete({ orderId }),
    onSuccess: invalidate,
    onError: errOut,
  });

  const pickActive = (id: number) => {
    setActiveId(id);
    window.localStorage.setItem("mcc-active-collector", String(id));
  };

  const filteredGallery = useMemo(() => {
    const q = search.trim().toLowerCase();
    return gallery.filter((c) => {
      if (filter === "signed" && !c.isSigned) return false;
      if (filter === "graded" && !isGraded(c.grade)) return false;
      if (filter === "for_sale" && c.status !== "for_sale") return false;
      if (filter === "covers" && !hasCover(c)) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.variant.toLowerCase().includes(q) ||
        c.publisher.toLowerCase().includes(q) ||
        c.collectorName.toLowerCase().includes(q)
      );
    });
  }, [gallery, search, filter]);

  const withCovers = gallery.filter(hasCover).length;

  const navBtn = (kind: View["kind"], label: string) => (
    <button
      type="button"
      onClick={() => setView({ kind } as View)}
      aria-pressed={view.kind === kind}
      className={`flex-1 rounded-full px-3 py-2.5 font-display text-[13px] tracking-wide border-2 transition-colors ${
        view.kind === kind
          ? "bg-[#ff2e88] text-white border-black shadow-[0_0_16px_rgba(255,46,136,0.5)]"
          : "bg-[#1e1a45] text-[#a7a3cc] border-[#3a3373]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <SafeAreaTopScrim />
      <header className="sticky top-0 z-30 border-b border-[#3a3373] bg-[#12102e]/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-2.5 flex items-center gap-3">
          <img src={logo} alt="Magic City Culture logo — neon sunset, palm trees and the Miami skyline" className="w-10 h-10 rounded-full object-cover border border-[#ff2e88]" />
          <div className="leading-none">
            <p className="font-display text-[15px] tracking-wide neon-text">MAGIC CITY CULTURE</p>
            <p className="text-[11px] font-bold tracking-[0.25em] text-[#00d4ff] mt-1">COMMUNITY</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {activeCollector && activeCollector.isMine && (
              <button
                type="button"
                onClick={() => setView({ kind: "shelf" })}
                className="flex items-center gap-2 rounded-full bg-[#1e1a45] border border-[#3a3373] pl-1 pr-3 py-1"
                aria-label={`Your shelf — signed in as ${activeCollector.displayName}`}
              >
                <Avatar collector={activeCollector} />
                <span className="text-sm font-bold max-w-[7rem] truncate">{activeCollector.displayName}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowJoin(true)}
              className="rounded-full bg-[#00d4ff] text-black font-display text-[12px] px-3.5 py-2.5 border-2 border-black"
            >
              JOIN
            </button>
          </div>
        </div>
        <nav className="mx-auto max-w-6xl px-4 pb-3 flex gap-2" aria-label="Community sections">
          {navBtn("gallery", "GALLERY")}
          {navBtn("market", "MARKET")}
          {navBtn("collectors", "COLLECTORS")}
          {navBtn("shelf", "MY SHELF")}
        </nav>
      </header>

      {notice && (
        <div role="alert" className="mx-auto max-w-6xl px-4 mt-3">
          <div className="flex items-start gap-3 rounded-lg border border-[#ff2e88] bg-[#2a1440] px-4 py-3">
            <p className="text-sm flex-1">{notice}</p>
            <button type="button" onClick={() => setNotice("")} aria-label="Dismiss message" className="font-display text-sm px-2">
              ✕
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 pb-24">
        {communityQ.isLoading && <p className="py-16 text-center text-[#a7a3cc] font-semibold">Loading the community shelves…</p>}
        {communityQ.isError && (
          <div className="py-16 text-center">
            <p className="font-semibold mb-3">The community didn't load.</p>
            <button type="button" onClick={() => void communityQ.refetch()} className="rounded-full bg-[#ff2e88] text-white font-display text-sm px-5 py-2.5 border-2 border-black">
              TRY AGAIN
            </button>
          </div>
        )}

        {community && view.kind === "gallery" && (
          <>
            <section className="pt-6 pb-2 flex flex-col items-center text-center">
              <img
                src={logo}
                alt="Magic City Culture logo — two palm trees framing a neon sunset over the Miami skyline, a superhero flying across the sun, and an open comic book"
                className="w-44 h-44 sm:w-56 sm:h-56 rounded-full object-cover border-4 border-[#ff2e88] shadow-[0_0_45px_rgba(255,46,136,0.45)]"
              />
              <h1 className="font-display text-3xl sm:text-5xl mt-5 leading-[1.02] neon-text">
                EVERY COLLECTOR.
                <br />
                <span className="text-[#00d4ff]">ONE CITY.</span>
              </h1>
              <p className="mt-3 max-w-xl text-[15px] text-[#c9c5ef]">
                A shared gallery for comic collectors — browse every shelf in the community, then join and put your own books up next to them.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2 text-[13px] font-bold">
                <span className="rounded-full bg-[#1e1a45] border border-[#3a3373] px-3 py-1.5">{community.stats.collectorCount} collectors</span>
                <span className="rounded-full bg-[#1e1a45] border border-[#3a3373] px-3 py-1.5">{community.stats.comicCount} books shelved</span>
                <span className="rounded-full bg-[#1e1a45] border border-[#3a3373] px-3 py-1.5">{community.stats.signedCount} signed</span>
                <span className="rounded-full bg-[#1e1a45] border border-[#3a3373] px-3 py-1.5">{withCovers} with cover art</span>
                <span className="rounded-full bg-[#1e1a45] border border-[#3a3373] px-3 py-1.5">{community.stats.forSaleCount} for sale</span>
              </div>
            </section>

            <section className="mt-6">
              <div className="flex flex-col sm:flex-row gap-2">
                <label className="sr-only" htmlFor="gallery-search">Search the gallery</label>
                <input
                  id="gallery-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search titles, variants, collectors…"
                  className={`${inputCls} sm:flex-1`}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter the gallery">
                {(
                  [
                    ["all", `All books (${gallery.length})`],
                    ["covers", `With cover art (${withCovers})`],
                    ["signed", "Signed"],
                    ["graded", "Graded"],
                    ["for_sale", "For sale"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={`rounded-full px-3.5 py-2 text-[13px] font-bold border ${
                      filter === key ? "bg-[#ff2e88] text-white border-black" : "bg-[#1e1a45] text-[#c9c5ef] border-[#3a3373]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {filteredGallery.length === 0 ? (
                <p className="py-14 text-center text-[#a7a3cc] font-semibold">
                  {gallery.length === 0
                    ? "No books on the shelves yet — join and be the first to add one."
                    : "No books match that search. Try a different title or clear the filters."}
                </p>
              ) : (
                <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {filteredGallery.map((comic) => (
                    <article key={comic.id} className="rounded-xl overflow-hidden border-2 border-black bg-[#1e1a45] shadow-[0_6px_0_rgba(0,0,0,0.45)]">
                      <button type="button" onClick={() => setDetail(comic)} className="block w-full text-left" aria-label={`View ${comic.title} ${comic.issue} from ${comic.collectorName}'s shelf`}>
                        <CoverArt comic={comic} />
                      </button>
                      <div className="p-2.5">
                        <p className="font-bold text-sm leading-tight line-clamp-2">
                          {comic.title} {comic.issue}
                        </p>
                        <button
                          type="button"
                          onClick={() => setView({ kind: "profile", collectorId: comic.collectorId })}
                          className="mt-1 text-[12px] font-bold text-[#00d4ff] underline decoration-dotted underline-offset-2"
                        >
                          {comic.collectorName}
                        </button>
                        {comic.currentValueCents !== null && (
                          <p className="mt-0.5 text-[12px] font-bold text-[#00d4ff]">Worth {money(comic.currentValueCents)}</p>
                        )}
                        {comic.status === "for_sale" && comic.askingPriceCents !== null && (
                          <p className="mt-0.5 text-[13px] font-black text-[#ff2e88]">FOR SALE — {money(comic.askingPriceCents)}</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {community && view.kind === "market" && (
          <section className="pt-6">
            <h2 className="font-display text-2xl sm:text-3xl neon-text">THE MARKET</h2>
            <p className="mt-2 text-[15px] text-[#c9c5ef] max-w-xl">
              Books members have listed for sale, at the seller's asking price. Buying places the order here and marks the book sold — you and the seller arrange payment and handoff between yourselves.
            </p>

            {forSaleBooks.length === 0 ? (
              <p className="py-12 text-center text-[#a7a3cc] font-semibold">
                Nothing listed right now. Put one of your own books up from your shelf — set its status to For sale and name your price.
              </p>
            ) : (
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {forSaleBooks.map((comic) => {
                  const own = comic.collectorId === myCollector?.id;
                  return (
                    <article key={comic.id} className="rounded-xl overflow-hidden border-2 border-black bg-[#1e1a45] shadow-[0_6px_0_rgba(0,0,0,0.45)]">
                      <button type="button" onClick={() => setDetail(comic)} className="block w-full text-left" aria-label={`View ${comic.title} ${comic.issue} for sale by ${comic.collectorName}`}>
                        <CoverArt comic={comic} />
                      </button>
                      <div className="p-2.5">
                        <p className="font-bold text-sm leading-tight line-clamp-2">
                          {comic.title} {comic.issue}
                        </p>
                        <button
                          type="button"
                          onClick={() => setView({ kind: "profile", collectorId: comic.collectorId })}
                          className="mt-1 text-[12px] font-bold text-[#00d4ff] underline decoration-dotted underline-offset-2"
                        >
                          {comic.collectorName}
                        </button>
                        {comic.askingPriceCents !== null && (
                          <p className="mt-1 font-display text-lg text-[#ff2e88]">{money(comic.askingPriceCents)}</p>
                        )}
                        {own ? (
                          <p className="mt-2 text-center rounded-full bg-[#12102e] border border-[#3a3373] text-[#a7a3cc] font-display text-[11px] px-3 py-2">YOUR LISTING</p>
                        ) : myCollector ? (
                          <button
                            type="button"
                            disabled={buyMut.isPending}
                            onClick={() => buyMut.mutate(comic.id)}
                            className="mt-2 w-full rounded-full bg-[#ff2e88] text-white font-display text-[12px] px-3 py-2.5 border-2 border-black disabled:opacity-50"
                            aria-label={`Buy ${comic.title} ${comic.issue} for ${comic.askingPriceCents !== null ? money(comic.askingPriceCents) : ""}`}
                          >
                            {buyMut.isPending ? "PLACING ORDER…" : "BUY IT"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowJoin(true)}
                            className="mt-2 w-full rounded-full bg-[#00d4ff] text-black font-display text-[12px] px-3 py-2.5 border-2 border-black"
                          >
                            JOIN TO BUY
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="font-display text-xl">MY PURCHASES</h3>
                {ordersQ.isLoading ? (
                  <p className="mt-3 text-[#a7a3cc] font-semibold">Loading your orders…</p>
                ) : !ordersQ.data || ordersQ.data.myCollectorId === null ? (
                  <p className="mt-3 text-sm text-[#a7a3cc]">Join the community and your purchases will show up here.</p>
                ) : ordersQ.data.purchases.length === 0 ? (
                  <p className="mt-3 text-sm text-[#a7a3cc]">You haven't bought anything yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {ordersQ.data.purchases.map((order) => (
                      <li key={order.id} className="rounded-xl border-2 border-black bg-[#1e1a45] p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold leading-tight">
                              {order.comicTitle} {order.comicIssue}
                            </p>
                            <p className="mt-0.5 text-[13px] text-[#a7a3cc] font-semibold">
                              From {order.sellerName} • {orderDateLabel(order.createdAt)}
                            </p>
                          </div>
                          <p className="font-display text-[#00d4ff]">{money(order.priceCents)}</p>
                        </div>
                        <span className={`mt-2 inline-block text-[11px] font-extrabold px-2 py-1 border border-black ${order.status === "completed" ? "bg-[#00e5a0] text-black" : "bg-[#ff8a00] text-black"}`}>
                          {order.status === "completed" ? "COMPLETED" : "ORDER PLACED — ARRANGE PAYMENT & HANDOFF"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="font-display text-xl">MY SALES</h3>
                {ordersQ.isLoading ? (
                  <p className="mt-3 text-[#a7a3cc] font-semibold">Loading your orders…</p>
                ) : !ordersQ.data || ordersQ.data.myCollectorId === null ? (
                  <p className="mt-3 text-sm text-[#a7a3cc]">Join the community and your sales will show up here.</p>
                ) : ordersQ.data.sales.length === 0 ? (
                  <p className="mt-3 text-sm text-[#a7a3cc]">No sales yet — list a book for sale and it'll show up here when it sells.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {ordersQ.data.sales.map((order) => (
                      <li key={order.id} className="rounded-xl border-2 border-black bg-[#1e1a45] p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold leading-tight">
                              {order.comicTitle} {order.comicIssue}
                            </p>
                            <p className="mt-0.5 text-[13px] text-[#a7a3cc] font-semibold">
                              To {order.buyerName} • {orderDateLabel(order.createdAt)}
                            </p>
                          </div>
                          <p className="font-display text-[#00d4ff]">{money(order.priceCents)}</p>
                        </div>
                        {order.status === "completed" ? (
                          <span className="mt-2 inline-block bg-[#00e5a0] text-black text-[11px] font-extrabold px-2 py-1 border border-black">COMPLETED</span>
                        ) : (
                          <button
                            type="button"
                            disabled={completeOrderMut.isPending}
                            onClick={() => completeOrderMut.mutate(order.id)}
                            className="mt-2 rounded-full bg-[#00e5a0] text-black font-display text-[11px] px-3.5 py-2 border-2 border-black disabled:opacity-50"
                            aria-label={`Mark the sale of ${order.comicTitle} ${order.comicIssue} complete`}
                          >
                            {completeOrderMut.isPending ? "SAVING…" : "MARK COMPLETE — PAID & HANDED OFF"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}

        {community && view.kind === "collectors" && (
          <section className="pt-6">
            <h2 className="font-display text-2xl sm:text-3xl neon-text">THE COLLECTORS</h2>
            <p className="mt-2 text-[15px] text-[#c9c5ef] max-w-xl">
              Every profile gets its own shelf. What each collector paid always stays private, and values stay private too — unless a collector chooses to share theirs.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {collectors.map((collector) => (
                <article key={collector.id} className="rounded-xl border-2 border-black bg-[#1e1a45] p-4 shadow-[0_6px_0_rgba(0,0,0,0.45)]">
                  <div className="flex items-start gap-3">
                    <Avatar collector={collector} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-lg leading-tight flex items-center gap-2 flex-wrap">
                        {collector.displayName}
                        {collector.isFounder && (
                          <span className="bg-[#ff8a00] text-black text-[10px] font-extrabold px-1.5 py-0.5 border border-black">FOUNDER</span>
                        )}
                      </p>
                      <p className="text-[13px] text-[#a7a3cc] font-semibold">
                        @{collector.handle}
                        {collector.city ? ` • ${collector.city}` : ""} • joined {joinedLabel(collector.joinedAt)}
                      </p>
                      {collector.bio && <p className="mt-1.5 text-sm text-[#e6e2ff] leading-snug">{collector.bio}</p>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[12px] font-bold">
                    <span className="rounded-full bg-[#12102e] border border-[#3a3373] px-2.5 py-1">{collector.comicCount} books</span>
                    <span className="rounded-full bg-[#12102e] border border-[#3a3373] px-2.5 py-1">{collector.signedCount} signed</span>
                    <span className="rounded-full bg-[#12102e] border border-[#3a3373] px-2.5 py-1">{collector.forSaleCount} for sale</span>
                    {collector.totalValueCents !== null && (
                      <span className="rounded-full bg-[#12102e] border border-[#00d4ff] text-[#00d4ff] px-2.5 py-1">Shelf worth {money(collector.totalValueCents)}</span>
                    )}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setView({ kind: "profile", collectorId: collector.id })}
                      className="flex-1 rounded-full bg-[#ff2e88] text-white font-display text-[12px] px-3 py-2.5 border-2 border-black"
                    >
                      VIEW SHELF
                    </button>
                    {collector.isMine ? (
                      <span className="flex-1 rounded-full bg-[#12102e] border border-[#00d4ff] text-[#00d4ff] font-display text-[12px] px-3 py-2.5 text-center">
                        THAT'S YOU ✓
                      </span>
                    ) : (
                      <span className="flex-1 rounded-full bg-[#12102e] border border-[#3a3373] text-[#a7a3cc] font-display text-[12px] px-3 py-2.5 text-center">
                        THEIR SHELF
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowJoin(true)}
              className="mt-6 w-full rounded-xl border-2 border-dashed border-[#00d4ff] bg-[#1e1a45]/60 py-5 font-display text-[#00d4ff]"
            >
              + JOIN THE COMMUNITY
            </button>
          </section>
        )}

        {view.kind === "profile" && (
          <section className="pt-6">
            <button type="button" onClick={() => setView({ kind: "collectors" })} className="text-sm font-bold text-[#00d4ff] underline underline-offset-2">
              ← All collectors
            </button>
            {profileQ.isLoading && <p className="py-12 text-center text-[#a7a3cc] font-semibold">Loading this shelf…</p>}
            {profileQ.data && (
              <>
                <div className="mt-4 flex items-start gap-3">
                  <Avatar collector={profileQ.data.collector} size="lg" />
                  <div>
                    <h2 className="font-display text-2xl leading-tight flex items-center gap-2 flex-wrap">
                      {profileQ.data.collector.displayName}
                      {profileQ.data.collector.isFounder && (
                        <span className="bg-[#ff8a00] text-black text-[10px] font-extrabold px-1.5 py-0.5 border border-black">FOUNDER</span>
                      )}
                    </h2>
                    <p className="text-[13px] text-[#a7a3cc] font-semibold">
                      @{profileQ.data.collector.handle}
                      {profileQ.data.collector.city ? ` • ${profileQ.data.collector.city}` : ""}
                    </p>
                    {profileQ.data.collector.bio && <p className="mt-1 text-sm text-[#e6e2ff] max-w-lg">{profileQ.data.collector.bio}</p>}
                    {profileQ.data.collector.totalValueCents !== null && (
                      <p className="mt-1.5 text-sm font-bold text-[#00d4ff]">Shelf value: {money(profileQ.data.collector.totalValueCents)}</p>
                    )}
                  </div>
                </div>
                {profileQ.data.collector.isMine && (
                  <button
                    type="button"
                    onClick={() => setView({ kind: "shelf" })}
                    className="mt-4 rounded-full bg-[#00d4ff] text-black font-display text-[12px] px-4 py-2.5 border-2 border-black"
                  >
                    THIS IS YOUR SHELF — OPEN THE PRIVATE VIEW
                  </button>
                )}
                {profileQ.data.comics.length === 0 ? (
                  <p className="py-12 text-center text-[#a7a3cc] font-semibold">No books on this shelf yet.</p>
                ) : (
                  <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {profileQ.data.comics.map((comic) => (
                      <article key={comic.id} className="rounded-xl overflow-hidden border-2 border-black bg-[#1e1a45] shadow-[0_6px_0_rgba(0,0,0,0.45)]">
                        <button type="button" onClick={() => setDetail(comic)} className="block w-full text-left" aria-label={`View ${comic.title} ${comic.issue}`}>
                          <CoverArt comic={comic} />
                        </button>
                        <div className="p-2.5">
                          <p className="font-bold text-sm leading-tight line-clamp-2">
                            {comic.title} {comic.issue}
                          </p>
                          {comic.currentValueCents !== null && (
                            <p className="mt-0.5 text-[12px] font-bold text-[#00d4ff]">Worth {money(comic.currentValueCents)}</p>
                          )}
                          {comic.status === "for_sale" && comic.askingPriceCents !== null && (
                            <p className="mt-0.5 text-[13px] font-black text-[#ff2e88]">FOR SALE — {money(comic.askingPriceCents)}</p>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {view.kind === "shelf" && (
          <section className="pt-6">
            {!activeCollector ? (
              <div className="text-center py-12">
                <p className="font-display text-xl mb-2">PICK YOUR PROFILE FIRST</p>
                <p className="text-[#c9c5ef] mb-5">Choose your collector profile, or join and make one — your shelf is where your books and your private numbers live.</p>
                <button type="button" onClick={() => setView({ kind: "collectors" })} className="rounded-full bg-[#ff2e88] text-white font-display text-sm px-5 py-3 border-2 border-black">
                  SEE THE COLLECTORS
                </button>
              </div>
            ) : shelfQ.isLoading ? (
              <p className="py-12 text-center text-[#a7a3cc] font-semibold">Loading your shelf…</p>
            ) : shelfQ.data ? (
              <>
                <div className="flex items-start gap-3 flex-wrap">
                  <Avatar collector={shelfQ.data.collector} size="lg" />
                  <div className="flex-1 min-w-[12rem]">
                    <h2 className="font-display text-2xl leading-tight">MY SHELF — {shelfQ.data.collector.displayName.toUpperCase()}</h2>
                    <p className="text-[13px] text-[#a7a3cc] font-semibold">
                      @{shelfQ.data.collector.handle}
                      {shelfQ.data.collector.city ? ` • ${shelfQ.data.collector.city}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowProfileEdit(true)} className="rounded-full bg-[#1e1a45] border border-[#3a3373] font-display text-[12px] px-4 py-2.5">
                      EDIT PROFILE
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingComic(null);
                        setShowComicForm(true);
                      }}
                      className="rounded-full bg-[#ff2e88] text-white font-display text-[12px] px-4 py-2.5 border-2 border-black"
                    >
                      + ADD A BOOK
                    </button>
                  </div>
                </div>

                <div className="mt-5 rounded-xl border-2 border-black bg-[#1e1a45] p-4 shadow-[0_6px_0_rgba(0,0,0,0.45)]">
                  <p className="text-[11px] font-black tracking-[0.2em] text-[#00d4ff]">
                    {shelfQ.data.collector.showValuesPublicly ? "YOUR NUMBERS — VALUES SHARED BY YOUR CHOICE" : "PRIVATE — ONLY ON YOUR SHELF"}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="font-display text-xl sm:text-2xl">{shelfQ.data.comics.length}</p>
                      <p className="text-[12px] font-bold text-[#a7a3cc]">Books</p>
                    </div>
                    <div>
                      <p className="font-display text-xl sm:text-2xl">{money(shelfQ.data.totals.totalPaidCents)}</p>
                      <p className="text-[12px] font-bold text-[#a7a3cc]">Total paid</p>
                    </div>
                    <div>
                      <p className="font-display text-xl sm:text-2xl text-[#00d4ff]">{money(shelfQ.data.totals.totalValueCents)}</p>
                      <p className="text-[12px] font-bold text-[#a7a3cc]">Current value</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[12px] text-[#a7a3cc]">
                    {shelfQ.data.collector.showValuesPublicly
                      ? "You've chosen to show each book's current value — and this shelf total — in the gallery and on your public profile. What you paid still never leaves this shelf."
                      : "Your prices and values never appear in the gallery or on your public profile. Only you see them, here."}
                  </p>
                  <button
                    type="button"
                    disabled={valuesVisibilityMut.isPending}
                    onClick={() =>
                      valuesVisibilityMut.mutate({
                        collectorId: shelfQ.data.collector.id,
                        showValuesPublicly: !shelfQ.data.collector.showValuesPublicly,
                      })
                    }
                    aria-pressed={shelfQ.data.collector.showValuesPublicly}
                    className={`mt-3 rounded-full font-display text-[12px] px-4 py-2.5 border-2 disabled:opacity-50 ${
                      shelfQ.data.collector.showValuesPublicly
                        ? "bg-[#1e1a45] border-[#ff2e88] text-[#ff6ec7]"
                        : "bg-[#00d4ff] text-black border-black"
                    }`}
                  >
                    {valuesVisibilityMut.isPending
                      ? "SAVING…"
                      : shelfQ.data.collector.showValuesPublicly
                        ? "MAKE MY VALUES PRIVATE AGAIN"
                        : "MAKE MY VALUES PUBLIC"}
                  </button>
                </div>

                {shelfQ.data.comics.length === 0 ? (
                  <p className="py-12 text-center text-[#a7a3cc] font-semibold">Your shelf is empty — add your first book.</p>
                ) : (
                  <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {shelfQ.data.comics.map((comic) => (
                      <article key={comic.id} className="rounded-xl overflow-hidden border-2 border-black bg-[#1e1a45] shadow-[0_6px_0_rgba(0,0,0,0.45)]">
                        <button type="button" onClick={() => setShelfDetail(comic)} className="block w-full text-left" aria-label={`Open ${comic.title} ${comic.issue} on your shelf`}>
                          <CoverArt comic={comic} />
                        </button>
                        <div className="p-2.5">
                          <p className="font-bold text-sm leading-tight line-clamp-2">
                            {comic.title} {comic.issue}
                          </p>
                          <p className="mt-0.5 text-[12px] font-bold text-[#00d4ff]">{money(comic.currentValueCents)}</p>
                          {comic.status === "for_sale" && comic.askingPriceCents !== null && (
                            <p className="mt-0.5 text-[12px] font-black text-[#ff2e88]">LISTED — {money(comic.askingPriceCents)}</p>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : shelfQ.isError ? (
              <div className="text-center py-12">
                <p className="font-display text-xl mb-2">THIS SHELF IS PRIVATE</p>
                <p className="text-[#c9c5ef] mb-5 max-w-md mx-auto">
                  {shelfQ.error instanceof Error
                    ? shelfQ.error.message
                    : "This shelf's private details belong to its owner."}
                </p>
                <div className="flex justify-center gap-2 flex-wrap">
                  <button type="button" onClick={() => setView({ kind: "gallery" })} className="rounded-full bg-[#ff2e88] text-white font-display text-sm px-5 py-3 border-2 border-black">
                    BROWSE THE GALLERY
                  </button>
                  <button type="button" onClick={() => setShowJoin(true)} className="rounded-full bg-[#00d4ff] text-black font-display text-sm px-5 py-3 border-2 border-black">
                    JOIN & START YOUR SHELF
                  </button>
                </div>
              </div>
            ) : (
              <p className="py-12 text-center text-[#a7a3cc] font-semibold">Your shelf didn't load — try again in a moment.</p>
            )}
          </section>
        )}
      </main>

      {detail && (
        <PublicDetail
          comic={detail}
          onClose={() => setDetail(null)}
          onViewCollector={() => {
            setView({ kind: "profile", collectorId: detail.collectorId });
            setDetail(null);
          }}
          ownListing={detail.collectorId === myCollector?.id}
          hasProfile={myCollector !== null}
          buying={buyMut.isPending}
          onBuy={() => buyMut.mutate(detail.id)}
          onJoin={() => {
            setDetail(null);
            setShowJoin(true);
          }}
        />
      )}
      {shelfDetail && shelfQ.data && (
        <ShelfDetail
          comic={shelfDetail}
          onClose={() => setShelfDetail(null)}
          onEdit={() => {
            setEditingComic(shelfDetail);
            setShelfDetail(null);
            setShowComicForm(true);
          }}
          onChanged={() => {
            invalidate();
            setShelfDetail(null);
          }}
          onError={errOut}
        />
      )}
      {showJoin && (
        <JoinModal
          onClose={() => setShowJoin(false)}
          onJoined={(id) => {
            pickActive(id);
            setShowJoin(false);
            invalidate();
            setView({ kind: "shelf" });
          }}
        />
      )}
      {showComicForm && activeId !== null && (
        <ComicFormModal
          collectorId={activeId}
          editing={editingComic}
          onClose={() => {
            setShowComicForm(false);
            setEditingComic(null);
          }}
          onSaved={() => {
            setShowComicForm(false);
            setEditingComic(null);
            invalidate();
          }}
        />
      )}
      {showProfileEdit && activeCollector && (
        <ProfileEditModal
          collector={activeCollector}
          onClose={() => setShowProfileEdit(false)}
          onSaved={() => {
            setShowProfileEdit(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border-2 border-black bg-[#1e1a45] shadow-[0_10px_0_rgba(0,0,0,0.5)]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-[#1e1a45] border-b border-[#3a3373] px-4 py-3">
          <h3 className="font-display text-base leading-tight">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full bg-[#12102e] border border-[#3a3373] w-9 h-9 font-display">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function PublicDetail({
  comic,
  onClose,
  onViewCollector,
  ownListing,
  hasProfile,
  buying,
  onBuy,
  onJoin,
}: {
  comic: PublicComic;
  onClose: () => void;
  onViewCollector: () => void;
  ownListing: boolean;
  hasProfile: boolean;
  buying: boolean;
  onBuy: () => void;
  onJoin: () => void;
}) {
  return (
    <ModalShell title={`${comic.title} ${comic.issue}`} onClose={onClose}>
      <div className="grid grid-cols-[7.5rem_1fr] sm:grid-cols-[10rem_1fr] gap-4">
        <CoverArt comic={comic} large />
        <div>
          <p className="font-display text-xl leading-tight">
            {comic.title} {comic.issue}
          </p>
          {comic.variant && <p className="mt-1 text-sm font-semibold text-[#e6e2ff]">{comic.variant}</p>}
          <dl className="mt-3 space-y-1.5 text-sm">
            {comic.publisher && (
              <div className="flex gap-2">
                <dt className="font-bold text-[#a7a3cc] w-20 shrink-0">Publisher</dt>
                <dd>{comic.publisher}</dd>
              </div>
            )}
            {comic.grade && (
              <div className="flex gap-2">
                <dt className="font-bold text-[#a7a3cc] w-20 shrink-0">Grade</dt>
                <dd>{comic.grade}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="font-bold text-[#a7a3cc] w-20 shrink-0">Signed</dt>
              <dd>{comic.isSigned ? "Yes ✦" : "No"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-bold text-[#a7a3cc] w-20 shrink-0">Status</dt>
              <dd>{comic.status === "for_sale" ? "For sale" : comic.status === "wishlist" ? "Wishlist" : comic.status === "sold" ? "Sold" : "In the collection"}</dd>
            </div>
            {comic.currentValueCents !== null && (
              <div className="flex gap-2">
                <dt className="font-bold text-[#a7a3cc] w-20 shrink-0">Value</dt>
                <dd className="text-[#00d4ff] font-bold">{money(comic.currentValueCents)}</dd>
              </div>
            )}
            {comic.status === "for_sale" && comic.askingPriceCents !== null && (
              <div className="flex gap-2">
                <dt className="font-bold text-[#a7a3cc] w-20 shrink-0">Asking</dt>
                <dd className="text-[#ff2e88] font-black">{money(comic.askingPriceCents)}</dd>
              </div>
            )}
          </dl>
          {comic.status === "for_sale" &&
            (ownListing ? (
              <p className="mt-4 text-sm font-bold text-[#a7a3cc]">This is your listing — it shows in the Market until it sells.</p>
            ) : hasProfile ? (
              <>
                <button
                  type="button"
                  disabled={buying}
                  onClick={onBuy}
                  className="mt-4 rounded-full bg-[#ff2e88] text-white font-display text-[12px] px-4 py-2.5 border-2 border-black disabled:opacity-50"
                >
                  {buying ? "PLACING ORDER…" : `BUY IT — ${comic.askingPriceCents !== null ? money(comic.askingPriceCents) : ""}`}
                </button>
                <p className="mt-2 text-[12px] text-[#a7a3cc]">Places the order and marks the book sold. Payment and handoff are arranged between you and the seller.</p>
              </>
            ) : (
              <button type="button" onClick={onJoin} className="mt-4 rounded-full bg-[#00d4ff] text-black font-display text-[12px] px-4 py-2.5 border-2 border-black">
                JOIN TO BUY THIS BOOK
              </button>
            ))}
          <button type="button" onClick={onViewCollector} className="mt-4 block rounded-full bg-[#00d4ff] text-black font-display text-[12px] px-4 py-2.5 border-2 border-black">
            MORE FROM {comic.collectorName.toUpperCase()}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ShelfDetail({
  comic,
  onClose,
  onEdit,
  onChanged,
  onError,
}: {
  comic: ShelfComic;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const deleteMut = useMutation({
    mutationFn: async () => await api.deleteComic({ id: comic.id }),
    onSuccess: onChanged,
    onError,
  });
  const removeCoverMut = useMutation({
    mutationFn: async () => await api.removeComicCover({ id: comic.id }),
    onSuccess: onChanged,
    onError,
  });

  const uploadCover = async (file: File) => {
    setCoverBusy(true);
    try {
      const image = await fileToBase64(file);
      await api.setComicCover({ id: comic.id, image });
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setCoverBusy(false);
    }
  };

  return (
    <ModalShell title={`${comic.title} ${comic.issue}`} onClose={onClose}>
      <div className="grid grid-cols-[7.5rem_1fr] sm:grid-cols-[10rem_1fr] gap-4">
        <CoverArt comic={comic} large />
        <div>
          <p className="font-display text-xl leading-tight">
            {comic.title} {comic.issue}
          </p>
          {comic.variant && <p className="mt-1 text-sm font-semibold text-[#e6e2ff]">{comic.variant}</p>}
          <dl className="mt-3 space-y-1.5 text-sm">
            {comic.publisher && (
              <div className="flex gap-2">
                <dt className="font-bold text-[#a7a3cc] w-24 shrink-0">Publisher</dt>
                <dd>{comic.publisher}</dd>
              </div>
            )}
            {comic.grade && (
              <div className="flex gap-2">
                <dt className="font-bold text-[#a7a3cc] w-24 shrink-0">Grade</dt>
                <dd>{comic.grade}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="font-bold text-[#a7a3cc] w-24 shrink-0">Paid</dt>
              <dd>{money(comic.purchasePriceCents)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-bold text-[#a7a3cc] w-24 shrink-0">Value</dt>
              <dd className="text-[#00d4ff] font-bold">{money(comic.currentValueCents)}</dd>
            </div>
            {comic.purchaseDate && (
              <div className="flex gap-2">
                <dt className="font-bold text-[#a7a3cc] w-24 shrink-0">Bought</dt>
                <dd>{prettyDate(comic.purchaseDate)}</dd>
              </div>
            )}
            {comic.source && (
              <div className="flex gap-2">
                <dt className="font-bold text-[#a7a3cc] w-24 shrink-0">From</dt>
                <dd>{comic.source}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="font-bold text-[#a7a3cc] w-24 shrink-0">Status</dt>
              <dd>{comic.status === "for_sale" ? "For sale" : comic.status === "wishlist" ? "Wishlist" : comic.status === "sold" ? "Sold" : "In the collection"}</dd>
            </div>
            {comic.status === "for_sale" && comic.askingPriceCents !== null && (
              <div className="flex gap-2">
                <dt className="font-bold text-[#a7a3cc] w-24 shrink-0">Asking</dt>
                <dd className="text-[#ff2e88] font-black">{money(comic.askingPriceCents)}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
      {comic.notes && <p className="mt-4 text-sm leading-relaxed text-[#e6e2ff] whitespace-pre-wrap">{comic.notes}</p>}

      <div className="mt-5 border-t border-[#3a3373] pt-4">
        <p className="text-[11px] font-black tracking-[0.2em] text-[#00d4ff] mb-2">COVER PHOTO OF YOUR COPY</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          aria-label="Upload a cover photo of your copy"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadCover(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={coverBusy}
            onClick={() => fileRef.current?.click()}
            className="rounded-full bg-[#1e1a45] border border-[#00d4ff] text-[#00d4ff] font-display text-[12px] px-4 py-2.5 disabled:opacity-50"
          >
            {coverBusy ? "SAVING…" : comic.coverUrl ? "REPLACE PHOTO" : "ADD PHOTO"}
          </button>
          {comic.coverUrl && (
            <button
              type="button"
              onClick={() => removeCoverMut.mutate()}
              className="rounded-full bg-[#1e1a45] border border-[#3a3373] font-display text-[12px] px-4 py-2.5"
            >
              REMOVE PHOTO
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className="flex-1 rounded-full bg-[#ff2e88] text-white font-display text-[13px] px-4 py-3 border-2 border-black">
          EDIT BOOK
        </button>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={() => deleteMut.mutate()}
              className="flex-1 rounded-full bg-[#ff2e5f] text-white font-display text-[13px] px-4 py-3 border-2 border-black"
            >
              YES, REMOVE IT
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-full bg-[#1e1a45] border border-[#3a3373] font-display text-[13px] px-4 py-3">
              KEEP IT
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmingDelete(true)} className="rounded-full bg-[#1e1a45] border border-[#ff2e5f] text-[#ff6ec7] font-display text-[13px] px-4 py-3">
            REMOVE
          </button>
        )}
      </div>
    </ModalShell>
  );
}

function JoinModal({ onClose, onJoined }: { onClose: () => void; onJoined: (id: number) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [city, setCity] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState("");

  const joinMut = useMutation({
    mutationFn: async () =>
      await api.joinCommunity({ displayName: displayName.trim(), handle: handle.trim(), city: city.trim(), bio: bio.trim() }),
    onSuccess: (res) => onJoined(res.collector.id),
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't create your profile — try again."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError("Add your name or collector name first.");
      return;
    }
    setError("");
    joinMut.mutate();
  };

  return (
    <ModalShell title="JOIN THE COMMUNITY" onClose={onClose}>
      <p className="text-sm text-[#c9c5ef] mb-4">
        Make your collector profile and you get your own shelf — add your books, mark the signed ones, flag what you'd sell. Your prices and values stay private on your shelf unless you choose to share your values.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="join-name">Your name or collector name *</label>
          <input id="join-name" {...FIELDS.joinCommunity.displayName} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Danny Comics" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="join-handle">Handle (optional)</label>
          <input id="join-handle" {...FIELDS.joinCommunity.handle} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="e.g. dannys-comics" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="join-city">City (optional)</label>
          <input id="join-city" {...FIELDS.joinCommunity.city} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Miami, FL" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="join-bio">What do you collect? (optional)</label>
          <textarea id="join-bio" {...FIELDS.joinCommunity.bio} value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Variant covers, signed books, Silver Age keys…" className={inputCls} />
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-[#ff6ec7]">{error}</p>}
        <button type="submit" disabled={joinMut.isPending} className="w-full rounded-full bg-[#ff2e88] text-white font-display text-sm px-4 py-3 border-2 border-black disabled:opacity-50">
          {joinMut.isPending ? "CREATING YOUR SHELF…" : "CREATE MY PROFILE"}
        </button>
      </form>
    </ModalShell>
  );
}

function ProfileEditModal({ collector, onClose, onSaved }: { collector: Collector; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(collector.displayName);
  const [city, setCity] = useState(collector.city);
  const [bio, setBio] = useState(collector.bio);
  const [error, setError] = useState("");

  const saveMut = useMutation({
    mutationFn: async () =>
      await api.updateProfile({ collectorId: collector.id, displayName: displayName.trim(), city: city.trim(), bio: bio.trim() }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't save your profile — try again."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError("Your name can't be blank.");
      return;
    }
    setError("");
    saveMut.mutate();
  };

  return (
    <ModalShell title="EDIT YOUR PROFILE" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="profile-name">Name *</label>
          <input id="profile-name" {...FIELDS.updateProfile.displayName} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="profile-city">City</label>
          <input id="profile-city" {...FIELDS.updateProfile.city} value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="profile-bio">What do you collect?</label>
          <textarea id="profile-bio" {...FIELDS.updateProfile.bio} value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className={inputCls} />
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-[#ff6ec7]">{error}</p>}
        <button type="submit" disabled={saveMut.isPending} className="w-full rounded-full bg-[#ff2e88] text-white font-display text-sm px-4 py-3 border-2 border-black disabled:opacity-50">
          {saveMut.isPending ? "SAVING…" : "SAVE PROFILE"}
        </button>
      </form>
    </ModalShell>
  );
}

function ComicFormModal({
  collectorId,
  editing,
  onClose,
  onSaved,
}: {
  collectorId: number;
  editing: ShelfComic | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ComicFormState>(() => (editing ? shelfComicToForm(editing) : emptyComicForm));
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ComicFormState>(key: K, value: ComicFormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Give the book a title first.");
      return;
    }
    if (form.status === "for_sale" && dollarsToCents(form.askingPrice) <= 0) {
      setError("Set an asking price to list this book for sale.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        issue: form.issue.trim(),
        publisher: form.publisher,
        variant: form.variant.trim(),
        grade: form.grade,
        isSigned: form.isSigned,
        purchasePriceCents: dollarsToCents(form.purchasePrice),
        currentValueCents: dollarsToCents(form.currentValue || form.purchasePrice),
        askingPriceCents: form.status === "for_sale" ? dollarsToCents(form.askingPrice) : null,
        status: form.status,
        purchaseDate: form.purchaseDate || null,
        source: form.source.trim(),
        notes: form.notes.trim(),
        coverColor: form.coverColor,
      };
      let id: number;
      if (editing) {
        await api.updateComic({ id: editing.id, ...payload });
        id = editing.id;
      } else {
        const res = await api.addComic({ collectorId, ...payload });
        id = res.id;
      }
      if (coverFile) {
        const image = await fileToBase64(coverFile);
        await api.setComicCover({ id, image });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that book — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={editing ? "EDIT BOOK" : "ADD A BOOK TO YOUR SHELF"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="comic-title">Title *</label>
          <input id="comic-title" {...FIELDS.addComic.title} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. The Walking Dead" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="comic-issue">Issue</label>
            <input id="comic-issue" {...FIELDS.addComic.issue} value={form.issue} onChange={(e) => set("issue", e.target.value)} placeholder="#1" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="comic-publisher">Publisher</label>
            <select id="comic-publisher" value={form.publisher} onChange={(e) => set("publisher", e.target.value)} className={inputCls}>
              {PUBLISHERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="comic-variant">Variant / cover notes</label>
          <input id="comic-variant" {...FIELDS.addComic.variant} value={form.variant} onChange={(e) => set("variant", e.target.value)} placeholder="e.g. Virgin foil exclusive, LTD 100" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="comic-grade">Grade</label>
            <select id="comic-grade" value={form.grade} onChange={(e) => set("grade", e.target.value)} className={inputCls}>
              {GRADES.map((g) => (
                <option key={g || "none"} value={g}>{g || "No grade"}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="comic-status">Status</label>
            <select id="comic-status" value={form.status} onChange={(e) => set("status", e.target.value as ComicFormState["status"])} className={inputCls}>
              <option value="owned">In my collection</option>
              <option value="for_sale">For sale</option>
              <option value="sold">Sold</option>
              <option value="wishlist">Wishlist</option>
            </select>
          </div>
        </div>
        {form.status === "for_sale" && (
          <div className="rounded-lg border border-[#ff2e88] p-3">
            <label className={labelCls} htmlFor="comic-asking">Asking price ($) *</label>
            <input id="comic-asking" inputMode="decimal" value={form.askingPrice} onChange={(e) => set("askingPrice", e.target.value)} placeholder="40.00" className={inputCls} />
            <p className="mt-1.5 text-[12px] text-[#a7a3cc]">This price is public in the Market — it's your listing. What you paid and your book's value stay private unless you share your values.</p>
          </div>
        )}
        <label className="flex items-center gap-3 rounded-lg bg-[#12102e] border border-[#3a3373] px-3 py-2.5 cursor-pointer">
          <input type="checkbox" checked={form.isSigned} onChange={(e) => set("isSigned", e.target.checked)} className="w-5 h-5 accent-[#ff2e88]" />
          <span className="font-bold text-sm">✦ Signed copy</span>
        </label>
        <div className="rounded-lg border border-[#3a3373] p-3 space-y-3">
          <p className="text-[11px] font-black tracking-[0.2em] text-[#00d4ff]">PRIVATE — ONLY YOU SEE THESE</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="comic-paid">Price paid ($)</label>
              <input id="comic-paid" inputMode="decimal" value={form.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} placeholder="25.00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="comic-value">Current value ($)</label>
              <input id="comic-value" inputMode="decimal" value={form.currentValue} onChange={(e) => set("currentValue", e.target.value)} placeholder="25.00" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="comic-date">Purchase date</label>
              <input id="comic-date" type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="comic-source">Bought from</label>
              <input id="comic-source" {...FIELDS.addComic.source} value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="eBay, Whatnot, shop…" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="comic-notes">Notes</label>
            <textarea id="comic-notes" {...FIELDS.addComic.notes} value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="comic-photo">Cover photo of your copy (optional)</label>
          <input
            id="comic-photo"
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm file:mr-3 file:rounded-full file:border-2 file:border-black file:bg-[#00d4ff] file:px-3 file:py-2 file:font-bold file:text-black"
          />
          {editing?.coverUrl && !coverFile && <p className="mt-1 text-[12px] text-[#a7a3cc]">This book already has a photo — picking a new one replaces it.</p>}
        </div>
        <div>
          <span className={labelCls}>Tile color (used until a cover shows)</span>
          <div className="flex flex-wrap gap-2">
            {COVER_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => set("coverColor", color)}
                aria-label={`Tile color ${color}`}
                aria-pressed={form.coverColor === color}
                className={`w-9 h-9 rounded-full border-2 ${form.coverColor === color ? "border-white" : "border-black/50"}`}
                style={{ background: color }}
              />
            ))}
          </div>
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-[#ff6ec7]">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-full bg-[#ff2e88] text-white font-display text-sm px-4 py-3 border-2 border-black disabled:opacity-50">
          {busy ? "SAVING…" : editing ? "SAVE CHANGES" : "ADD TO MY SHELF"}
        </button>
      </form>
    </ModalShell>
  );
}
