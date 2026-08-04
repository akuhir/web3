import pg from "pg";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

// Managed Postgres providers (Supabase, RDS, etc.) commonly present a
// certificate chain that Node's default strict TLS validation rejects as
// "self-signed" even though the connection itself is legitimate and
// encrypted. Disabling chain verification (not encryption itself) is the
// standard, documented way to connect from Node in this situation.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
});

/**
 * Idempotent schema bootstrap. Safe to run on every deploy.
 * For larger teams, replace with a real migration tool (Prisma/Knex/Flyway).
 */
export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel TEXT NOT NULL,           -- 'web' | 'whatsapp' | 'telegram' | 'messenger'
      channel_user_id TEXT NOT NULL,   -- platform-specific id (phone, chat id, psid, or session id)
      name TEXT,
      preferred_language TEXT DEFAULT 'en',
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (channel, channel_user_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      started_at TIMESTAMPTZ DEFAULT now(),
      handed_off BOOLEAN DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES conversations(id),
      role TEXT NOT NULL,             -- 'user' | 'assistant'
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      conversation_id UUID PRIMARY KEY REFERENCES conversations(id),
      summary TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS kb_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Auth columns added after the initial schema — CREATE TABLE IF NOT EXISTS
  // above won't retroactively add columns to an already-existing users
  // table, so these are applied explicitly and safely on every boot.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
  `);

  // Conversation title + last-activity timestamp, for a Claude-style chat
  // history list (title shown per conversation, sorted by recent activity).
  await pool.query(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT now();
  `);

  logger.info("Postgres schema ready");
}
