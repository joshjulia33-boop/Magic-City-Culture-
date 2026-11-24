"use strict";
/* Magic City Culture Community — static front end.
   Talks straight to Supabase with the publishable key; every privacy rule
   lives in the database (see ../supabase/schema.sql). Values are only ever
   read from comic_values, which row-level security restricts to the owner,
   or from gallery_comics, which exposes a current value only where the
   owner opted in. */

const sb = window.supabase.createClient(
  window.MCC_CONFIG.SUPABASE_URL,
  window.MCC_CONFIG.SUPABASE_PUBLISHABLE_KEY,
);

const COVER_COLORS = ["#FF2E88", "#00D4FF", "#B537F2", "#FF6EC7", "#0090FF", "#12102E", "#FF8A00", "#00E5A0", "#FF2E5F", "#00BFFF"];
const PUBLISHERS = ["Marvel", "DC Comics", "Image Comics", "Dark Horse", "IDW", "Dynamite", "AWA", "BOOM! Studios", "Other"];
const GRADES = ["", "Raw — Near Mint", "Raw — Very Fine", "Raw — Fine", "Raw", "CGC 10.0", "CGC 9.9", "CGC 9.8", "CGC 9.6", "CGC 9.4", "CGC 9.2", "CGC 9.0", "CBCS 9.8", "CBCS 9.6", "PGX 9.8"];
const AVATAR_COLORS = COVER_COLORS;

/* ---------------- helpers ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function money(cents) {
  if (cents === null || cents === undefined) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
function dollarsToCents(v) {
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n * 100);
}
function centsToDollars(cents) { return cents ? String(cents / 100) : ""; }
function prettyDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function joinedLabel(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function orderDateLabel(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function isGraded(grade) { return /CGC|CBCS|PGX/.test(grade || ""); }
function initialsOf(title) {
  return (title || "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/* ---------------- state ---------------- */
let user = null;
let myProfile = null;            // my collectors row (or null)
let gallery = [];                // gallery_comics rows
let profiles = [];               // public_profiles rows
let listings = [];               // listings rows
let myComics = [];               // my comics rows
let myValues = new Map();        // comic_id -> comic_values row
let myOrders = [];               // enriched orders (buying + selling)
let view = { kind: "gallery" };  // gallery | market | collectors | profile | shelf
let gallerySearch = "";
let galleryFilter = "all";       // all | covers | signed | graded | for_sale
let galleryGroup = false;
let busy = false;

const profileById = (id) => profiles.find((p) => p.id === id) || null;

/* ---------------- referrals ----------------
   A member's personal link is <site>/?ref=<handle>. Arriving with a
   ?ref= stores the handle; when that handle names a real collector the
   join view credits them, and profile creation records referred_by
   (column added by ../supabase/referrals.sql — until that SQL runs the
   insert simply goes ahead without it, see onProfileSubmit). */
const REF_STORAGE_KEY = "mcc_ref";
let refHandle = null;        // handle stored from a ?ref= link, or null
let referrerProfile = null;  // public_profiles row for refHandle, once loaded

function captureReferral() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("ref");
    if (fromUrl) {
      const h = fromUrl.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (h) { refHandle = h; localStorage.setItem(REF_STORAGE_KEY, h); return; }
    }
    refHandle = localStorage.getItem(REF_STORAGE_KEY) || null;
  } catch { refHandle = null; }
}
function resolveReferrer() {
  referrerProfile = refHandle ? (profiles.find((p) => p.handle === refHandle) || null) : null;
  // You can't refer yourself.
  if (referrerProfile && myProfile && referrerProfile.id === myProfile.id) referrerProfile = null;
}
function referralLinkFor(handle) {
  return `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(handle)}`;
}
function referralCountFor(collectorId) {
  return profiles.filter((p) => p.referred_by && p.referred_by === collectorId).length;
}

/* ---------------- shared fragments ---------------- */
function avatarHtml(p, size = "md") {
  const initial = (p.display_name || "?").trim()[0]?.toUpperCase() || "?";
  return `<span class="avatar ${size}" style="background:${esc(p.avatar_color || "#FF2E88")}" aria-hidden="true">${esc(initial)}</span>`;
}
function badgesHtml(c) {
  let h = "";
  if (c.is_signed) h += `<span class="badge signed">SIGNED</span>`;
  if (c.grade) h += `<span class="badge">${esc(c.grade)}</span>`;
  if (c.status === "for_sale" && c.asking_price_cents != null) h += `<span class="badge sale">FOR SALE ${esc(money(c.asking_price_cents))}</span>`;
  if (c.status === "sold") h += `<span class="badge sold">SOLD</span>`;
  if (c.status === "wishlist") h += `<span class="badge">WISHLIST</span>`;
  return h;
}
function tileInnerHtml(c) {
  return `<div class="halftone"></div>
    <div class="tile-top">
      <div class="tag-row">
        ${c.publisher ? `<span class="tag-pub">${esc(c.publisher)}</span>` : "<span></span>"}
        ${c.issue ? `<span class="tag-issue">${esc(c.issue)}</span>` : ""}
      </div>
      <p class="tile-title">${esc(c.title)}</p>
      ${c.variant ? `<p class="tile-variant">${esc(c.variant)}</p>` : ""}
    </div>
    <div class="tile-bottom">
      <span class="initials" aria-hidden="true">${esc(initialsOf(c.title))}</span>
      <div class="badges">${badgesHtml(c)}</div>
    </div>`;
}
function coverHtml(c, large = false) {
  if (c.cover_url) {
    // The tile renders underneath the photo, so if the image ever fails
    // to load (bad URL, file removed) the error handler in the init
    // section drops the <img> and the book falls back to its colour tile
    // instead of showing a broken-image icon to every visitor.
    return `<div class="cover has-photo" data-large="${large ? "1" : ""}" style="background:${esc(c.cover_color || "#FF2E88")}">
      ${tileInnerHtml(c)}
      <img class="photo" src="${esc(c.cover_url)}" alt="Cover of ${esc(c.title)} ${esc(c.issue)}" loading="lazy" decoding="async" />
      <div class="photo-badges"><div class="badges">${badgesHtml(c)}</div></div>
    </div>`;
  }
  return `<div class="cover tile ${large ? "large" : ""}" style="background:${esc(c.cover_color || "#FF2E88")}">${tileInnerHtml(c)}</div>`;
}
function galleryCardHtml(c) {
  return `<article class="card">
    <button type="button" class="cover-btn" data-action="open-detail" data-id="${c.id}" aria-label="View ${esc(c.title)} ${esc(c.issue)} from ${esc(c.collector_name)}'s shelf">${coverHtml(c)}</button>
    <div class="card-body">
      <p class="title">${esc(c.title)} ${esc(c.issue)}</p>
      <button type="button" class="owner-link" data-action="goto-profile" data-id="${c.collector_id}">${esc(c.collector_name)}</button>
      ${c.current_value_cents != null ? `<p class="worth">Worth ${esc(money(c.current_value_cents))}</p>` : ""}
      ${c.status === "for_sale" && c.asking_price_cents != null ? `<p class="forsale">FOR SALE — ${esc(money(c.asking_price_cents))}</p>` : ""}
      ${c.status === "sold" ? `<p class="sold-tag">SOLD</p>` : ""}
    </div>
  </article>`;
}

