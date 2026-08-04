import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/postgres.js";
import { config } from "../config.js";

const TOKEN_EXPIRY = "30d"; // long-lived — this is a personal assistant app, not a bank

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Creates a new account. Throws AuthError if the email is already taken. */
export async function signup(email: string, password: string, name?: string): Promise<{ user: AuthUser; token: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
  if (existing.rows.length > 0) {
    throw new AuthError("An account with this email already exists.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // channel/channel_user_id keep the existing schema's unique constraint
  // happy — email-based accounts use "account" as their channel, distinct
  // from the anonymous "web" session channel used before login.
  const result = await pool.query(
    `INSERT INTO users (channel, channel_user_id, email, password_hash, name)
     VALUES ('account', $1, $1, $2, $3)
     RETURNING id, email, name`,
    [normalizedEmail, passwordHash, name ?? null]
  );

  const user = result.rows[0];
  const token = signToken(user.id);
  return { user, token };
}

/** Verifies credentials and returns a token. Throws AuthError on any mismatch. */
export async function login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  const result = await pool.query(
    `SELECT id, email, name, password_hash FROM users WHERE email = $1`,
    [normalizedEmail]
  );
  const row = result.rows[0];

  // Deliberately identical error for "no such user" and "wrong password" —
  // revealing which one it was lets an attacker enumerate valid emails.
  if (!row || !row.password_hash) {
    throw new AuthError("Incorrect email or password.");
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    throw new AuthError("Incorrect email or password.");
  }

  const token = signToken(row.id);
  return { user: { id: row.id, email: row.email, name: row.name }, token };
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: TOKEN_EXPIRY });
}

/** Verifies a token and returns the user id, or null if invalid/expired. */
export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const result = await pool.query(`SELECT id, email, name FROM users WHERE id = $1`, [userId]);
  return result.rows[0] ?? null;
}
