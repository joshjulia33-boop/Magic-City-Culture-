// ============================================================================
// Magic City Culture — stripe-webhook (Supabase Edge Function)
//
// The ONLY writer of payment state. Stripe calls this when money moves;
// the signature on every call is verified against STRIPE_WEBHOOK_SECRET
// before anything is trusted. Handled events:
//
//   checkout.session.completed / checkout.session.async_payment_succeeded
//     metadata.kind = "purchase"  → insert the order (status 'paid',
//       price + 5% platform fee snapshotted, Stripe ids recorded). The
//       database's mark_comic_sold_on_order trigger then flips the book
//       to sold and closes the listing. Idempotent: a session that
//       already has an order is acknowledged and skipped, because
//       Stripe retries webhooks.
//     metadata.kind = "trade_cash" → mark the offer's cash_status
//       'paid' and record the payment intent (only when the session id
//       matches the one the checkout function started).
//   account.updated → sync the member's Stripe flags (charges /
//     payouts enabled, details submitted) onto their collectors row.
//
// If a paid purchase's book is no longer for sale (two buyers raced and
// both paid), the order is NOT created and the event is logged loudly —
// that money needs a human refund from the Stripe dashboard; the logs
// name the session and the book.
//
// Deploy (one time, see web/README.md step 11): create `stripe-webhook`
// with this file's contents and deploy it with **Verify JWT turned
// OFF** (Stripe sends no Supabase token; the Stripe signature is the
// authentication). Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// In Stripe: Developers → Webhooks → add endpoint
//   https://ekdgbjnztnfrfjrhljpz.supabase.co/functions/v1/stripe-webhook
// listening for checkout.session.completed,
// checkout.session.async_payment_succeeded, and account.updated — the
// endpoint's signing secret is STRIPE_WEBHOOK_SECRET.
// ============================================================================

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// The platform commission Joshua approved: 5% of the price, in cents.
export function platformFeeCents(amountCents: number): number {
  const pct = Number(Deno.env.get("PLATFORM_FEE_PERCENT") ?? "5");
  const rate = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 5;
  return Math.max(0, Math.round((amountCents * rate) / 100));
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Stripe signature check: the header carries t=<unix>,v1=<hmac hex>
// (possibly several v1 values during secret rotation). The signed
// payload is "<t>.<raw body>", HMAC-SHA256 with the endpoint secret.
export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds: number,
): Promise<boolean> {
  if (!header || !secret) return false;
  let t = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") t = value;
    if (key === "v1") signatures.push(value);
  }
  if (!t || !signatures.length) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = new Uint8Array(mac);
  return signatures.some((sig) => {
    try { return timingSafeEqual(hexToBytes(sig), expected); } catch { return false; }
  });
}

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase REST ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function one(path: string): Promise<Record<string, unknown> | null> {
  const rows = await rest(path) as Record<string, unknown>[];
  return rows?.[0] ?? null;
}

type AnyRec = Record<string, unknown>;

async function handlePurchase(session: AnyRec): Promise<void> {
  const meta = (session.metadata ?? {}) as AnyRec;
  const sessionId = String(session.id ?? "");
  const existing = await one(`orders?stripe_checkout_session_id=eq.${sessionId}&select=id`);
  if (existing) return; // Stripe retry — the order is already written.
  const comic = await one(`comics?id=eq.${meta.comic_id}&select=*`);
  if (!comic || comic.status !== "for_sale" || String(comic.collector_id) !== String(meta.seller_id)) {
    console.error(
      `stripe-webhook: PAID purchase cannot be fulfilled — session ${sessionId}, ` +
      `comic ${String(meta.comic_id)} is no longer for sale by ${String(meta.seller_id)}. ` +
      `A human needs to refund this payment from the Stripe dashboard.`,
    );
    return;
  }
  const amount = Number(session.amount_total ?? comic.asking_price_cents ?? 0);
  await rest("orders", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      comic_id: String(comic.id),
      seller_id: String(meta.seller_id),
      buyer_id: String(meta.buyer_id),
      price_cents: amount,
      platform_fee_cents: platformFeeCents(amount),
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: String(session.payment_intent ?? "") || null,
      status: "paid",
    }),
  });
  console.log(`stripe-webhook: order created for comic ${String(comic.id)} (session ${sessionId})`);
}

async function handleTradeCash(session: AnyRec): Promise<void> {
  const meta = (session.metadata ?? {}) as AnyRec;
  const offer = await one(`offers?id=eq.${meta.offer_id}&select=*`);
  if (!offer) return;
  if (offer.cash_status === "paid") return; // retry — already recorded
  if (String(offer.cash_checkout_session_id ?? "") !== String(session.id ?? "")) {
    console.error(`stripe-webhook: trade cash session mismatch for offer ${String(meta.offer_id)} — not recording.`);
    return;
  }
  await rest(`offers?id=eq.${offer.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      cash_status: "paid",
      cash_payment_intent_id: String(session.payment_intent ?? "") || null,
    }),
  });
  console.log(`stripe-webhook: trade cash paid for offer ${String(offer.id)}`);
}

async function handleAccountUpdated(account: AnyRec): Promise<void> {
  const accountId = String(account.id ?? "");
  if (!accountId) return;
  await rest(`collectors?stripe_account_id=eq.${accountId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      stripe_charges_enabled: account.charges_enabled === true,
      stripe_payouts_enabled: account.payouts_enabled === true,
      stripe_details_submitted: account.details_submitted === true,
    }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only.", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  if (!secret) return new Response("not_configured", { status: 503 });
  const payload = await req.text();
  const ok = await verifyStripeSignature(
    payload,
    req.headers.get("stripe-signature") ?? "",
    secret,
    Math.floor(Date.now() / 1000),
  );
  if (!ok) return new Response("bad signature", { status: 400 });

  let event: AnyRec;
  try {
    event = JSON.parse(payload) as AnyRec;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const type = String(event.type ?? "");
  const object = (event.data as AnyRec)?.object as AnyRec | undefined;
  try {
    if ((type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") && object) {
      if (object.payment_status === "paid" || type === "checkout.session.async_payment_succeeded") {
        const kind = String(((object.metadata ?? {}) as AnyRec).kind ?? "");
        if (kind === "purchase") await handlePurchase(object);
        else if (kind === "trade_cash") await handleTradeCash(object);
      }
    } else if (type === "account.updated" && object) {
      await handleAccountUpdated(object);
    }
  } catch (e) {
    // A 500 makes Stripe retry — right for database hiccups.
    console.error(`stripe-webhook: ${type} failed: ${e instanceof Error ? e.message : String(e)}`);
    return new Response("handler error", { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
