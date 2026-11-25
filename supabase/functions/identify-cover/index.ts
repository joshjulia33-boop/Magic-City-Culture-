// ============================================================================
// Magic City Culture — identify-cover (Supabase Edge Function)
//
// Photo identification for the Add/Edit Book form. The static front end
// cannot hold an AI key, so the photo comes here instead. Identification
// is driven by the ARTWORK and by searching the web for the actual
// published cover — never by OCR-style letter reading (the front end no
// longer does any on-device text reading at all):
//
//   Pass 1 — vision look (Gemini): describe the cover artwork itself in
//     concrete visual terms (characters, costumes, scene, style), note
//     any printed clues (title / issue / publisher / variant wording;
//     slab grader / grade / cert), and the physical attributes of the
//     copy (signed, remarqued, visible cover types). Printed text is one
//     clue among many here, never the answer by itself.
//   Pass 2 — web match (always runs): ONE Gemini call with Google Search
//     grounding, given the photo again plus the pass-1 description and
//     clues. It searches comic databases and cover catalogues (Grand
//     Comics Database, Comic Vine, League of Comic Geeks, publisher
//     catalogues, retailer variant listings, eBay listings) and returns
//     the best-matching published cover plus up to two close alternates,
//     each with title, issue, variant, publisher, year and the source it
//     came from. It stops at the first strong, source-backed match — no
//     exhaustive collecting, to keep it fast.
//   Fallback: if the web match finds nothing it can stand behind but
//     pass 1 clearly read a printed title (e.g. a slab label), those
//     details are returned labelled as read from the photo, at low
//     confidence. Otherwise the answer is an honest no-match and the
//     form stays empty — an invented book is never returned.
//
// Every Gemini failure is logged with its HTTP status and a snippet of
// the provider's error body (visible under Edge Functions → Logs), and
// each pass falls back through more than one model before giving up —
// so if identification ever returns "couldn't be read" for every photo,
// the logs say exactly why (an invalid GEMINI_API_KEY and a model the
// key cannot use are the usual causes).
//
// Deploy (one time, see web/README.md step 7):
//   1. Get a free Gemini API key from Google AI Studio.
//   2. Supabase dashboard → this project → Edge Functions → create a
//      function named `identify-cover` with this file's contents, deploy.
//   3. Edge Functions → Secrets: add GEMINI_API_KEY = that key.
//      (Optional: GEMINI_MODEL to override the default model.)
// Until the function exists the front end gets a 404 and until the key is
// set it gets a 503 — both just mean "identification unavailable" and the
// form falls back to manual entry with an honest status line.
// ============================================================================

const PRIMARY_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const FALLBACK_MODELS: string[] = [];
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
  title: "", issue: "", publisher: "", variant: "", year: "", grade: "",
  certNumber: "", isSigned: false, isRemarqued: false, coverTypes: [] as string[],
  alternates: [] as Record<string, string>[],
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
function candidate(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!str(o.title)) return null;
  return {
    title: str(o.title),
    issue: str(o.issue),
    publisher: str(o.publisher),
    variant: str(o.variant),
    year: str(o.year),
    sourceName: str(o.sourceName),
  };
}

type Part = Record<string, unknown>;

