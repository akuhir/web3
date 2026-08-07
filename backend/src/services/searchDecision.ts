/**
 * Decides whether a user message likely needs current/real-time
 * information that the LLM's training data wouldn't reliably have —
 * news, prices, scores, "latest"/"current"/"today" framing, or specific
 * recent-event references. Deliberately conservative: false negatives
 * (missing a search that would have helped) are cheaper than false
 * positives (burning search quota on requests that didn't need it).
 */

const RECENCY_SIGNALS = [
  /\b(latest|current|recent|today'?s?|this (week|month|year)|right now|as of (today|now))\b/i,
  /\b(news|headlines|breaking)\b/i,
  /\b(price|stock|exchange rate|cost of)\b.*\b(now|today|currently)?\b/i,
  /\b(score|result|standings|fixtures?)\b.*\b(game|match|tournament|league)?\b/i,
  /\bwho (is|are) the (current|new)\b/i,
  /\bwhat('s| is) happening\b/i,
  /\b(202[4-9]|20[3-9]\d)\b/, // explicit year mentions, especially recent/future ones
];

const TIME_SENSITIVE_TOPICS = [
  /\belection/i,
  /\bweather\b/i,
  /\bwho (won|is winning)\b/i,
  /\brelease date\b/i,
  /\bupdate[sd]?\b.*\b(app|software|policy|law)\b/i,
];

export function needsWebSearch(message: string): boolean {
  return RECENCY_SIGNALS.some((p) => p.test(message)) || TIME_SENSITIVE_TOPICS.some((p) => p.test(message));
}