/* ---------------- notice & modal ---------------- */
function setNotice(msg) {
  const slot = $("#notice-slot");
  slot.innerHTML = msg
    ? `<div class="notice" role="alert"><p>${esc(msg)}</p><button type="button" data-action="dismiss-notice" aria-label="Dismiss message">✕</button></div>`
    : "";
}
function openModal(html, wide = false) {
  $("#modal-slot").innerHTML = `<div class="modal-backdrop" data-action-backdrop>
    <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div>
  </div>`;
}
function closeModal() { $("#modal-slot").innerHTML = ""; }
function modalHead(title) {
  return `<button type="button" class="modal-x" data-action="close-modal" aria-label="Close">✕</button><h3>${esc(title)}</h3>`;
}

/* ---------------- data ---------------- */
async function loadPublic() {
  const [g, p, l] = await Promise.all([
    sb.from("gallery_comics").select("*").order("created_at", { ascending: false }).limit(1000),
    sb.from("public_profiles").select("*").order("created_at", { ascending: true }).limit(500),
    sb.from("listings").select("*").order("listed_at", { ascending: false }).limit(1000),
  ]);
  if (g.error) throw g.error;
  if (p.error) throw p.error;
  if (l.error) throw l.error;
  gallery = g.data || [];
  profiles = p.data || [];
  listings = l.data || [];
}
async function resolveMyProfile() {
  myProfile = null;
  if (!user) return;
  const { data, error } = await sb.from("collectors").select("*").eq("auth_user_id", user.id).maybeSingle();
  if (error) throw error;
  myProfile = data || null;
}
async function loadMine() {
  myComics = []; myValues = new Map(); myOrders = [];
  if (!myProfile) return;
  const [c, o] = await Promise.all([
    sb.from("comics").select("*").eq("collector_id", myProfile.id).order("created_at", { ascending: false }).limit(1000),
    sb.from("orders").select("*").or(`buyer_id.eq.${myProfile.id},seller_id.eq.${myProfile.id}`).order("created_at", { ascending: false }).limit(500),
  ]);
  if (c.error) throw c.error;
  if (o.error) throw o.error;
  myComics = c.data || [];
  if (myComics.length) {
    const ids = myComics.map((x) => x.id);
    const { data: vals, error: vErr } = await sb.from("comic_values").select("*").in("comic_id", ids);
    if (vErr) throw vErr;
    myValues = new Map((vals || []).map((v) => [v.comic_id, v]));
  }
  // Enrich orders with comic titles (comics are publicly readable) and
  // the other party's public profile.
  const raw = o.data || [];
  if (raw.length) {
    const comicIds = [...new Set(raw.map((x) => x.comic_id))];
    const { data: comics } = await sb.from("comics").select("id,title,issue,cover_color,cover_url").in("id", comicIds);
    const cmap = new Map((comics || []).map((x) => [x.id, x]));
    myOrders = raw.map((x) => ({ ...x, comic: cmap.get(x.comic_id) || null }));
  } else {
    myOrders = [];
  }
}
async function refreshAll() {
  await loadPublic();
  await resolveMyProfile();
  resolveReferrer();
  await loadMine();
}

/* ---------------- header ---------------- */
function renderHeader() {
  document.querySelectorAll("#main-nav .nav-btn").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === view.kind || (view.kind === "profile" && b.dataset.view === "collectors")));
  });
  const slot = $("#header-actions");
  if (user && myProfile) {
    slot.innerHTML = `
      <button type="button" class="me-chip" data-action="goto-shelf" aria-label="Your shelf — signed in as ${esc(myProfile.display_name)}">
        ${avatarHtml(myProfile)}<span class="me-name">${esc(myProfile.display_name)}</span>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="sign-out">SIGN OUT</button>`;
  } else if (user) {
    slot.innerHTML = `
      <button type="button" class="btn btn-blue" data-action="create-profile">CREATE PROFILE</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="sign-out">SIGN OUT</button>`;
  } else {
    slot.innerHTML = `<button type="button" class="btn btn-blue" data-action="open-auth" data-mode="join">JOIN</button>`;
  }
}

