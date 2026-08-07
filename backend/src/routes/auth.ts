import { Router } from "express";
import { z } from "zod";
import { signup, login, AuthError } from "../services/authService.js";
import { linkAnonymousHistoryToAccount } from "../services/userService.js";
import { requireAuth } from "../middleware/auth.js";
import { getUserById } from "../services/authService.js";
import { logger } from "../utils/logger.js";

export const authRouter = Router();

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters."),
  name: z.string().min(1).max(100).optional(),
  sessionId: z.string().optional(), // anonymous session to link history from, if any
});

authRouter.post("/signup", async (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid signup details.";
    return res.status(400).json({ error: firstError });
  }

  try {
    const { user, token } = await signup(parsed.data.email, parsed.data.password, parsed.data.name);
    if (parsed.data.sessionId) {
      await linkAnonymousHistoryToAccount(parsed.data.sessionId, user.id);
    }
    res.json({ user, token });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(409).json({ error: err.message });
    }
    logger.error("signup error", { err });
    res.status(500).json({ error: "Something went wrong creating your account." });
  }
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  sessionId: z.string().optional(),
});

authRouter.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Please enter a valid email and password." });
  }

  try {
    const { user, token } = await login(parsed.data.email, parsed.data.password);
    if (parsed.data.sessionId) {
      await linkAnonymousHistoryToAccount(parsed.data.sessionId, user.id);
    }
    res.json({ user, token });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({ error: err.message });
    }
    logger.error("login error", { err });
    res.status(500).json({ error: "Something went wrong logging in." });
  }
});

/** Returns the currently logged-in user, based on the Bearer token. */
authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.userId!);
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ user });
  } catch (err) {
    logger.error("me route error", { err });
    res.status(500).json({ error: "Something went wrong." });
  }
});
