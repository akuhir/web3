const POLLINATIONS_URL = "https://image.pollinations.ai/prompt";

/**
 * Builds a direct image URL from Pollinations' free, keyless endpoint.
 * No fetch/download needed server-side — the URL itself is the image;
 * the frontend just renders it in an <img> tag.
 */
export function buildImageUrl(prompt: string): string {
  const encodedPrompt = encodeURIComponent(prompt.trim());
  const params = new URLSearchParams({
    width: "1024",
    height: "1024",
    nologo: "true",
    // A random seed per request avoids Pollinations caching/returning the
    // exact same image for repeated similar prompts.
    seed: String(Math.floor(Math.random() * 1_000_000_000)),
  });
  return `${POLLINATIONS_URL}/${encodedPrompt}?${params.toString()}`;
}

/**
 * Detects genuine image-generation requests, distinct from ordinary use of
 * words like "make" or "create" in non-image contexts (e.g. "make a study
 * plan", "create an outline"). Requires an explicit visual-creation verb
 * paired with an explicit visual-content noun, rather than matching either
 * alone — this avoids the false-positive problem a plain keyword list has.
 */
const VISUAL_VERBS = /\b(draw|generate|create|make|design|render|paint|sketch|show me)\b/i;
const VISUAL_NOUNS = /\b(image|picture|photo|illustration|drawing|artwork|painting|poster|logo|icon|wallpaper|avatar|graphic)\b/i;

export function isImageRequest(message: string): boolean {
  return VISUAL_VERBS.test(message) && VISUAL_NOUNS.test(message);
}