/* ---------------- gallery ---------------- */
function filteredGallery() {
  const q = gallerySearch.trim().toLowerCase();
  return gallery.filter((c) => {
    if (galleryFilter === "covers" && !c.cover_url) return false;
    if (galleryFilter === "signed" && !c.is_signed) return false;
    if (galleryFilter === "graded" && !isGraded(c.grade)) return false;
    if (galleryFilter === "for_sale" && c.status !== "for_sale") return false;
    if (!q) return true;
    return (
      (c.title || "").toLowerCase().includes(q) ||
      (c.variant || "").toLowerCase().includes(q) ||
      (c.publisher || "").toLowerCase().includes(q) ||
      (c.collector_name || "").toLowerCase().includes(q) ||
      (c.collector_handle || "").toLowerCase().includes(q)
    );
  });
}
function viewGalleryHtml() {
  const withCovers = gallery.filter((c) => c.cover_url).length;
  const signedCount = gallery.filter((c) => c.is_signed).length;
  const forSaleCount = gallery.filter((c) => c.status === "for_sale").length;
  const filtered = filteredGallery();
  const chips = [
    ["all", `All books (${gallery.length})`],
    ["covers", `With cover art (${withCovers})`],
    ["signed", "Signed"],
    ["graded", "Graded"],
    ["for_sale", "For sale"],
  ];
  let gridHtml;
  if (!filtered.length) {
    gridHtml = `<p class="empty">${gallery.length === 0
      ? "No books on the shelves yet — join and be the first to add one."
      : "No books match that search. Try a different title or clear the filters."}</p>`;
  } else if (galleryGroup) {
    const byCollector = new Map();
    for (const c of filtered) {
      if (!byCollector.has(c.collector_id)) byCollector.set(c.collector_id, []);
      byCollector.get(c.collector_id).push(c);
    }
    gridHtml = [...byCollector.entries()].map(([cid, books]) => {
      const p = profileById(cid);
      const head = p ? `<div class="group-head">${avatarHtml(p)}
          <div><span class="gname">${esc(p.display_name)}</span> ${p.is_founder ? '<span class="founder-tag">FOUNDER</span>' : ""}
          <div class="gmeta">@${esc(p.handle)} • ${books.length} book${books.length === 1 ? "" : "s"}</div></div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="goto-profile" data-id="${cid}">VIEW SHELF</button>
        </div>` : "";
      return `${head}<div class="grid">${books.map(galleryCardHtml).join("")}</div>`;
    }).join("");
  } else {
    gridHtml = `<div class="grid">${filtered.map(galleryCardHtml).join("")}</div>`;
  }
  return `
  <section class="hero">
    <div class="hero-logo" aria-hidden="true"><svg viewBox="0 0 100 100"><use href="#mcc-logo" /></svg></div>
    <h1 class="neon-text">EVERY COLLECTOR.<br /><span class="blue">ONE CITY.</span></h1>
    <p class="lede">A shared gallery for comic collectors — browse every shelf in the community, then join and put your own books up next to them.</p>
    <div class="stat-chips">
      <span>${profiles.length} collectors</span>
      <span>${gallery.length} books shelved</span>
      <span>${signedCount} signed</span>
      <span>${withCovers} with cover art</span>
      <span>${forSaleCount} for sale</span>
    </div>
  </section>
  <section>
    <div class="toolbar">
      <label class="sr-only" for="gallery-search" style="position:absolute;left:-9999px">Search the gallery</label>
      <input id="gallery-search" class="input grow" type="search" placeholder="Search titles, variants, collectors…" value="${esc(gallerySearch)}" />
      <label class="check"><input type="checkbox" id="gallery-group" ${galleryGroup ? "checked" : ""} /> Group by collector</label>
    </div>
    <div class="filter-row" role="group" aria-label="Filter the gallery">
      ${chips.map(([k, label]) => `<button type="button" class="chip" data-action="gallery-filter" data-filter="${k}" aria-pressed="${galleryFilter === k}">${esc(label)}</button>`).join("")}
    </div>
    ${gridHtml}
  </section>`;
}

