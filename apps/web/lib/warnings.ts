import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { reasonCopy, type Lang } from "@/lib/reasons";

export type Warning = { title: string; body: string };
export type Warnings = Record<Lang, Warning> & { source: "template" | "llm" };
type Kind = "verify" | "hold";

const TITLES: Record<Kind, Record<Lang, string>> = {
  verify: { en: "Hold on a moment", ta: "ஒரு நிமிடம் நிறுத்துங்கள்" },
  hold: { en: "Payment on hold", ta: "பணப்பரிமாற்றம் நிறுத்தி வைக்கப்பட்டுள்ளது" },
};
const TAILS: Record<Kind, Record<Lang, string>> = {
  verify: {
    en: "Scammers rush you. Your bank will never ask you to move money to keep it safe.",
    ta: "மோசடி செய்பவர்கள் உங்களை அவசரப்படுத்துவார்கள். பணத்தைப் பாதுகாக்க வேறு கணக்குக்கு மாற்றச் சொல்லி வங்கி ஒருபோதும் கேட்காது.",
  },
  hold: {
    en: "Our fraud team will check it within minutes. If someone is pressuring you, cancel now.",
    ta: "எங்கள் மோசடி தடுப்புக் குழு சில நிமிடங்களில் சரிபார்க்கும். யாராவது உங்களை அவசரப்படுத்தினால், இப்போதே ரத்து செய்யுங்கள்.",
  },
};

/** Deterministic warning built from reason codes. Instant, and the fallback for the LLM. */
export function templateWarnings(kind: Kind, codes: string[]): Warnings {
  const build = (lang: Lang): Warning => {
    const reasons = codes.slice(0, 2).map((c) => reasonCopy(c, lang).title);
    const lead = reasons.length ? `${reasons.join(", ")}. ` : "";
    return { title: TITLES[kind][lang], body: `${lead}${TAILS[kind][lang]}` };
  };
  return { en: build("en"), ta: build("ta"), source: "template" };
}

const LlmOutput = z.object({
  en: z.string().min(10).max(320),
  ta: z.string().min(10).max(480),
});

const cache = new Map<string, Warnings>();

/**
 * Friendlier wording from Gemini. Only reason codes and a rounded amount go in: no names,
 * IDs or account numbers. The LLM never changes the decision; it only phrases the warning.
 */
export async function llmWarnings(kind: Kind, codes: string[], amount: number): Promise<Warnings> {
  const fallback = templateWarnings(kind, codes);
  const { GEMINI_API_KEY, GEMINI_MODEL } = env();
  if (!GEMINI_API_KEY || codes.length === 0) return fallback;

  const bucket = amount >= 100_000 ? "over ₹1 lakh" : amount >= 10_000 ? "over ₹10,000" : "a small amount";
  const key = `${kind}|${[...codes].sort().join(",")}|${bucket}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const reasons = codes.map((c) => reasonCopy(c, "en").title).join("; ");
  const prompt = [
    "You write short payment-safety warnings for a bank app in India.",
    `The payment (${bucket}) was ${kind === "hold" ? "put on hold for review" : "paused for a step-up check"}.`,
    `Risk signals: ${reasons}.`,
    "Write one calm, plain message (max 35 words) telling the customer why we paused it and that",
    "scammers create urgency. Do not invent facts, names, phone numbers or links.",
    'Reply as JSON: {"en": "<English>", "ta": "<the same message in simple Tamil>"}',
  ].join("\n");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 400, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(2500),
      },
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = LlmOutput.safeParse(JSON.parse(text ?? "null"));
    if (!parsed.success) return fallback;

    const result: Warnings = {
      en: { title: TITLES[kind].en, body: parsed.data.en },
      ta: { title: TITLES[kind].ta, body: parsed.data.ta },
      source: "llm",
    };
    if (cache.size > 500) cache.clear();
    cache.set(key, result);
    return result;
  } catch {
    return fallback;
  }
}