// One Gemini call, tried against the configured model first and then the
// fallback models. Any provider rejection is logged with its status and
// a snippet of the error body before moving on, so the real cause is
// always visible in the function's logs.
async function gemini(parts: Part[], opts: { search?: boolean } = {}): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("not_configured");
  const models = [...new Set([PRIMARY_MODEL, ...FALLBACK_MODELS])];
  let lastErr: Error | null = null;
  for (const model of models) {
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
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const snippet = (await res.text().catch(() => "")).slice(0, 300);
        console.error(`identify-cover: gemini ${model} -> HTTP ${res.status}: ${snippet}`);
        lastErr = new Error(`gemini_${res.status}`);
        continue;
      }
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p?.text ?? "")
        .join("");
      const parsed = parseJson(text);
      if (parsed) return parsed;
      console.error(`identify-cover: gemini ${model} returned unparseable output`);
      lastErr = new Error("gemini_unparseable");
    } catch (e) {
      console.error(`identify-cover: gemini ${model} request failed: ${e instanceof Error ? e.message : String(e)}`);
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("gemini_failed");
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
          "First, describe the cover artwork itself in concrete visual terms — the characters shown, their costumes and colours, the scene, the setting, and the art style — detailed enough that this exact artwork could be searched for in a comic cover database. " +
          "Also report any printed clues: the series title, issue number, publisher, and any variant/edition wording, exactly as printed. " +
          "If it is a graded slab, read the label: the grading company (CGC, CBCS or PGX), the numeric grade, and the certification number. " +
          "Say whether the cover is signed (a signature on the cover) and whether it carries a remarque (a small hand-drawn sketch by the artist on the cover). " +
          `From this exact list only, name any cover types the photo itself shows: ${COVER_TYPES.join(", ")}. ` +
          "For a virgin cover with no printed title, hasPrintedTitle is false and title stays empty; never guess a title from the artwork in this step. " +
          'Reply with JSON only: {"hasPrintedTitle":boolean,"title":string,"issue":string,"publisher":string,"variant":string,"isSlab":boolean,"grader":string,"grade":string,"certNumber":string,"isSigned":boolean,"isRemarqued":boolean,"coverTypes":[string],"artworkDescription":string}',
      },
    ]);
  } catch (e) {
    console.error(`identify-cover: pass 1 failed: ${e instanceof Error ? e.message : String(e)}`);
    return json({ ...EMPTY, message: "The cover search couldn't run this time — you can still enter the book by hand." });
  }
  if (!look) {
    return json({ ...EMPTY, message: "The cover search couldn't run this time — you can still enter the book by hand." });
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

  // ---- Pass 2: match the artwork on the web (always runs) -----------------
  const description = str(look.artworkDescription);
  const clues = [
    str(look.title) ? `printed title reads "${str(look.title)}"` : "",
    str(look.issue) ? `issue "${str(look.issue)}"` : "",
    str(look.publisher) ? `publisher "${str(look.publisher)}"` : "",
    str(look.variant) ? `variant wording "${str(look.variant)}"` : "",
  ].filter(Boolean).join("; ");
  let match: Record<string, unknown> | null = null;
  if (description || clues) {
    try {
      match = await gemini(
        [
          imgPart,
          {
            text:
              "A collector photographed this comic book cover. " +
              (description ? `The artwork looks like this: ${description}. ` : "") +
              (clues ? `Printed clues on the cover: ${clues}. ` : "") +
              "Using web search, find which comic book and which exact cover/variant this artwork is. Search comic cover databases and catalogues — Grand Comics Database, Comic Vine, League of Comic Geeks, publisher catalogues, retailer variant listings, eBay listings. " +
              "Compare what you find against the artwork in the photo. Stop at the first result that clearly identifies this exact artwork; do not keep collecting once you have a strong match. " +
              "Only say matched=true when a result clearly names the same series, issue and variant the artwork shows. When the results are about different books or too vague, say matched=false and leave the fields empty — an honest no-match is far better than a wrong book. " +
              "Also list up to two OTHER close candidates in alternates (different editions a searcher might confuse with this one), each with its own sourceName, or an empty list when there are none. " +
              "Set confidence to \"high\" only when a database or catalogue listing names this exact cover; otherwise \"low\". " +
              "sourceName names where the match came from (for example \"Grand Comics Database\", \"Comic Vine\", \"League of Comic Geeks\", or the site the result is from). year is the cover's publication year. " +
              `coverTypes: from this exact list only, any types the matched edition is: ${COVER_TYPES.join(", ")}. ` +
              'Reply with JSON only: {"matched":boolean,"confidence":"high"|"low","title":string,"issue":string,"publisher":string,"year":string,"variant":string,"sourceName":string,"coverTypes":[string],"alternates":[{"title":string,"issue":string,"publisher":string,"year":string,"variant":string,"sourceName":string}]}',
          },
        ],
        { search: true },
      );
    } catch (e) {
      console.error(`identify-cover: pass 2 failed: ${e instanceof Error ? e.message : String(e)}`);
      match = null;
    }
  }

  if (match && bool(match.matched) && str(match.title)) {
    const types = [...new Set([...base.coverTypes, ...typeList(match.coverTypes)])];
    const alternates = (Array.isArray(match.alternates) ? match.alternates : [])
      .map(candidate)
      .filter((a): a is Record<string, string> => !!a)
      .slice(0, 2);
    return json({
      ...EMPTY,
      ...base,
      coverTypes: types,
      alternates,
      ok: true,
      confidence: str(match.confidence) === "high" ? "high" : "low",
      sourceName: str(match.sourceName) || "Matched from the cover artwork",
      title: str(match.title),
      issue: str(match.issue),
      publisher: str(match.publisher),
      variant: str(match.variant),
      year: str(match.year),
    });
  }

  // ---- Fallback: a title the vision pass clearly read off the photo -------
  if (bool(look.hasPrintedTitle) && str(look.title)) {
    return json({
      ...EMPTY,
      ...base,
      ok: true,
      confidence: "low",
      sourceName: bool(look.isSlab) ? "Read from the slab label in your photo" : "Read from the cover in your photo",
      title: str(look.title),
      issue: str(look.issue),
      publisher: str(look.publisher),
      variant: str(look.variant),
    });
  }

  return json({
    ...EMPTY,
    ...base,
    message: "That cover couldn't be matched to a book in the cover databases — enter it by hand, and the photo still becomes its cover.",
  });
});
