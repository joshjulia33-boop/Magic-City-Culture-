// ============================================================================
// Magic City Culture — stripe-connect (Supabase Edge Function)
//
// Seller onboarding for Stripe Connect (STANDARD accounts — the member
// gets a full Stripe account of their own; the platform pays no
// per-account fees, and money from a sale lands in the member's own
// Stripe balance, never the site's). Two actions, both requiring the
// caller's Supabase sign-in token:
//
//   { action: "onboard" } — creates the member's connected account on
//     first use (id stored on their collectors row), then returns a
//     Stripe-hosted Account Link URL. The member completes identity /
//     bank details on Stripe's pages; the site never sees them.
//   { action: "status" } — re-reads the account from Stripe and syncs
//     the flags on the collectors row (charges_enabled,
//     payouts_enabled, details_submitted). The stripe-webhook function
//     also syncs these on Stripe's account.updated events; this action
//     is the front end's "check again" path (e.g. right after the
//     member returns from onboarding).
//
// All Stripe calls use the SECRET key from this function's environment
// (STRIPE_SECRET_KEY). The account id is written with the Supabase
// service key, because the collectors row's client policies rightly do
// not let a member write their own Stripe fields.
//
// Deploy (one time, see web/README.md step 11): create `stripe-connect`
// with this file's contents; secrets STRIPE_SECRET_KEY (+ optional
// SITE_URL, default https://magic-city-culture.vercel.app).
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

function stripeSecret(): string {
  return Deno.env.get("STRIPE_SECRET_KEY") ?? "";
}

// Stripe's API takes classic form encoding with bracket notation:
// { payment_intent_data: { transfer_data: { destination: "acct_…" } } }
// becomes payment_intent_data[transfer_data][destination]=acct_…
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

// Resolve the caller's collectors row from their Supabase auth token.
async function callerCollector(req: Request): Promise<Record<string, unknown> | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token === SERVICE_KEY) return null;
  const res = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null) as { id?: string; email?: string } | null;
  if (!user?.id) return null;
  const rows = await rest(`collectors?auth_user_id=eq.${user.id}&select=*`) as Record<string, unknown>[];
  const row = rows?.[0] ?? null;
  if (row) row.__email = user.email ?? "";
  return row;
}

async function syncAccountFlags(collector: Record<string, unknown>): Promise<Record<string, unknown>> {
  const accountId = String(collector.stripe_account_id ?? "");
  if (!accountId) return { connected: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false };
  const acct = await stripe(`/accounts/${accountId}`, "GET");
  const flags = {
    stripe_charges_enabled: acct.charges_enabled === true,
    stripe_payouts_enabled: acct.payouts_enabled === true,
    stripe_details_submitted: acct.details_submitted === true,
  };
  await rest(`collectors?id=eq.${collector.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(flags),
  });
  return {
    connected: true,
    chargesEnabled: flags.stripe_charges_enabled,
    payoutsEnabled: flags.stripe_payouts_enabled,
    detailsSubmitted: flags.stripe_details_submitted,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  if (!stripeSecret()) return json({ error: "not_configured" }, 503);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const action = typeof body?.action === "string" ? body.action : "";

  const collector = await callerCollector(req).catch(() => null);
  if (!collector) return json({ error: "Sign in with a collector profile first." }, 401);

  try {
    if (action === "status") {
      return json(await syncAccountFlags(collector));
    }
    if (action === "onboard") {
      let accountId = String(collector.stripe_account_id ?? "");
      if (!accountId) {
        const acct = await stripe("/accounts", "POST", {
          type: "standard",
          country: "US",
          email: String(collector.__email ?? "") || undefined,
          metadata: { collector_id: String(collector.id), site: "magic-city-culture" },
        });
        accountId = String(acct.id ?? "");
        if (!accountId) throw new Error("Stripe didn't return an account id.");
        await rest(`collectors?id=eq.${collector.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ stripe_account_id: accountId }),
        });
      }
      const link = await stripe("/account_links", "POST", {
        account: accountId,
        type: "account_onboarding",
        refresh_url: `${SITE_URL}/?stripe=refresh`,
        return_url: `${SITE_URL}/?stripe=return`,
      });
      return json({ url: String(link.url ?? "") });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(`stripe-connect: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: e instanceof Error ? e.message : "Stripe couldn't be reached." }, 502);
  }
});
