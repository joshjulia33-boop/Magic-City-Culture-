// ============================================================================
// Magic City Culture — stripe-checkout (Supabase Edge Function)
//
// Starts Stripe Checkout (hosted by Stripe) for the two things members
// pay for by card. Both are DESTINATION charges on the seller's /
// receiver's STANDARD connected account: the money lands in their
// Stripe account, Stripe's processing fee comes out of their side, and
// the site's 5% platform commission rides along as
// application_fee_amount to the platform account. The function only
// STARTS the payment — the order / paid state is written later by
// stripe-webhook once Stripe confirms the money, never here, so a
// checkout that is abandoned or fails changes nothing.
//
// Actions (caller must be signed in):
//   { action: "buy", comicId } — pay a Market listing's asking price.
//     The listing must still be for sale, not the caller's own, and the
//     seller must have payouts set up (charges enabled).
//   { action: "trade-cash", offerId } — pay the cash top-up on an
//     ACCEPTED trade offer. Only the offer's sender owes the cash (it
//     was their side of the deal); the receiver must have payouts set
//     up. Starting the checkout records cash_status 'pending' + the
//     session id on the offer (a write the offers guard trigger allows
//     only to this service key).
//
// Deploy (one time, see web/README.md step 11): create `stripe-checkout`
// with this file's contents; secret STRIPE_SECRET_KEY (+ optional
// SITE_URL, PLATFORM_FEE_PERCENT — default 5).
// ============================================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://magic-city-culture.vercel.app").replace(/\/$/, "");

// The platform commission Joshua approved: 5% of the price, in cents.
export function platformFeeCents(amountCents: number): number {
  const pct = Number(Deno.env.get("PLATFORM_FEE_PERCENT") ?? "5");
  const rate = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 5;
  return Math.max(0, Math.round((amountCents * rate) / 100));
}

function stripeSecret(): string {
  return Deno.env.get("STRIPE_SECRET_KEY") ?? "";
}

export function encodeForm(params: Record<string, unknown>, prefix = "", out: string[] = []): string {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === "object") encodeForm(item as Record<string, unknown>, `${name}[${i}]`, out);
        else out.push(`${encodeURIComponent(name)}[${i}]=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === "object") {
      encodeForm(value as Record<string, unknown>, name, out);
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out.join("&");
}

async function stripe(path: string, method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeSecret()}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params ? encodeForm(params) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } })?.error?.message || `Stripe HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as Record<string, unknown>;
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

async function callerCollector(req: Request): Promise<Record<string, unknown> | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token === SERVICE_KEY) return null;
  const res = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null) as { id?: string } | null;
  if (!user?.id) return null;
  const rows = await rest(`collectors?auth_user_id=eq.${user.id}&select=*`) as Record<string, unknown>[];
  return rows?.[0] ?? null;
}

async function one(path: string): Promise<Record<string, unknown> | null> {
  const rows = await rest(path) as Record<string, unknown>[];
  return rows?.[0] ?? null;
}

function checkoutSession(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return stripe("/checkout/sessions", "POST", params);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  if (!stripeSecret()) return json({ error: "not_configured" }, 503);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const action = typeof body?.action === "string" ? body.action : "";

  const buyer = await callerCollector(req).catch(() => null);
  if (!buyer) return json({ error: "Sign in with a collector profile first." }, 401);

  try {
    if (action === "buy") {
      const comicId = String(body.comicId ?? "");
      if (!comicId) return json({ error: "Which book?" }, 400);
      const comic = await one(`comics?id=eq.${comicId}&select=*`);
      if (!comic || comic.status !== "for_sale" || !(Number(comic.asking_price_cents) > 0)) {
        return json({ error: "That book isn't for sale any more." }, 409);
      }
      if (comic.collector_id === buyer.id) return json({ error: "That's your own listing." }, 400);
      const seller = await one(`collectors?id=eq.${comic.collector_id}&select=*`);
      if (!seller?.stripe_account_id || seller.stripe_charges_enabled !== true) {
        return json({ error: "The seller hasn't set up card payouts yet — arrange payment with them directly." }, 409);
      }
      const amount = Number(comic.asking_price_cents);
      const session = await checkoutSession({
        mode: "payment",
        success_url: `${SITE_URL}/?payment=success&kind=buy`,
        cancel_url: `${SITE_URL}/?payment=cancelled`,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amount,
            product_data: { name: `${comic.title} ${comic.issue} — Magic City Culture`.trim() },
          },
        }],
        payment_intent_data: {
          application_fee_amount: platformFeeCents(amount),
          transfer_data: { destination: String(seller.stripe_account_id) },
        },
        metadata: {
          kind: "purchase",
          comic_id: String(comic.id),
          buyer_id: String(buyer.id),
          seller_id: String(seller.id),
        },
      });
      return json({ url: String(session.url ?? ""), id: String(session.id ?? "") });
    }

    if (action === "trade-cash") {
      const offerId = String(body.offerId ?? "");
      if (!offerId) return json({ error: "Which offer?" }, 400);
      const offer = await one(`offers?id=eq.${offerId}&select=*`);
      if (!offer) return json({ error: "That offer isn't there any more." }, 404);
      if (offer.from_collector_id !== buyer.id) {
        return json({ error: "Only the member who offered the cash can pay it." }, 403);
      }
      if (offer.status !== "accepted") return json({ error: "That deal isn't accepted yet." }, 409);
      if (!(Number(offer.cash_cents) > 0)) return json({ error: "That deal has no cash on it." }, 400);
      if (offer.cash_status === "paid") return json({ error: "That cash is already paid." }, 409);
      const payee = await one(`collectors?id=eq.${offer.to_collector_id}&select=*`);
      if (!payee?.stripe_account_id || payee.stripe_charges_enabled !== true) {
        return json({ error: "The other member hasn't set up card payouts yet — settle the cash with them directly." }, 409);
      }
      const target = await one(`comics?id=eq.${offer.target_comic_id}&select=title,issue`);
      const amount = Number(offer.cash_cents);
      const session = await checkoutSession({
        mode: "payment",
        success_url: `${SITE_URL}/?payment=success&kind=trade`,
        cancel_url: `${SITE_URL}/?payment=cancelled`,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amount,
            product_data: {
              name: `Trade cash top-up${target ? ` — ${target.title} ${target.issue}` : ""} — Magic City Culture`,
            },
          },
        }],
        payment_intent_data: {
          application_fee_amount: platformFeeCents(amount),
          transfer_data: { destination: String(payee.stripe_account_id) },
        },
        metadata: {
          kind: "trade_cash",
          offer_id: String(offer.id),
          payer_id: String(buyer.id),
          payee_id: String(payee.id),
        },
      });
      // Record the started payment on the offer (the guard trigger
      // allows the service key to write only the cash fields).
      await rest(`offers?id=eq.${offer.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          cash_status: "pending",
          cash_checkout_session_id: String(session.id ?? ""),
        }),
      });
      return json({ url: String(session.url ?? ""), id: String(session.id ?? "") });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(`stripe-checkout: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: e instanceof Error ? e.message : "Checkout couldn't start." }, 502);
  }
});
