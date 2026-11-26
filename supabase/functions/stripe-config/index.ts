// ============================================================================
// Magic City Culture — stripe-config (Supabase Edge Function)
//
// Tells the static front end whether card payments are switched on, and
// hands it the Stripe PUBLISHABLE key (the only Stripe key a browser may
// ever see — it can start checkouts but cannot charge, refund, or read
// anything). Payments count as "on" only when this function can see
// both the publishable key and the secret key in its own environment;
// the secret itself is never returned, logged, or compared — only its
// presence is reported. Until the secrets exist the front end keeps the
// site's original behaviour (deals arranged on the site, money settled
// between members), so deploying this function early is harmless.
//
// Deploy (one time, see web/README.md step 11):
//   Supabase dashboard → Edge Functions → create `stripe-config` with
//   this file's contents, deploy. Secrets (STRIPE_PUBLISHABLE_KEY,
//   STRIPE_SECRET_KEY) are shared by all the Stripe functions — set
//   them once under Edge Functions → Secrets.
// ============================================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "POST or GET only." }, 405);
  const publishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? "";
  const hasSecret = !!(Deno.env.get("STRIPE_SECRET_KEY") ?? "");
  return json({
    paymentsEnabled: !!publishableKey && hasSecret,
    publishableKey,
  });
});
