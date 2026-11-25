// ============================================================================
// Magic City Culture — identify-cover (Supabase Edge Function)
//
// The AI pass of the Add/Edit Book photo identification. The static front
// end cannot hold an AI key, so the photo goes here instead:
//
//   Pass 1 — vision look (Gemini): read whatever is printed (title, issue,
//     publisher, variant wording; slab grader / grade / cert), say whether
//     the cover is signed or remarqued, pick any cover types it can see,
//     and describe the artwork itself in concrete visual terms. A printed
//     title ends the job here — early exit, no search at all.
//   Pass 2 — artwork match (only when there is NO printed title, i.e.
//     virgin covers): ONE Gemini call with Google Search grounding, given
//     the photo again plus the pass-1 artwork description. It searches
//     comic databases and catalogues (Grand Comics Database, Comic Vine,
//     League of Comic Geeks, retailer variant listings, publisher
//     catalogues) inside that single call and stops at the first strong,
//     source-backed match — no exhaustive collecting. No genuine match
//     means matched=false and the form stays empty: an honest no-match
//     beats an invented book every time.
//
// Speed: the client's photo arrives already downscaled (1024px JPEG);
// pass 1 early-exits on printed titles; pass 2 is a single grounded call
// with thinking disabled and a capped output; cover types are limited to
// the site's own list.
//
// Deploy (one time, see web/README.md step 7):
//   1. Get a free Gemini API key from Google AI Studio.
//   2. Supabase dashboard → this project → Edge Functions → create a
//      function named `identify-cover` with this file's contents, deploy.
//   3. Edge Functions → Secrets: add GEMINI_API_KEY = that key.
//      (Optional: GEMINI_MODEL to override the default model.)
// Until the function exists the front end gets a 404 and until the key is
// set it gets a 503 — both just mean "AI pass unavailable" and the form
// falls back to its on-device OCR with an honest status line.
// ============================================================================

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const COVER_TYPES = [
  "Standard", "Metal", "Leather", "Foil", "Holographic", "Chromium",
  "Prismatic", "Acetate", "Lenticular", "Glow-in-the-Dark", "Embossed",
  "Die-Cut", "Cardstock", "Virgin", "Black & White", "Sketch",
  "Blank Sketch", "Photo", "Wraparound", "Connecting", "Gatefold",
  "Trading Card", "Incentive Variant",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMPTY = {
  ok: false, message: "", sourceName: "", confidence: "",
  title: "", issue: "", publisher: "", variant: "", grade: "",
  certNumber: "", isSigned: false, isRemarqued: false, coverTypes: [] as string[],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function parseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const bool = (v: unknown): boolean => v === true;
function typeList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    const hit = COVER_TYPES.find((c) => c.toLowerCase() === String(t).toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

type Part = Record<string, unknown>;

async function gemini(parts: Part[], opts: { search?: boolean } = {}): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("not_configured");
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 },
      ...(opts.search ? {} : { responseMimeType: "application/json" }),
    },
  };
  if (opts.search) body.tools = [{ google_search: {} }];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`gemini_${res.status}`);
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p?.text ?? "")
    .join("");
  return parseJson(text);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ...EMPTY, message: "POST only." }, 405);
  if (!Deno.env.get("GEMINI_API_KEY")) return json({ error: "not_configured" }, 503);

  let image = "";
  try {
    const body = await req.json();
    image = typeof body?.image === "string" ? body.image : "";
  } catch {
    return json({ ...EMPTY, message: "That photo couldn't be sent for identification." }, 400);
  }
  const m = image.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m || m[2].length > 8_000_000) {
    return json({ ...EMPTY, message: "That photo format can't be identified — try another photo." }, 400);
  }
  const imgPart: Part = { inline_data: { mime_type: m[1], data: m[2] } };

  // ---- Pass 1: the vision look -------------------------------------------
  let look: Record<string, unknown> | null = null;
  try {
    look = await gemini([
      imgPart,
      {
        text:
          "Look at this comic book cover photo (it may be a raw cover, a virgin cover with no title or text on it, or a graded slab with a printed label at the top). " +
          "Report exactly what is printed: the series title, issue number, publisher, and any variant/edition wording. " +
          "If it is a graded slab, read the label: the grading company (CGC, CBCS or PGX), the numeric grade, and the certification number. " +
          "Say whether the cover is signed (a signature on the cover) and whether it carries a remarque (a small hand-drawn sketch by the artist on the cover). " +
          `From this exact list only, name any cover types the photo itself shows: ${COVER_TYPES.join(", ")}. ` +
          "Also describe the cover artwork itself in concrete visual terms — the characters shown, their costumes and colours, the scene, the setting, and the art style — detailed enough that the artwork could be searched for in a comic cover database. " +
          "For a virgin cover with no printed title, hasPrintedTitle is false and title stays empty; never guess a title from the artwork in this step. " +
          'Reply with JSON only: {"hasPrintedTitle":boolean,"title":string,"issue":string,"publisher":string,"variant":string,"isSlab":boolean,"grader":string,"grade":string,"certNumber":string,"isSigned":boolean,"isRemarqued":boolean,"coverTypes":[string],"artworkDescription":string}',
      },
    ]);
  } catch {
    return json({ ...EMPTY, message: "The photo couldn't be read this time — you can still enter the book by hand." });
  }
  if (!look) {
    return json({ ...EMPTY, message: "The photo couldn't be read this time — you can still enter the book by hand." });
  }

  const grade = bool(look.isSlab) && str(look.grade)
    ? `${str(look.grader) || "CGC"} ${str(look.grade)}`.trim()
    : str(look.grade);
  const base = {
    grade,
    certNumber: str(look.certNumber),
    isSigned: bool(look.isSigned),
    isRemarqued: bool(look.isRemarqued),
    coverTypes: typeList(look.coverTypes),
  };

  if (bool(look.hasPrintedTitle) && str(look.title)) {
    return json({
      ...EMPTY,
      ...base,
      ok: true,
      confidence: "high",
      sourceName: bool(look.isSlab) ? "Read from the slab label in your photo" : "Read from the cover in your photo",
      title: str(look.title),
      issue: str(look.issue),
      publisher: str(look.publisher),
      variant: str(look.variant),
    });
  }

  // ---- Pass 2: match the artwork itself (virgin covers) -------------------
  const description = str(look.artworkDescription);
  if (!description) {
    return json({
      ...EMPTY,
      ...base,
      message: "No title could be read and the artwork couldn't be matched — enter the book by hand, and the photo still becomes its cover.",
    });
  }
  let match: Record<string, unknown> | null = null;
  try {
    match = await gemini(
      [
        imgPart,
        {
          text:
            `A collector photographed a comic book cover that has NO printed title (a virgin cover). The artwork looks like this: ${description}. ` +
            "Using web search, find which comic book and which exact cover/variant this artwork is. Search comic cover databases and catalogues — Grand Comics Database, Comic Vine, League of Comic Geeks, retailer variant listings, publisher catalogues. " +
            "Stop at the first result that clearly identifies this exact artwork; do not keep collecting once you have a strong match. " +
            "Only say matched=true when a result clearly names the same series, issue and variant the artwork shows. When the results are about different books or too vague, say matched=false and leave the fields empty — an honest no-match is far better than a wrong book. " +
            "Set confidence to \"high\" only when a database or catalogue listing names this exact cover; otherwise \"low\". " +
            "sourceName names where the match came from (for example \"Grand Comics Database\", \"Comic Vine\", \"League of Comic Geeks\", or the site the result is from). " +
            `coverTypes: from this exact list only, any types the matched edition is: ${COVER_TYPES.join(", ")}. ` +
            'Reply with JSON only: {"matched":boolean,"confidence":"high"|"low","title":string,"issue":string,"publisher":string,"variant":string,"sourceName":string,"coverTypes":[string]}',
        },
      ],
      { search: true },
    );
  } catch {
    return json({
      ...EMPTY,
      ...base,
      message: "That cover has no title to read, and the artwork match didn't finish — enter the book by hand, and the photo still becomes its cover.",
    });
  }
  if (!match || !bool(match.matched) || !str(match.title)) {
    return json({
      ...EMPTY,
      ...base,
      message: "That cover has no title to read, and the artwork didn't honestly match a book in the cover databases — enter it by hand, and the photo still becomes its cover.",
    });
  }
  const types = [...new Set([...base.coverTypes, ...typeList(match.coverTypes)])];
  return json({
    ...EMPTY,
    ...base,
    coverTypes: types,
    ok: true,
    confidence: str(match.confidence) === "high" ? "high" : "low",
    sourceName: str(match.sourceName) || "Matched from the cover artwork",
    title: str(match.title),
    issue: str(match.issue),
    publisher: str(match.publisher),
    variant: str(match.variant),
  });
});