/* ---------------- market ---------------- */
function orderCardHtml(o, mine) {
  const buying = o.buyer_id === myProfile?.id;
  const other = profileById(buying ? o.seller_id : o.buyer_id);
  const title = o.comic ? `${o.comic.title} ${o.comic.issue}` : "A book from the shelf";
  return `<div class="order-card">
    <div class="o-main">
      <p class="o-title">${esc(title)}</p>
      <p class="o-meta">${buying ? "Seller" : "Buyer"}: ${esc(other ? other.display_name : "—")} • ${esc(money(o.price_cents))} • Ordered ${esc(orderDateLabel(o.created_at))}
      ${o.status === "completed" && o.completed_at ? ` • Completed ${esc(orderDateLabel(o.completed_at))}` : ""}</p>
    </div>
    <span class="order-status ${o.status}">${o.status.toUpperCase()}</span>
    ${!buying && o.status === "placed" ? `<button type="button" class="btn btn-pink btn-sm" data-action="complete-order" data-id="${o.id}">MARK COMPLETE — PAID &amp; HANDED OFF</button>` : ""}
  </div>`;
}
function viewMarketHtml() {
  const cards = listings.map((l) => {
    const mine = myProfile && l.seller_id === myProfile.id;
    return `<article class="card">
      ${coverHtml({ ...l, id: l.comic_id, status: "for_sale" })}
      <div class="card-body">
        <p class="title">${esc(l.title)} ${esc(l.issue)}</p>
        <button type="button" class="owner-link" data-action="goto-profile" data-id="${l.seller_id}">${esc(l.seller_name)}</button>
        <p class="forsale">${esc(money(l.asking_price_cents))}</p>
        ${mine
          ? `<p class="sold-tag">YOUR LISTING</p>`
          : `<button type="button" class="btn btn-pink btn-sm" style="margin-top:.45rem" data-action="buy" data-id="${l.comic_id}">BUY IT</button>`}
      </div>
    </article>`;
  }).join("");
  let ordersHtml = "";
  if (myProfile) {
    const buying = myOrders.filter((o) => o.buyer_id === myProfile.id);
    const selling = myOrders.filter((o) => o.seller_id === myProfile.id);
    ordersHtml = `
      <h3 class="sub-title">YOUR ORDERS — BUYING</h3>
      ${buying.length ? `<div class="order-list">${buying.map((o) => orderCardHtml(o, true)).join("")}</div>` : `<p class="empty" style="padding:1.5rem 0">You haven't bought anything yet.</p>`}
      <h3 class="sub-title">YOUR ORDERS — SELLING</h3>
      ${selling.length ? `<div class="order-list">${selling.map((o) => orderCardHtml(o, false)).join("")}</div>` : `<p class="empty" style="padding:1.5rem 0">No one has ordered your books yet.</p>`}`;
  } else {
    ordersHtml = `<p class="empty">Join and sign in to buy, sell, and track your orders here.</p>`;
  }
  return `<section class="block">
    <h2 class="view-title neon-text">THE MARKET</h2>
    <p class="view-sub">Books members have listed for sale, at the seller's asking price. Buying places the order here and marks the book sold — you and the seller arrange payment and handoff between yourselves.</p>
    ${listings.length ? `<div class="grid">${cards}</div>` : `<p class="empty">Nothing listed right now. Put one of your own books up from your shelf — set its status to For sale and name your price.</p>`}
    ${ordersHtml}
  </section>`;
}

/* ---------------- collectors & public profile ---------------- */
function viewCollectorsHtml() {
  const counts = new Map();
  for (const c of gallery) {
    const cur = counts.get(c.collector_id) || { books: 0, signed: 0 };
    cur.books += 1; if (c.is_signed) cur.signed += 1;
    counts.set(c.collector_id, cur);
  }
  return `<section class="block">
    <h2 class="view-title neon-text">THE COLLECTORS</h2>
    <p class="view-sub">Every member of the community. Tap a collector to browse their shelf.</p>
    <div class="collector-list">
      ${profiles.map((p) => {
        const ct = counts.get(p.id) || { books: 0, signed: 0 };
        return `<button type="button" class="collector-card" data-action="goto-profile" data-id="${p.id}">
          ${avatarHtml(p, "lg")}
          <span>
            <span class="cname">${esc(p.display_name)} ${p.is_founder ? '<span class="founder-tag">FOUNDER</span>' : ""}</span>
            <span class="chandle" style="display:block">@${esc(p.handle)}${p.city ? ` • ${esc(p.city)}` : ""}</span>
            ${p.bio ? `<span class="cbio" style="display:block">${esc(p.bio)}</span>` : ""}
            <span class="cmeta" style="display:block">${ct.books} books • ${ct.signed} signed • Joined ${esc(joinedLabel(p.created_at))}</span>
          </span>
        </button>`;
      }).join("")}
    </div>
  </section>`;
}
function viewProfileHtml(collectorId) {
  const p = profileById(collectorId);
  if (!p) return `<section class="block"><p class="empty">That collector isn't here anymore.</p></section>`;
  const inviter = p.referred_by ? profileById(p.referred_by) : null;
  const books = gallery.filter((c) => c.collector_id === collectorId);
  const signed = books.filter((c) => c.is_signed).length;
  const exposedTotal = p.show_values_publicly
    ? books.reduce((sum, c) => sum + (c.current_value_cents || 0), 0)
    : null;
  return `<section class="block">
    <div class="shelf-head">
      ${avatarHtml(p, "lg")}
      <div class="grow">
        <h2>${esc(p.display_name.toUpperCase())} ${p.is_founder ? '<span class="founder-tag">FOUNDER</span>' : ""}</h2>
        <p class="handle-line">@${esc(p.handle)}${p.city ? ` • ${esc(p.city)}` : ""} • Joined ${esc(joinedLabel(p.created_at))}</p>
        ${inviter ? `<p class="handle-line">Invited by <button type="button" class="owner-link" data-action="goto-profile" data-id="${inviter.id}">@${esc(inviter.handle)}</button></p>` : ""}
        ${p.bio ? `<p style="margin:.4rem 0 0;font-size:14px;color:#c9c5ef">${esc(p.bio)}</p>` : ""}
      </div>
    </div>
    <div class="stat-chips" style="justify-content:flex-start">
      <span>${books.length} books</span><span>${signed} signed</span>
      ${exposedTotal !== null ? `<span>Shelf value ${esc(money(exposedTotal))} — shared by choice</span>` : `<span>Values private</span>`}
    </div>
    ${books.length ? `<div class="grid">${books.map(galleryCardHtml).join("")}</div>` : `<p class="empty">No books on this shelf yet.</p>`}
  </section>`;
}

/* ---------------- my shelf ---------------- */
function invitePanelHtml(p) {
  const link = referralLinkFor(p.handle);
  const count = referralCountFor(p.id);
  const shareText = `Join me on Magic City Culture — a Miami community for comic collectors. Shelve your books, browse every collection, and trade in the market: ${link}`;
  return `<div class="values-panel">
    <p class="vp-tag">INVITE A FRIEND</p>
    <p class="vp-note" style="margin-top:.4rem">Referrals: ${count} collector${count === 1 ? "" : "s"} joined through your link.</p>
    <div class="field" style="margin-top:.6rem"><label class="label" for="ref-link">Your referral link</label>
      <div style="display:flex;gap:.5rem">
        <input class="input" id="ref-link" style="flex:1" readonly value="${esc(link)}" aria-label="Your referral link" />
        <button type="button" class="btn btn-blue" data-action="copy-ref-link">COPY</button>
      </div>
    </div>
    <form id="invite-form">
      <div class="field"><label class="label" for="invite-email">Friend's email</label>
        <input class="input" id="invite-email" type="email" required placeholder="friend@example.com" /></div>
      <div class="row-actions">
        <button type="submit" class="btn btn-pink">SEND REFERRAL EMAIL</button>
        <a class="btn btn-ghost" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener">SHARE ON WHATSAPP</a>
      </div>
    </form>
    <p class="vp-note">The email opens in your own mail app, from you — the site never sends mail for you.</p>
  </div>`;
}
function viewShelfHtml() {
  if (!user) {
    return `<section class="block"><div class="center-note">
      <p class="big">SIGN IN TO SEE YOUR SHELF</p>
      <p>Your shelf is where your books and your private numbers live.</p>
      <button type="button" class="btn btn-pink" data-action="open-auth" data-mode="signin">SIGN IN</button>
      <button type="button" class="btn btn-blue" data-action="open-auth" data-mode="join">JOIN THE COMMUNITY</button>
    </div></section>`;
  }
  if (!myProfile) {
    return `<section class="block"><div class="center-note">
      <p class="big">ONE MORE STEP — YOUR COLLECTOR PROFILE</p>
      <p>You're signed in. Now pick the name and handle your shelf will live under.</p>
      <button type="button" class="btn btn-pink" data-action="create-profile">CREATE MY PROFILE</button>
    </div></section>`;
  }
  const p = myProfile;
  let totalPaid = 0, totalValue = 0;
  for (const c of myComics) {
    const v = myValues.get(c.id);
    if (v) { totalPaid += v.purchase_price_cents || 0; totalValue += v.current_value_cents || 0; }
  }
  const cards = myComics.map((c) => {
    const v = myValues.get(c.id);
    return `<article class="card">
      <button type="button" class="cover-btn" data-action="edit-book" data-id="${c.id}" aria-label="Open ${esc(c.title)} ${esc(c.issue)} on your shelf">${coverHtml(c)}</button>
      <div class="card-body">
        <p class="title">${esc(c.title)} ${esc(c.issue)}</p>
        ${v && v.current_value_cents != null ? `<p class="worth">${esc(money(v.current_value_cents))}</p>` : ""}
        ${c.status === "for_sale" && c.asking_price_cents != null ? `<p class="forsale">LISTED — ${esc(money(c.asking_price_cents))}</p>` : ""}
        ${c.status === "sold" ? `<p class="sold-tag">SOLD</p>` : ""}
      </div>
    </article>`;
  }).join("");
  return `<section class="block">
    <div class="shelf-head">
      ${avatarHtml(p, "lg")}
      <div class="grow">
        <h2>MY SHELF — ${esc(p.display_name.toUpperCase())}</h2>
        <p class="handle-line">@${esc(p.handle)}${p.city ? ` • ${esc(p.city)}` : ""}</p>
      </div>
      <div class="row-actions" style="margin-top:0">
        <button type="button" class="btn btn-ghost" data-action="edit-profile">EDIT PROFILE</button>
        <button type="button" class="btn btn-pink" data-action="add-book">+ ADD A BOOK</button>
      </div>
    </div>
    <div class="values-panel">
      <p class="vp-tag">${p.show_values_publicly ? "YOUR NUMBERS — VALUES SHARED BY YOUR CHOICE" : "PRIVATE — ONLY ON YOUR SHELF"}</p>
      <div class="values-grid">
        <div><p class="num">${myComics.length}</p><p class="cap">Books</p></div>
        <div><p class="num">${esc(money(totalPaid))}</p><p class="cap">Total paid</p></div>
        <div><p class="num blue">${esc(money(totalValue))}</p><p class="cap">Current value</p></div>
      </div>
      <p class="vp-note">${p.show_values_publicly
        ? "You've chosen to show each book's current value — and this shelf total — in the gallery and on your public profile. What you paid still never leaves this shelf."
        : "Your prices and values never appear in the gallery or on your public profile. Only you see them, here."}</p>
      <button type="button" class="btn ${p.show_values_publicly ? "btn-ghost" : "btn-blue"}" data-action="toggle-values" aria-pressed="${p.show_values_publicly}">
        ${p.show_values_publicly ? "MAKE MY VALUES PRIVATE AGAIN" : "MAKE MY VALUES PUBLIC"}
      </button>
    </div>
    ${invitePanelHtml(p)}
    ${myComics.length ? `<div class="grid">${cards}</div>` : `<p class="empty">Your shelf is empty — add your first book.</p>`}
  </section>`;
}

/* ---------------- render ---------------- */
function render() {
  renderHeader();
  const app = $("#app");
  try {
    if (view.kind === "gallery") app.innerHTML = viewGalleryHtml();
    else if (view.kind === "market") app.innerHTML = viewMarketHtml();
    else if (view.kind === "collectors") app.innerHTML = viewCollectorsHtml();
    else if (view.kind === "profile") app.innerHTML = viewProfileHtml(view.collectorId);
    else if (view.kind === "shelf") app.innerHTML = viewShelfHtml();
  } catch (e) {
    app.innerHTML = `<p class="empty">Something went sideways rendering this view.</p>`;
    console.error(e);
  }
  const search = $("#gallery-search");
  if (search) {
    search.addEventListener("input", (e) => {
      gallerySearch = e.target.value;
      // Re-render only the grid area would need a partial render; simplest
      // correct approach: re-render and restore focus + caret.
      const pos = e.target.selectionStart;
      render();
      const s2 = $("#gallery-search");
      if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
    });
  }
  const groupToggle = $("#gallery-group");
  if (groupToggle) groupToggle.addEventListener("change", (e) => { galleryGroup = e.target.checked; render(); });
  const inviteForm = $("#invite-form");
  if (inviteForm) {
    inviteForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = $("#invite-email").value.trim();
      if (!email || !myProfile) return;
      const link = referralLinkFor(myProfile.handle);
      const subject = "Join me on Magic City Culture";
      const body = `Hi!\n\nI'm inviting you to Magic City Culture — a Miami community for comic collectors. Shelve your own books, browse everyone's collections, and trade in the market.\n\nOpen your account with my referral link:\n${link}\n\nSee you in the city,\n${myProfile.display_name}`;
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }
}
async function copyReferralLink() {
  const input = $("#ref-link");
  if (!input) return;
  try {
    await navigator.clipboard.writeText(input.value);
    setNotice("Referral link copied — send it to a fellow collector.");
  } catch {
    input.select();
    setNotice("Your referral link is selected — copy it and send it on.");
  }
}
function setView(v) { view = v; render(); window.scrollTo({ top: 0 }); }

/* ---------------- detail modal (gallery / market) ---------------- */
function openDetail(comicId) {
  const c = gallery.find((x) => x.id === comicId) || (() => {
    const l = listings.find((x) => x.comic_id === comicId);
    return l ? { ...l, id: l.comic_id, collector_id: l.seller_id, collector_name: l.seller_name, collector_handle: l.seller_handle, status: "for_sale", current_value_cents: null, created_at: l.listed_at } : null;
  })();
  if (!c) return;
  const mine = myProfile && c.collector_id === myProfile.id;
  openModal(`
    ${modalHead(`${c.title} ${c.issue}`)}
    <div class="detail-grid">
      <div>${coverHtml(c, true)}</div>
      <div class="detail-meta">
        ${c.publisher ? `<p><span class="k">Publisher</span>${esc(c.publisher)}</p>` : ""}
        ${c.variant ? `<p><span class="k">Variant</span>${esc(c.variant)}</p>` : ""}
        ${c.grade ? `<p><span class="k">Grade</span>${esc(c.grade)}</p>` : ""}
        <p><span class="k">Signed</span>${c.is_signed ? "Yes" : "No"}</p>
        <p><span class="k">Collector</span><button type="button" class="owner-link" data-action="goto-profile" data-id="${c.collector_id}">${esc(c.collector_name)}</button></p>
        ${c.current_value_cents != null ? `<p><span class="k">Current value (shared by the collector)</span>${esc(money(c.current_value_cents))}</p>` : ""}
        ${c.status === "for_sale" && c.asking_price_cents != null ? `<p><span class="k">Asking price</span><strong style="color:var(--accent)">${esc(money(c.asking_price_cents))}</strong></p>` : ""}
        ${c.status === "sold" ? `<p><span class="k">Status</span>Sold</p>` : ""}
        ${c.status === "for_sale" && c.asking_price_cents != null
          ? (mine
              ? `<p class="form-note">This is your listing.</p>`
              : `<div class="row-actions"><button type="button" class="btn btn-pink" data-action="buy" data-id="${c.id}">BUY IT — ${esc(money(c.asking_price_cents))}</button></div>`)
          : ""}
      </div>
    </div>`, true);
}

/* ---------------- auth ---------------- */
function openAuth(mode = "join") {
  openModal(`
    ${modalHead(mode === "join" ? "JOIN THE COMMUNITY" : "SIGN IN")}
    <div class="tabs" role="group" aria-label="Sign in or join">
      <button type="button" data-action="open-auth" data-mode="join" aria-pressed="${mode === "join"}">JOIN</button>
      <button type="button" data-action="open-auth" data-mode="signin" aria-pressed="${mode === "signin"}">SIGN IN</button>
    </div>
    <form id="auth-form" data-mode="${mode}">
      <div class="field"><label class="label" for="auth-email">Email</label>
        <input class="input" id="auth-email" type="email" required autocomplete="email" /></div>
      <div class="field"><label class="label" for="auth-password">Password</label>
        <input class="input" id="auth-password" type="password" required autocomplete="${mode === "join" ? "new-password" : "current-password"}" minlength="6" /></div>
      <p class="form-error" id="auth-error"></p>
      ${mode === "join" && referrerProfile ? `<p class="form-note" style="margin-bottom:.6rem">Invited by <strong>@${esc(referrerProfile.handle)}</strong> — they saved you a spot in the city.</p>` : ""}
      <button type="submit" class="btn btn-pink" style="width:100%">${mode === "join" ? "CREATE MY ACCOUNT" : "SIGN IN"}</button>
      <p class="form-note" style="margin-top:.6rem">${mode === "join"
        ? "After your account, you'll pick the name and handle for your shelf. Your collection values are private by default — always."
        : "Welcome back to the city."}</p>
    </form>`);
  $("#auth-form").addEventListener("submit", onAuthSubmit);
}
async function onAuthSubmit(e) {
  e.preventDefault();
  if (busy) return;
  busy = true;
  const form = e.target;
  const mode = form.dataset.mode;
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const err = $("#auth-error");
  err.textContent = "";
  try {
    if (mode === "join") {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        closeModal();
        setNotice("Account created — check your email to confirm it, then sign in and create your collector profile.");
        return;
      }
      closeModal();
      setNotice("You're in! One more step: create your collector profile so your shelf has a name.");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeModal();
      setNotice("Signed in. Welcome back!");
    }
    const { data: sess } = await sb.auth.getSession();
    user = sess.session?.user || null;
    await refreshAll();
    if (user && !myProfile) openProfileForm();
    else render();
  } catch (ex) {
    err.textContent = ex.message || "That didn't work — try again.";
  } finally {
    busy = false;
  }
}

