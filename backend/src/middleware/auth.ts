import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/authService.js";

// Extends Express's Request type so downstream handlers can read req.userId
// without casting — declared once here, used everywhere via import.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Attaches req.userId if a valid Bearer token is present, but does NOT
 * reject the request if it's missing/invalid. Use this on routes that
 * should work for both logged-in and anonymous users (e.g. chat), so
 * existing anonymous sessions keep working exactly as before.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7);
    const userId = verifyToken(token);
    if (userId) req.userId = userId;
  }
  next();
}

/**
 * Rejects the request with 401 if there's no valid token. Use this on
 * routes that genuinely require a logged-in account.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const userId = token ? verifyToken(token) : null;

  if (!userId) {
    return res.status(401).json({ error: "Please log in to continue." });
  }
  req.userId = userId;
  next();
}
