import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const POLLINATIONS_URL = "https://image.pollinations.ai/prompt";
const HF_URL = "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell";

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
 * Confirms a Pollinations URL actually resolves to an image before handing
 * it back to the caller — Pollinations has no formal uptime guarantee, so
 * this quick check is what lets the Hugging Face fallback actually kick in
 * on a real outage, rather than only on hard network errors. A GET (not
 * HEAD) is used because some CDNs don't reliably support HEAD for
 * generated/on-the-fly content.
 */
async function pollinationsIsReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
  }
}

/**
 * Hugging Face fallback: unlike Pollinations, this returns actual image
 * bytes from a POST request rather than a shortcut URL, so the result is
 * base64-encoded into a data URI here — that lets the frontend keep using
 * the exact same <img src="..."> rendering path regardless of which
 * provider actually generated the image.
 */
async function generateWithHuggingFace(prompt: string): Promise<string> {
  if (!config.huggingfaceApiKey) {
    throw new Error("Hugging Face fallback is not configured.");
  }

  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.huggingfaceApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: prompt.trim() }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Hugging Face API error ${res.status}: ${errBody}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:image/jpeg;base64,${base64}`;
}

/**
 * Tries Pollinations first (free, unlimited, no key needed); if it's
 * unreachable or erroring, falls back to Hugging Face (higher quality,
 * but limited free monthly credits) so image generation keeps working
 * through a Pollinations outage rather than failing outright.
 */
export async function generateImage(prompt: string): Promise<string> {
  const pollinationsUrl = buildImageUrl(prompt);

  if (await pollinationsIsReachable(pollinationsUrl)) {
    return pollinationsUrl;
  }

  logger.error("Pollinations unreachable, falling back to Hugging Face", { prompt });
  try {
    return await generateWithHuggingFace(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Hugging Face fallback also failed", { message, prompt });
    // Both providers failed — return the Pollinations URL anyway. It may
    // recover by the time the frontend actually loads the <img>, and this
    // avoids a hard failure for what was likely a transient hiccup.
    return pollinationsUrl;
  }
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