/* ---------------- profile create / edit ---------------- */
function swatchesHtml(name, selected) {
  return `<div class="swatches" data-swatch-group="${name}">
    ${AVATAR_COLORS.map((col) => `<button type="button" class="swatch" data-swatch="${col}" style="background:${col}" aria-pressed="${col === selected}" aria-label="Colour ${col}"></button>`).join("")}
  </div><input type="hidden" id="${name}" value="${esc(selected)}" />`;
}
function wireSwatches(scope) {
  scope.querySelectorAll("[data-swatch-group]").forEach((group) => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-swatch]");
      if (!btn) return;
      group.querySelectorAll("[data-swatch]").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      document.getElementById(group.dataset.swatchGroup).value = btn.dataset.swatch;
    });
  });
}
function openProfileForm() {
  const p = myProfile;
  openModal(`
    ${modalHead(p ? "EDIT YOUR PROFILE" : "CREATE YOUR COLLECTOR PROFILE")}
    <form id="profile-form">
      ${!p && referrerProfile ? `<p class="form-note" style="margin-bottom:.6rem">Invited by <strong>@${esc(referrerProfile.handle)}</strong> — they'll get the credit when your shelf opens.</p>` : ""}
      <div class="field"><label class="label" for="pf-name">Display name</label>
        <input class="input" id="pf-name" required maxlength="60" value="${esc(p?.display_name || "")}" placeholder="e.g. Joshua" /></div>
      ${p ? "" : `<div class="field"><label class="label" for="pf-handle">Handle (your @name, lowercase)</label>
        <input class="input" id="pf-handle" required maxlength="30" pattern="[a-z0-9_]+" title="Lowercase letters, numbers and underscores only" placeholder="e.g. joshua" /></div>`}
      <div class="field"><label class="label" for="pf-city">City</label>
        <input class="input" id="pf-city" maxlength="60" value="${esc(p?.city || "")}" placeholder="Miami, FL" /></div>
      <div class="field"><label class="label" for="pf-bio">Bio</label>
        <textarea class="input" id="pf-bio" rows="3" maxlength="280" placeholder="What do you collect?">${esc(p?.bio || "")}</textarea></div>
      <div class="field"><span class="label">Avatar colour</span>${swatchesHtml("pf-color", p?.avatar_color || "#FF2E88")}</div>
      <p class="form-error" id="pf-error"></p>
      <button type="submit" class="btn btn-pink" style="width:100%">${p ? "SAVE PROFILE" : "START MY SHELF"}</button>
    </form>`);
  wireSwatches(document);
  $("#profile-form").addEventListener("submit", onProfileSubmit);
}
async function onProfileSubmit(e) {
  e.preventDefault();
  if (busy) return;
  busy = true;
  const err = $("#pf-error");
  err.textContent = "";
  try {
    const fields = {
      display_name: $("#pf-name").value.trim(),
      city: $("#pf-city").value.trim(),
      bio: $("#pf-bio").value.trim(),
      avatar_color: $("#pf-color").value,
    };
    if (!fields.display_name) throw new Error("Give your shelf a display name.");
    if (myProfile) {
      const { error } = await sb.from("collectors").update(fields).eq("id", myProfile.id);
      if (error) throw error;
      setNotice("Profile saved.");
    } else {
      const handle = $("#pf-handle").value.trim().toLowerCase();
      if (!handle) throw new Error("Pick a handle.");
      const payload = { ...fields, handle, auth_user_id: user.id };
      if (referrerProfile) payload.referred_by = referrerProfile.id;
      let { error } = await sb.from("collectors").insert(payload);
      if (error && payload.referred_by && /referred_by|column|PGRST204/i.test(error.message || "")) {
        // The referrals column isn't installed yet (supabase/referrals.sql
        // not run) — an invite must never block a sign-up, so retry plain.
        delete payload.referred_by;
        ({ error } = await sb.from("collectors").insert(payload));
      }
      if (error) {
        if (/duplicate|unique/i.test(error.message)) throw new Error("That handle is taken — try another.");
        throw error;
      }
      // The invite has done its job; don't credit it to a later account
      // created on this same device.
      try { localStorage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ }
      refHandle = null; referrerProfile = null;
      setNotice("Profile created — welcome to Magic City Culture! Add your first book from your shelf.");
    }
    closeModal();
    await refreshAll();
    setView({ kind: "shelf" });
  } catch (ex) {
    err.textContent = ex.message || "That didn't work — try again.";
  } finally {
    busy = false;
  }
}

/* ---------------- comic add / edit ---------------- */
function comicFormHtml(c) {
  const v = c ? myValues.get(c.id) : null;
  const status = c?.status || "owned";
  return `
    <div class="field"><label class="label" for="cf-title">Title *</label>
      <input class="input" id="cf-title" required maxlength="160" value="${esc(c?.title || "")}" /></div>
    <div class="field"><label class="label" for="cf-issue">Issue</label>
      <input class="input" id="cf-issue" maxlength="30" value="${esc(c?.issue || "")}" placeholder="#1" /></div>
    <div class="field"><label class="label" for="cf-publisher">Publisher</label>
      <select class="input" id="cf-publisher">${PUBLISHERS.map((pub) => `<option ${pub === (c?.publisher || "Marvel") ? "selected" : ""}>${esc(pub)}</option>`).join("")}</select></div>
    <div class="field"><label class="label" for="cf-variant">Variant / edition</label>
      <input class="input" id="cf-variant" maxlength="200" value="${esc(c?.variant || "")}" /></div>
    <div class="field"><label class="label" for="cf-grade">Grade</label>
      <select class="input" id="cf-grade">${GRADES.map((g) => `<option value="${esc(g)}" ${g === (c?.grade || "") ? "selected" : ""}>${esc(g || "Ungraded / not recorded")}</option>`).join("")}</select></div>
    <div class="field"><label class="check"><input type="checkbox" id="cf-signed" ${c?.is_signed ? "checked" : ""} /> Signed</label></div>
    <div class="field"><label class="label" for="cf-status">Status</label>
      <select class="input" id="cf-status">
        ${[["owned", "On my shelf"], ["for_sale", "For sale"], ["wishlist", "Wishlist"], ["sold", "Sold"]].map(([val, label]) => `<option value="${val}" ${val === status ? "selected" : ""}>${label}</option>`).join("")}
      </select></div>
    <div class="field" id="cf-asking-wrap" ${status === "for_sale" ? "" : 'style="display:none"'}>
      <label class="label" for="cf-asking">Asking price ($) — public, it's your offer to everyone</label>
      <input class="input" id="cf-asking" inputmode="decimal" value="${esc(centsToDollars(c?.asking_price_cents))}" placeholder="25" /></div>
    <div class="field"><span class="label">Cover colour (tile shown until you add a photo)</span>${swatchesHtml("cf-color", c?.cover_color || "#FF2E88")}</div>
    <div class="field"><label class="label" for="cf-cover">Cover photo (optional)</label>
      <input class="input" id="cf-cover" type="file" accept="image/*" />
      ${c?.cover_url ? `<p class="form-note" style="margin-top:.3rem">A cover photo is set — choosing a new one replaces it.</p>` : ""}</div>
    <h3 style="font-size:15px;margin:1rem 0 .5rem">Your private numbers — only you ever see these</h3>
    <div class="field"><label class="label" for="cf-paid">What you paid ($)</label>
      <input class="input" id="cf-paid" inputmode="decimal" value="${esc(centsToDollars(v?.purchase_price_cents))}" /></div>
    <div class="field"><label class="label" for="cf-value">Current value ($)</label>
      <input class="input" id="cf-value" inputmode="decimal" value="${esc(centsToDollars(v?.current_value_cents))}" /></div>
    <div class="field"><label class="label" for="cf-date">Purchase date</label>
      <input class="input" id="cf-date" type="date" value="${esc(v?.purchase_date || "")}" /></div>
    <div class="field"><label class="label" for="cf-source">Bought from (seller / shop)</label>
      <input class="input" id="cf-source" maxlength="160" value="${esc(v?.source || "")}" /></div>
    <div class="field"><label class="label" for="cf-notes">Notes</label>
      <textarea class="input" id="cf-notes" rows="2" maxlength="500">${esc(v?.notes || "")}</textarea></div>`;
}
function openComicForm(comicId = null) {
  const c = comicId ? myComics.find((x) => x.id === comicId) : null;
  if (comicId && !c) return;
  openModal(`
    ${modalHead(c ? "EDIT BOOK" : "ADD A BOOK")}
    <form id="comic-form" data-comic-id="${c?.id || ""}">
      ${comicFormHtml(c)}
      <p class="form-error" id="cf-error"></p>
      <div class="row-actions">
        <button type="submit" class="btn btn-pink">${c ? "SAVE BOOK" : "ADD TO MY SHELF"}</button>
        ${c ? `<button type="button" class="btn btn-danger" data-action="delete-book" data-id="${c.id}">REMOVE FROM SHELF</button>` : ""}
      </div>
    </form>`, true);
  wireSwatches(document);
  $("#cf-status").addEventListener("change", (e) => {
    $("#cf-asking-wrap").style.display = e.target.value === "for_sale" ? "" : "none";
  });
  $("#comic-form").addEventListener("submit", onComicSubmit);
}
async function uploadCover(file, comicId) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${myProfile.id}/${comicId}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from("covers").upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
  if (error) throw error;
  const { data } = sb.storage.from("covers").getPublicUrl(path);
  return data.publicUrl;
}
async function onComicSubmit(e) {
  e.preventDefault();
  if (busy) return;
  busy = true;
  const err = $("#cf-error");
  err.textContent = "";
  const form = e.target;
  const comicId = form.dataset.comicId || null;
  try {
    const status = $("#cf-status").value;
    const asking = status === "for_sale" ? dollarsToCents($("#cf-asking").value) : null;
    if (status === "for_sale" && (!asking || asking <= 0)) throw new Error("Name an asking price to list this book for sale.");
    const fields = {
      title: $("#cf-title").value.trim(),
      issue: $("#cf-issue").value.trim(),
      publisher: $("#cf-publisher").value,
      variant: $("#cf-variant").value.trim(),
      grade: $("#cf-grade").value,
      is_signed: $("#cf-signed").checked,
      status,
      asking_price_cents: asking,
      cover_color: $("#cf-color").value,
    };
    if (!fields.title) throw new Error("The book needs a title.");
    let id = comicId;
    if (id) {
      const { error } = await sb.from("comics").update(fields).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from("comics").insert({ ...fields, collector_id: myProfile.id }).select("id").single();
      if (error) throw error;
      id = data.id;
    }
    const file = $("#cf-cover").files?.[0];
    if (file) {
      const url = await uploadCover(file, id);
      const { error } = await sb.from("comics").update({ cover_url: url }).eq("id", id);
      if (error) throw error;
    }
    const { error: vErr } = await sb.from("comic_values").upsert({
      comic_id: id,
      purchase_price_cents: dollarsToCents($("#cf-paid").value),
      current_value_cents: dollarsToCents($("#cf-value").value),
      purchase_date: $("#cf-date").value || null,
      source: $("#cf-source").value.trim(),
      notes: $("#cf-notes").value.trim(),
    }, { onConflict: "comic_id" });
    if (vErr) throw vErr;
    closeModal();
    setNotice(comicId ? "Book saved." : "Book added to your shelf.");
    await refreshAll();
    render();
  } catch (ex) {
    err.textContent = ex.message || "That didn't work — try again.";
  } finally {
    busy = false;
  }
}

/* ---------------- market actions ---------------- */
function confirmBuy(comicId) {
  const l = listings.find((x) => x.comic_id === comicId);
  const g = !l ? gallery.find((x) => x.id === comicId && x.status === "for_sale") : null;
  const listing = l || (g ? {
    comic_id: g.id, title: g.title, issue: g.issue, asking_price_cents: g.asking_price_cents,
    seller_id: g.collector_id, seller_name: g.collector_name,
  } : null);
  if (!listing) return;
  if (!user) { openAuth("join"); return; }
  if (!myProfile) { openProfileForm(); return; }
  if (listing.seller_id === myProfile.id) { setNotice("That's your own listing."); return; }
  openModal(`
    ${modalHead("PLACE THIS ORDER?")}
    <p style="font-size:15px"><strong>${esc(listing.title)} ${esc(listing.issue)}</strong> from ${esc(listing.seller_name)} — <strong style="color:var(--accent)">${esc(money(listing.asking_price_cents))}</strong>.</p>
    <p class="form-note">Placing the order marks the book sold here. No payment is taken in the app — you and the seller arrange payment and handoff between yourselves.</p>
    <p class="form-error" id="buy-error"></p>
    <div class="row-actions">
      <button type="button" class="btn btn-pink" id="buy-confirm">BUY IT — ${esc(money(listing.asking_price_cents))}</button>
      <button type="button" class="btn btn-ghost" data-action="close-modal">NOT YET</button>
    </div>`);
  $("#buy-confirm").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    try {
      const { error } = await sb.from("orders").insert({
        comic_id: listing.comic_id,
        seller_id: listing.seller_id,
        buyer_id: myProfile.id,
        price_cents: listing.asking_price_cents,
      });
      if (error) throw error;
      closeModal();
      setNotice(`Order placed for ${listing.title} ${listing.issue} — ${money(listing.asking_price_cents)}. ${listing.seller_name} will see it under their selling orders; arrange payment and handoff with them directly.`);
      await refreshAll();
      setView({ kind: "market" });
    } catch (ex) {
      $("#buy-error").textContent = ex.message || "The order didn't go through — the book may already be sold.";
    } finally {
      busy = false;
    }
  });
}
async function completeOrder(orderId) {
  if (busy) return;
  busy = true;
  try {
    const { error } = await sb.from("orders")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", orderId);
    if (error) throw error;
    setNotice("Order marked complete. Nice doing business in the city.");
    await refreshAll();
    render();
  } catch (ex) {
    setNotice(ex.message || "Couldn't update that order.");
  } finally {
    busy = false;
  }
}
async function toggleValues() {
  if (!myProfile || busy) return;
  busy = true;
  try {
    const next = !myProfile.show_values_publicly;
    const { error } = await sb.from("collectors").update({ show_values_publicly: next }).eq("id", myProfile.id);
    if (error) throw error;
    setNotice(next
      ? "Your current values now show in the gallery and on your public profile. What you paid stays private either way."
      : "Your values are private again — only you see them, on your shelf.");
    await refreshAll();
    render();
  } catch (ex) {
    setNotice(ex.message || "Couldn't change that setting.");
  } finally {
    busy = false;
  }
}
async function deleteBook(comicId) {
  const c = myComics.find((x) => x.id === comicId);
  if (!c || busy) return;
  openModal(`
    ${modalHead("REMOVE THIS BOOK?")}
    <p style="font-size:15px"><strong>${esc(c.title)} ${esc(c.issue)}</strong> will come off your shelf, along with its private numbers. This can't be undone.</p>
    <p class="form-error" id="del-error"></p>
    <div class="row-actions">
      <button type="button" class="btn btn-danger" id="del-confirm">REMOVE IT</button>
      <button type="button" class="btn btn-ghost" data-action="close-modal">KEEP IT</button>
    </div>`);
  $("#del-confirm").addEventListener("click", async () => {
    busy = true;
    try {
      const { error } = await sb.from("comics").delete().eq("id", comicId);
      if (error) throw error;
      closeModal();
      setNotice("Book removed from your shelf.");
      await refreshAll();
      render();
    } catch (ex) {
      $("#del-error").textContent = ex.message || "Couldn't remove that book.";
    } finally {
      busy = false;
    }
  });
}

/* ---------------- events & init ---------------- */
document.addEventListener("click", (e) => {
  const backdrop = e.target.closest?.("[data-action-backdrop]");
  if (backdrop && e.target === backdrop) { closeModal(); return; }
  const el = e.target.closest?.("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;
  switch (action) {
    case "dismiss-notice": setNotice(""); break;
    case "close-modal": closeModal(); break;
    case "goto-shelf": setView({ kind: "shelf" }); break;
    case "goto-profile": closeModal(); setView({ kind: "profile", collectorId: id }); break;
    case "open-auth": openAuth(el.dataset.mode || "join"); break;
    case "create-profile": closeModal(); openProfileForm(); break;
    case "edit-profile": openProfileForm(); break;
    case "sign-out":
      sb.auth.signOut().then(async () => {
        setNotice("Signed out. See you around the city.");
        await refreshAll();
        setView({ kind: "gallery" });
      });
      break;
    case "gallery-filter": galleryFilter = el.dataset.filter; render(); break;
    case "open-detail": openDetail(id); break;
    case "buy": confirmBuy(id); break;
    case "complete-order": completeOrder(id); break;
    case "toggle-values": toggleValues(); break;
    case "copy-ref-link": copyReferralLink(); break;
    case "add-book": openComicForm(null); break;
    case "edit-book": openComicForm(id); break;
    case "delete-book": deleteBook(id); break;
  }
});
document.querySelectorAll("#main-nav .nav-btn").forEach((b) => {
  b.addEventListener("click", () => setView({ kind: b.dataset.view }));
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
// Cover photos: if an image fails to load for any visitor (bad URL,
// missing file), swap its card back to the colour tile rendered beneath
// it rather than leaving a broken-image icon. Capture phase, because
// resource error events do not bubble.
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!img || img.tagName !== "IMG" || !img.classList.contains("photo")) return;
  const wrap = img.closest(".cover");
  img.remove();
  if (!wrap) return;
  wrap.querySelector(".photo-badges")?.remove();
  wrap.classList.remove("has-photo");
  wrap.classList.add("tile");
  if (wrap.dataset.large === "1") wrap.classList.add("large");
}, true);

async function boot() {
  captureReferral();
  try {
    const { data } = await sb.auth.getSession();
    user = data.session?.user || null;
  } catch { user = null; }
  try {
    await refreshAll();
  } catch (e) {
    $("#app").innerHTML = `<div class="center-note">
      <p class="big">THE COMMUNITY DIDN'T LOAD</p>
      <p>${esc(e.message || "Something went wrong reaching the database.")}</p>
      <button type="button" class="btn btn-pink" onclick="location.reload()">TRY AGAIN</button>
    </div>`;
    renderHeader();
    return;
  }
  render();
}
sb.auth.onAuthStateChange(async (_event, session) => {
  const nextUser = session?.user || null;
  if ((nextUser?.id || null) !== (user?.id || null)) {
    user = nextUser;
    try { await refreshAll(); } catch { /* keep current data */ }
    render();
  }
});
boot();
