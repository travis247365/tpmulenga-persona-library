/**
 * Rank the roles in a digest against the account's derived profile.
 *
 * This is the only place the worker talks to Anthropic, and it uses the
 * OPERATOR's key (a wrangler secret), not the visitor's. That is a deliberate
 * and narrow exception to the bring-your-own-key design: the browser app still
 * never sends a key or a CV anywhere but api.anthropic.com. What reaches here
 * is a derived profile - titles, skills, seniority, years - uploaded only when
 * someone presses the button, never the CV itself.
 *
 * Degrading: if there is no key, ranking is skipped and the pack still goes
 * out carrying the raw list. A pack that arrives unranked is useful; a pack
 * that never arrives because the key expired is not.
 */
const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "ranked"],
  properties: {
    summary: {
      type: "string",
      description: "Two or three sentences on what arrived and what is worth acting on.",
    },
    ranked: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "title", "score", "verdict", "why"],
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          score: { type: "integer", minimum: 1, maximum: 5 },
          verdict: { type: "string", enum: ["apply", "consider", "skip"] },
          why: { type: "string", description: "One or two sentences, grounded in the profile." },
          concerns: { type: "array", items: { type: "string" } },
          tweaks: {
            type: "array",
            description: "CV changes to make BEFORE applying to this specific role.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["change", "why"],
              properties: {
                change: { type: "string" },
                why: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * The honesty rails are in the system prompt rather than checked afterwards,
 * because a fabricated qualification in a CV tweak is the failure that costs
 * a real job. They restate the standing rules: credentials come from
 * certificates, status words mean what they say, and no hidden text, ever.
 */
const SYSTEM = [
  "You screen job adverts against a candidate profile and say, plainly, which are worth applying for.",
  "",
  "Rules you do not break:",
  "- Never invent a qualification, employer, date or figure. If the profile does not say it, it is not true.",
  "- Never suggest adding hidden text of any kind - white-on-white, zero-point, off-canvas or in metadata - to influence an applicant tracking system or an AI screener. This is fraud, not optimisation.",
  "- A CV tweak may only re-emphasise, re-word or re-order what the profile already contains, or advise the candidate to ADD something true that is missing. Never advise them to claim something they have not done.",
  "- Status words are load-bearing. 'Led delivery of' and 'built' are different claims; so are 'reviewed', 'issued for signature' and 'signed'. Keep whichever the profile uses.",
  "- Where a client or employer name is marked confidential in the profile, do not name it.",
  "- Score honestly. A profile that does not fit a role scores low and says why. Padding the list helps nobody.",
  "",
  "Score 5 = apply today, 1 = ignore. Use 'verdict' to match: apply (4-5), consider (3), skip (1-2).",
  "Give tweaks only for roles you scored 4 or 5; for anything lower the honest advice is not to spend the evening on it.",
].join("\n");

export function rankingAvailable(env) {
  return Boolean(env && typeof env.ANTHROPIC_API_KEY === "string" &&
                 env.ANTHROPIC_API_KEY.startsWith("sk-ant-"));
}

/**
 * @returns {Promise<{ok: true, data: object} | {ok: false, reason: string}>}
 * Never throws: a ranking failure must downgrade the pack, not lose it.
 */
export async function rankJobs(env, profile, jobs, fetchImpl = fetch) {
  if (!rankingAvailable(env)) return { ok: false, reason: "no operator API key configured" };
  if (!jobs.length) return { ok: false, reason: "nothing to rank" };

  const user = [
    "CANDIDATE PROFILE (derived in the candidate's browser from their CV; this is all you have):",
    JSON.stringify(profile, null, 1),
    "",
    `ROLES THAT ARRIVED (${jobs.length}):`,
    JSON.stringify(
      jobs.map((j) => ({ title: j.title, company: j.company, location: j.location, url: j.url })),
      null, 1),
  ].join("\n");

  let res;
  try {
    res = await fetchImpl(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        // A policy decline would otherwise end the request with no pack. The
        // server retries the same request on a fallback model inside the call.
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
        // Adaptive is the only thinking mode this model takes - a budget is a
        // 400 - and its effort defaults to medium, so screening work that
        // deserves more has to say so.
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
        fallbacks: "default",
      }),
    });
  } catch (e) {
    return { ok: false, reason: `request failed: ${e.message}` };
  }

  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).error.message; } catch { /* keep statusText */ }
    return { ok: false, reason: `Anthropic returned ${res.status}: ${detail}` };
  }

  const body = await res.json();

  // stop_reason is checked before content is read, always. A refusal has no
  // JSON to parse, and a max_tokens cut-off has HALF the JSON - which reaches
  // JSON.parse and surfaces as "Unexpected end of JSON input", a message that
  // reads like a bug here rather than a response that ran long.
  if (body.stop_reason === "refusal") {
    const cat = body.stop_details && body.stop_details.category;
    return { ok: false, reason: `the model declined${cat ? ` (${cat})` : ""}` };
  }
  if (body.stop_reason === "max_tokens") {
    return { ok: false, reason: "the ranking ran past max_tokens and was cut off" };
  }

  const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    return { ok: false, reason: `the ranking was not valid JSON: ${e.message}` };
  }
}
