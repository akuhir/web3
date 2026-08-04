import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { initSchema } from "./db/postgres.js";
import { chatRouter } from "./routes/chat.js";
import { authRouter } from "./routes/auth.js";
import { chatRateLimiter } from "./middleware/rateLimit.js";

const app = express();

// Render (and most hosts) sit behind a reverse proxy — this tells Express to
// trust the X-Forwarded-For header so rate limiting sees the real client IP
// instead of erroring or rate-limiting the proxy itself.
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: config.allowedOrigins.length ? config.allowedOrigins : "*",
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Auth: signup, login, current-user lookup. No rate limiter needed at
// this scale, but the same limiter could be applied here too if abuse
// becomes a concern (e.g. brute-force login attempts).
app.use("/api/auth", authRouter);

// Web widget API — this is the only entry point the chatbot needs.
app.use("/api", chatRateLimiter, chatRouter);

// Global error handler — never leak stack traces to clients.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", { err });
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  await initSchema();
  app.listen(config.port, () => {
    logger.info(`Solograph AI backend listening on port ${config.port}`);
  });
}

start().catch((err) => {
  logger.error("Failed to start server", { err });
  process.exit(1);
});
