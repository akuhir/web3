/**
 * Lightweight English/Hausa detector.
 * Uses common Hausa function words + diacritics as signal, since generic
 * language libraries (e.g. franc) are unreliable on short chat messages.
 * Falls back to "en" when ambiguous — the LLM itself also mirrors the
 * user's language per the system prompt, so this is a hint, not gospel.
 */
const HAUSA_MARKERS = [
  "ina", "kana", "kina", "yaya", "lafiya", "nagode", "na gode", "sannu",
  "yaushe", "menene", "wanene", "don", "kuma", "amma", "ba za", "zan",
  "zai", "taimako", "don Allah", "ya kamata", "abin", "wannan", "wancan",
  "yau", "gobe", "jiya", "kudi", "nawa", "aiki", "gida", "mutum",
];

export function detectLanguage(text: string): "en" | "ha" {
  const lower = text.toLowerCase();
  let score = 0;
  for (const marker of HAUSA_MARKERS) {
    if (lower.includes(marker)) score++;
  }
  // Two or more marker hits is a solid signal for short chat messages.
  return score >= 2 ? "ha" : "en";
}
