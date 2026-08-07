import rateLimit from "express-rate-limit";

export const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,             // 20 messages per minute per IP — tune per traffic profile
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Please slow down and try again shortly." },
});
