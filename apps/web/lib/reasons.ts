// Reason codes come from the scorer (services/scorer/scorer/reasons.py).
// The scorer never sends prose; all wording lives here, in English and Tamil.

export type Lang = "en" | "ta";
export type Reason = { code: string; weight: number };

type Copy = { title: string; detail: string };

export const REASON_COPY: Record<string, Record<Lang, Copy>> = {
  NEW_PAYEE: {
    en: { title: "New payee", detail: "This customer has never paid this account before." },
    ta: { title: "புதிய பெறுநர்", detail: "இவருக்கு நீங்கள் இதற்கு முன் பணம் அனுப்பியதில்லை." },
  },
  AMOUNT_SPIKE: {
    en: { title: "Amount far above usual", detail: "Several times larger than this customer's normal payments." },
    ta: { title: "வழக்கத்தை விட மிக அதிகமான தொகை", detail: "உங்கள் வழக்கமான பரிவர்த்தனைகளை விட பல மடங்கு அதிகம்." },
  },
  HIGH_AMOUNT: {
    en: { title: "Large amount", detail: "A high-value payment." },
    ta: { title: "பெரிய தொகை", detail: "அதிக மதிப்புள்ள பரிவர்த்தனை." },
  },
  ODD_HOUR: {
    en: { title: "Odd hour", detail: "Sent late at night, when scam calls peak." },
    ta: { title: "வழக்கத்திற்கு மாறான நேரம்", detail: "இரவு நேரத்தில் அனுப்பப்படுகிறது." },
  },
  BALANCE_DRAIN: {
    en: { title: "Empties the account", detail: "Moves most of the available balance in one go." },
    ta: { title: "கணக்கை காலி செய்கிறது", detail: "உங்கள் இருப்பின் பெரும்பகுதியை ஒரே முறையில் அனுப்புகிறது." },
  },
  HIGH_VELOCITY: {
    en: { title: "Many payments in a short time", detail: "Several payments from this account in the last hour." },
    ta: { title: "குறுகிய நேரத்தில் பல பரிவர்த்தனைகள்", detail: "கடந்த ஒரு மணி நேரத்தில் பல பரிவர்த்தனைகள்." },
  },
  UNKNOWN_PAYEE: {
    en: { title: "Payee has no history", detail: "This account has never received money before." },
    ta: { title: "பெறுநருக்கு எந்த வரலாறும் இல்லை", detail: "இந்தக் கணக்கு இதற்கு முன் பணம் பெற்றதில்லை." },
  },
  MULE_PATTERN: {
    en: { title: "Payee collecting from many people", detail: "Several different people paid this account today." },
    ta: { title: "பலரிடமிருந்து பணம் பெறும் கணக்கு", detail: "இன்று பலர் இந்தக் கணக்குக்கு பணம் அனுப்பியுள்ளனர்." },
  },
  THIN_HISTORY: {
    en: { title: "Little account history", detail: "Too few past payments to know what is normal." },
    ta: { title: "குறைந்த கணக்கு வரலாறு", detail: "வழக்கமானது எது என்று அறிய போதுமான வரலாறு இல்லை." },
  },
  RISKY_TYPE: {
    en: { title: "Transfer type common in scams", detail: "Direct transfers and cash-outs carry most scam losses." },
    ta: { title: "மோசடிகளில் பொதுவான பரிவர்த்தனை வகை", detail: "நேரடி பரிமாற்றங்களில் தான் பெரும்பாலான மோசடி இழப்புகள் நடக்கின்றன." },
  },
};

export function reasonCopy(code: string, lang: Lang = "en"): Copy {
  return REASON_COPY[code]?.[lang] ?? { title: code.replaceAll("_", " ").toLowerCase(), detail: "" };
}

export function parseReasons(value: unknown): Reason[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is Reason => typeof r === "object" && r !== null && typeof r.code === "string" && typeof r.weight === "number",
  );
}
