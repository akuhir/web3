import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const TAVILY_URL = "https://api.tavily.com/search";
const SERPER_URL = "https://google.serper.dev/search";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
};

export class WebSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchError";
  }
}

/**
 * Runs a web search via Tavily first (built specifically for feeding
 * clean, LLM-ready results into a model); if Tavily is unconfigured or
 * fails, falls back to Serper (real Google results via a clean JSON API)
 * so a single provider outage or exhausted quota doesn't take search
 * out entirely. Returns a small, uniform result shape regardless of
 * which provider actually answered, so the rest of the app never needs
 * to know which one was used.
 */
export async function searchWeb(query: string, maxResults = 5): Promise<SearchResult[]> {
  if (config.tavilyApiKey) {
    try {
      return await searchTavily(query, maxResults);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Tavily search failed, falling back to Serper", { message, query });
    }
  }

  if (config.serperApiKey) {
    return searchSerper(query, maxResults);
  }

  throw new WebSearchError("Web search is not configured.");
}

async function searchTavily(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.tavilyApiKey,
        query,
        search_depth: "basic", // cheapest tier — 1 credit per call on the free plan
        max_results: maxResults,
        include_answer: false,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new WebSearchError(`Tavily API error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    return results.map((r: any) => ({
      title: r.title ?? "Untitled",
      url: r.url ?? "",
      snippet: (r.content ?? "").slice(0, 500), // keep prompt size bounded
      publishedDate: r.published_date || undefined,
    }));
  } catch (err) {
    if (err instanceof WebSearchError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new WebSearchError(`Tavily request failed: ${message}`);
  }
}

/**
 * Serper returns real Google search results via a simple JSON API — used
 * only as a fallback since Tavily's snippets are purpose-built for LLM
 * consumption and generally cleaner. Serper's free allowance is a
 * one-time 2,500 queries (not a recurring monthly quota), so this should
 * only be reached occasionally, when Tavily itself is unavailable.
 */
async function searchSerper(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const res = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": config.serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: maxResults }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new WebSearchError(`Serper API error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const organic = Array.isArray(data?.organic) ? data.organic : [];

    return organic.slice(0, maxResults).map((r: any) => ({
      title: r.title ?? "Untitled",
      url: r.link ?? "",
      snippet: (r.snippet ?? "").slice(0, 500),
      publishedDate: r.date || undefined,
    }));
  } catch (err) {
    if (err instanceof WebSearchError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Serper search also failed", { message, query });
    throw new WebSearchError("Web search failed on all providers.");
  }
}

/**
 * Formats search results into a labeled context block for the LLM prompt,
 * plus a separate lightweight list the frontend can render as source links
 * (title + URL only, no snippet — the snippet's job is done once the model
 * has used it to write the answer).
 */
export function formatSearchContext(results: SearchResult[]): string {
  if (results.length === 0) return "";
  return (
    "WEB SEARCH RESULTS (current information — use this to answer if relevant; " +
    "cite naturally rather than copying text verbatim):\n" +
    results
      .map((r, i) => {
        const dateNote = r.publishedDate ? ` (${r.publishedDate})` : "";
        return `[${i + 1}] ${r.title}${dateNote}\n${r.snippet}\nSource: ${r.url}`;
      })
      .join("\n\n")
  );
}

export function toSourceList(results: SearchResult[]): { title: string; url: string }[] {
  return results.map((r) => ({ title: r.title, url: r.url }));
}
