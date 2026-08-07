import { pool } from "../db/postgres.js";

export type Channel = "web" | "whatsapp" | "telegram" | "messenger";

export type ConversationSummary = {
  id: string;
  title: string | null;
  lastMessageAt: string;
};

/** Find or create a user by channel + external id (anonymous web session, or messaging platform). */
export async function getOrCreateUser(channel: Channel, channelUserId: string, name?: string): Promise<string> {
  const userResult = await pool.query(
    `INSERT INTO users (channel, channel_user_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (channel, channel_user_id)
     DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name)
     RETURNING id`,
    [channel, channelUserId, name ?? null]
  );
  return userResult.rows[0].id;
}

/** Backward-compatible helper: get-or-create user, plus their most recent (or a new) conversation. */
export async function getOrCreateUserAndConversation(
  channel: Channel,
  channelUserId: string,
  name?: string
): Promise<{ userId: string; conversationId: string }> {
  const userId = await getOrCreateUser(channel, channelUserId, name);
  const conversationId = await getOrCreateMostRecentConversation(userId);
  return { userId, conversationId };
}

export async function getOrCreateConversationForAccount(userId: string): Promise<string> {
  return getOrCreateMostRecentConversation(userId);
}

async function getOrCreateMostRecentConversation(userId: string): Promise<string> {
  const existing = await pool.query(
    `SELECT id FROM conversations WHERE user_id = $1 ORDER BY last_message_at DESC LIMIT 1`,
    [userId]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }
  return createConversation(userId);
}

/** Always creates a genuinely new, empty conversation — used by "New chat". */
export async function createConversation(userId: string): Promise<string> {
  const created = await pool.query(
    `INSERT INTO conversations (user_id) VALUES ($1) RETURNING id`,
    [userId]
  );
  return created.rows[0].id;
}

/** Lists all of a user's conversations, most recently active first, for the history sidebar. */
export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const result = await pool.query(
    `SELECT id, title, last_message_at
     FROM conversations
     WHERE user_id = $1
     ORDER BY last_message_at DESC
     LIMIT 100`,
    [userId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    lastMessageAt: r.last_message_at,
  }));
}

/** Confirms a conversation belongs to this user before letting them load/use it. */
export async function conversationBelongsToUser(conversationId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  return result.rows.length > 0;
}

/**
 * Sets a conversation's title from its first user message if it doesn't
 * have one yet — mirrors how Claude/ChatGPT auto-title new chats. Keeps
 * it short since it's just a sidebar label, not a summary.
 */
export async function setTitleIfMissing(conversationId: string, firstMessage: string): Promise<void> {
  const title = firstMessage.trim().slice(0, 60) + (firstMessage.trim().length > 60 ? "…" : "");
  await pool.query(
    `UPDATE conversations SET title = $1 WHERE id = $2 AND title IS NULL`,
    [title, conversationId]
  );
}

export async function touchConversation(conversationId: string): Promise<void> {
  await pool.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId]);
}

/**
 * Deletes a conversation and its messages/summary. Caller must verify
 * ownership via conversationBelongsToUser before calling this — this
 * function itself doesn't re-check, to avoid a redundant query when the
 * caller has already confirmed it.
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  await pool.query(`DELETE FROM messages WHERE conversation_id = $1`, [conversationId]);
  await pool.query(`DELETE FROM conversation_summaries WHERE conversation_id = $1`, [conversationId]);
  await pool.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
}

/** Sets a conversation's title explicitly (user-requested rename, overrides auto-titling). */
export async function renameConversation(conversationId: string, newTitle: string): Promise<void> {
  const trimmed = newTitle.trim().slice(0, 100);
  await pool.query(`UPDATE conversations SET title = $1 WHERE id = $2`, [trimmed, conversationId]);
}

/**
 * Moves an anonymous "web" session's conversations onto a newly created
 * or logged-in account, so history isn't lost when someone signs up after
 * chatting anonymously. Safe to call even if the anonymous user has no
 * conversations yet (no-op in that case).
 */
export async function linkAnonymousHistoryToAccount(sessionId: string, accountUserId: string): Promise<void> {
  const anonUser = await pool.query(
    `SELECT id FROM users WHERE channel = 'web' AND channel_user_id = $1`,
    [sessionId]
  );
  if (anonUser.rows.length === 0) return; // nothing to link

  const anonUserId = anonUser.rows[0].id;
  if (anonUserId === accountUserId) return; // already the same user, nothing to do

  await pool.query(
    `UPDATE conversations SET user_id = $1 WHERE user_id = $2`,
    [accountUserId, anonUserId]
  );
}
