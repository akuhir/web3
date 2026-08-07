import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    // Fail fast at boot rather than crashing mid-request later.
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  nodeEnv: process.env.NODE_ENV ?? "development",

  groqApiKey: required("GROQ_API_KEY"),
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
  // Separate model for image-containing requests — the default text model
  // above is not multimodal, so vision requests are routed to this one
  // specifically, only when an image is actually attached.
  // Vision requests need a multimodal model — the standard text model
  // above doesn't support images. qwen/qwen3.6-27b is currently the only
  // vision-capable model Groq offers (their other current recommendation,
  // gpt-oss-120b, doesn't support image input at all). Note: Groq serves
  // this as a preview model, meaning it could be discontinued with little
  // notice — if image uploads start failing, check console.groq.com/docs/models
  // for a current replacement.
  groqVisionModel: process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.6-27b",

  // Fallback provider — optional. If not set, Groq failures surface
  // directly instead of retrying elsewhere.
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterModel: process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free",

  // Web search — optional. If not set, the app never attempts a search
  // and behaves exactly as before (LLM answers from its own knowledge).
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  // Fallback web search — optional. Used only if Tavily is unconfigured
  // or fails. Free tier is a one-time 2,500 queries, not monthly.
  serperApiKey: process.env.SERPER_API_KEY ?? "",

  // Image generation fallback — optional. If not set, image generation
  // relies entirely on Pollinations with no fallback on outage.
  huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY ?? "",

  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),

  jwtSecret: required("JWT_SECRET"),

  pinecone: {
    apiKey: process.env.PINECONE_API_KEY ?? "",
    index: process.env.PINECONE_INDEX ?? "",
  },

  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
};
