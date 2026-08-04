import { Redis as RedisClient } from "ioredis";
import { config } from "../config.js";

export const redis = new RedisClient(config.redisUrl);

export type ChatTurn = { role: "user" | "assistant"; content: string };

const SESSION_TTL_SECONDS = 60 * 60 * 48; // 48h sliding window
const MAX_TURNS_KEPT = 20; // working memory window before summarization kicks in

const sessionKey = (conversationId: string) => `session:${conversationId}`;

/** Append a turn to this conversation's short-term session memory. */
export async function appendTurn(conversationId: string, turn: ChatTurn) {
  const key = sessionKey(conversationId);
  await redis.rpush(key, JSON.stringify(turn));
  await redis.ltrim(key, -MAX_TURNS_KEPT, -1);
  await redis.expire(key, SESSION_TTL_SECONDS);
}

/** Fetch the recent raw turns for prompt construction. */
export async function getRecentTurns(conversationId: string): Promise<ChatTurn[]> {
  const key = sessionKey(conversationId);
  const raw = await redis.lrange(key, 0, -1);
  return raw.map((r: string) => JSON.parse(r) as ChatTurn);
}

export async function turnCount(conversationId: string): Promise<number> {
  return redis.llen(sessionKey(conversationId));
}

export async function clearSession(conversationId: string) {
  await redis.del(sessionKey(conversationId));
}
