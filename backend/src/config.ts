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
  groqModel: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",

  // Fallback provider — optional. If not set, Groq failures surface
  // directly instead of retrying elsewhere.
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterModel: process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free",

  // Web search — optional. If not set, the app never attempts a search
  // and behaves exactly as before (LLM answers from its own knowledge).
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",

  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),

  jwtSecret: required("JWT_SECRET"),

  pinecone: {
    apiKey: process.env.PINECONE_API_KEY ?? "",
    index: process.env.PINECONE_INDEX ?? "",
  },

  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
};
