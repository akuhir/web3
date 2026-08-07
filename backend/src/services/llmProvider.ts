import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Content can be plain text (the normal case) or a multimodal array for
// vision requests — OpenAI-compatible APIs (Groq, OpenRouter) both accept
// this same shape: [{type: "text", text}, {type: "image_url", image_url}].
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string | LlmContentPart[];
};

/**
 * Streaming variant for the chat path — calls onToken as each chunk of
 * text arrives, and returns the full assembled reply at the end (so
 * callers that need to persist/summarize the complete text still can).
 * Same Groq-primary, OpenRouter-fallback behavior as callLlm, but the
 * fallback can only kick in before any tokens have been streamed to the
 * client — once we've started streaming Groq's response, switching
 * providers mid-stream isn't possible without confusing partial output.
 */
export async function streamLlm(
  messages: LlmMessage[],
  maxTokens: number,
  onToken: (chunk: string) => void
): Promise<string> {
  try {
    return await streamProvider(GROQ_URL, config.groqApiKey, config.groqModel, messages, maxTokens, onToken);
  } catch (groqErr) {
    const groqMessage = groqErr instanceof Error ? groqErr.message : String(groqErr);
    logger.error("Groq stream failed, falling back to OpenRouter", { groqMessage });

    if (!config.openrouterApiKey) throw groqErr;

    try {
      return await streamProvider(
        OPENROUTER_URL,
        config.openrouterApiKey,
        config.openrouterModel,
        messages,
        maxTokens,
        onToken
      );
    } catch (openrouterErr) {
      const openrouterMessage = openrouterErr instanceof Error ? openrouterErr.message : String(openrouterErr);
      logger.error("OpenRouter stream fallback also failed", { openrouterMessage });
      throw groqErr;
    }
  }
}

async function streamProvider(
  url: string,
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  maxTokens: number,
  onToken: (chunk: string) => void
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
  });

  if (!res.ok || !res.body) {
    const errBody = res.body ? await res.text() : "no response body";
    throw new Error(`${url} error ${res.status}: ${errBody}`);
  }

  // Groq and OpenRouter both stream OpenAI-style Server-Sent Events: lines
  // prefixed "data: {json}", ending in "data: [DONE]". We parse that here
  // and re-emit just the text deltas via onToken as they arrive.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep the last, possibly-incomplete line for next chunk

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;

      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onToken(delta);
        }
      } catch {
        // Ignore malformed/partial JSON chunks — shouldn't normally happen
        // with a well-formed SSE stream, but don't crash the whole reply
        // over one bad line.
      }
    }
  }

  if (!fullText) throw new Error("Empty streamed response");
  return fullText;
}

/**
 * Calls Groq first; if that fails for any reason (quota, downtime, bad
 * response), automatically retries the same request against OpenRouter's
 * free tier before giving up. Both APIs are OpenAI-compatible, so the
 * request/response shape is identical — only the URL, key, and model
 * differ between providers.
 */
export async function callLlm(messages: LlmMessage[], maxTokens: number): Promise<string> {
  try {
    return await callProvider(GROQ_URL, config.groqApiKey, config.groqModel, messages, maxTokens);
  } catch (groqErr) {
    const groqMessage = groqErr instanceof Error ? groqErr.message : String(groqErr);
    logger.error("Groq call failed, falling back to OpenRouter", { groqMessage });

    if (!config.openrouterApiKey) {
      // No fallback configured — surface the original Groq failure.
      throw groqErr;
    }

    try {
      return await callProvider(
        OPENROUTER_URL,
        config.openrouterApiKey,
        config.openrouterModel,
        messages,
        maxTokens
      );
    } catch (openrouterErr) {
      const openrouterMessage = openrouterErr instanceof Error ? openrouterErr.message : String(openrouterErr);
      logger.error("OpenRouter fallback also failed", { openrouterMessage });
      // Both providers failed — throw the original Groq error, since that's
      // the primary path and most informative for debugging.
      throw groqErr;
    }
  }
}

async function callProvider(
  url: string,
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  maxTokens: number
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${url} error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error("Empty model response");
  return reply;
}

/**
 * Calls Groq's vision-capable model directly for image-containing
 * requests. Kept separate from callLlm/streamLlm rather than folded into
 * the OpenRouter-fallback logic there — vision is a narrower, less
 * frequent path, and OpenRouter's free-tier vision model availability is
 * less predictable, so a direct call with a clear error on failure is
 * more honest than a fallback that might silently degrade image
 * understanding quality.
 */
export async function callVisionLlm(messages: LlmMessage[], maxTokens: number): Promise<string> {
  return callProvider(GROQ_URL, config.groqApiKey, config.groqVisionModel, messages, maxTokens);
}
