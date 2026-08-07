import { Router } from "express";
import { z } from "zod";
import { handleUserMessage, handleUserMessageStream, handleImageMessage } from "../services/orchestrator.js";
import { isImageRequest, generateImage } from "../services/imageService.js";
import {
  getOrCreateUserAndConversation,
  getOrCreateConversationForAccount,
  getOrCreateUser,
  createConversation,
  listConversations,
  conversationBelongsToUser,
  setTitleIfMissing,
  touchConversation,
  deleteConversation,
  renameConversation,
} from "../services/userService.js";
import { pool } from "../db/postgres.js";
import { optionalAuth } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

export const chatRouter = Router();

// Every route here uses optionalAuth: if a valid Bearer token is present
// (logged-in user), req.userId is set and takes priority. If not, we fall
// back to the anonymous sessionId flow — so existing anonymous users are
// unaffected, and logging in simply upgrades them to an account.
chatRouter.use(optionalAuth);

/** Resolves which backend userId to use: logged-in account, or anonymous session. */
async function resolveUserId(req: any, sessionId: string, name?: string): Promise<string> {
  if (req.userId) return req.userId;
  return getOrCreateUser("web", sessionId, name);
}

/**
 * Resolves (or creates) which conversation this message belongs to, shared
 * by both the regular JSON chat route and the SSE streaming route so the
 * "continue this conversation vs. use/create the most recent" logic stays
 * identical between them.
 */
async function resolveConversationId(
  req: any,
  userId: string,
  sessionId: string,
  requestedConversationId: string | null | undefined,
  name?: string
): Promise<string> {
  if (requestedConversationId) {
    const owns = await conversationBelongsToUser(requestedConversationId, userId);
    if (!owns) throw new Error("FORBIDDEN_CONVERSATION");
    return requestedConversationId;
  }
  return req.userId
    ? getOrCreateConversationForAccount(userId)
    : (await getOrCreateUserAndConversation("web", sessionId, name)).conversationId;
}

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  sessionId: z.string().min(1), // used only for anonymous (logged-out) users
  // Accepts null OR a valid UUID OR omission — frontend state naturally
  // starts as null (not undefined) before a conversation exists, and
  // Zod's .optional() alone only accepts a missing key, not an explicit
  // null value, so without .nullable() every first message would 400.
  conversationId: z.string().uuid().nullable().optional(),
  name: z.string().optional(),
});

chatRouter.post("/chat", async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { message, sessionId, name } = parsed.data;

  try {
    const userId = await resolveUserId(req, sessionId, name);
    let conversationId: string;
    try {
      conversationId = await resolveConversationId(req, userId, sessionId, parsed.data.conversationId, name);
    } catch {
      return res.status(403).json({ error: "That conversation doesn't belong to you." });
    }

    await setTitleIfMissing(conversationId, message);

    // Image requests skip the LLM/moderation/memory pipeline entirely and
    // go straight to image generation — no point spending a Groq/OpenRouter
    // call on a request we're not going to answer with text anyway.
    if (isImageRequest(message)) {
      const imageUrl = await generateImage(message);
      const imageMarkerContent = `[IMAGE]${imageUrl}[/IMAGE]`;

      await pool.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
        [conversationId, message]
      );
      await pool.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
        [conversationId, imageMarkerContent]
      );
      await touchConversation(conversationId);

      return res.json({
        reply: imageMarkerContent,
        type: "image",
        imageUrl,
        conversationId,
      });
    }

    const result = await handleUserMessage(userId, conversationId, message, name);
    await touchConversation(conversationId);

    res.json({ ...result, conversationId });
  } catch (err) {
    logger.error("chat route error", { err });
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * Streaming variant of /chat, using Server-Sent Events. The client opens
 * this as an EventSource-style connection; we push small JSON-encoded
 * chunks as the reply is generated, then a final event carrying metadata
 * (conversationId, language, handoff) once the full reply is persisted.
 *
 * Image requests are NOT streamed — they return instantly as a single
 * event, since there's no token-by-token generation to show for an image.
 */
chatRouter.post("/chat/stream", async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { message, sessionId, name } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const userId = await resolveUserId(req, sessionId, name);
    let conversationId: string;
    try {
      conversationId = await resolveConversationId(req, userId, sessionId, parsed.data.conversationId, name);
    } catch {
      sendEvent("error", { error: "That conversation doesn't belong to you." });
      return res.end();
    }

    await setTitleIfMissing(conversationId, message);

    if (isImageRequest(message)) {
      const imageUrl = await generateImage(message);
      const imageMarkerContent = `[IMAGE]${imageUrl}[/IMAGE]`;

      await pool.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
        [conversationId, message]
      );
      await pool.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
        [conversationId, imageMarkerContent]
      );
      await touchConversation(conversationId);

      sendEvent("done", { reply: imageMarkerContent, type: "image", imageUrl, conversationId });
      return res.end();
    }

    const result = await handleUserMessageStream(
      userId,
      conversationId,
      message,
      (chunk) => sendEvent("token", { chunk }),
      name
    );
    await touchConversation(conversationId);

    sendEvent("done", { ...result, conversationId });
    res.end();
  } catch (err) {
    logger.error("chat stream route error", { err });
    sendEvent("error", { error: "Something went wrong. Please try again." });
    res.end();
  }
});

/** Lists all of the caller's conversations for the history sidebar. */
chatRouter.get("/conversations", async (req, res) => {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  if (!req.userId && !sessionId) {
    return res.status(400).json({ error: "Missing sessionId." });
  }

  try {
    const userId = await resolveUserId(req, sessionId);
    const conversations = await listConversations(userId);
    res.json({ conversations });
  } catch (err) {
    logger.error("conversations list error", { err });
    res.status(500).json({ error: "Could not load conversations." });
  }
});

const HistoryRequestSchema = z.object({
  sessionId: z.string().min(1),
  conversationId: z.string().uuid().optional(),
});

/** Returns the message history for a specific conversation (or the most recent one if none given). */
chatRouter.get("/history", async (req, res) => {
  const parsed = HistoryRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { sessionId } = parsed.data;

  try {
    const userId = await resolveUserId(req, sessionId);

    let conversationId = parsed.data.conversationId;
    if (conversationId) {
      const owns = await conversationBelongsToUser(conversationId, userId);
      if (!owns) return res.status(403).json({ error: "That conversation doesn't belong to you." });
    } else {
      conversationId = req.userId
        ? await getOrCreateConversationForAccount(userId)
        : (await getOrCreateUserAndConversation("web", sessionId)).conversationId;
    }

    const result = await pool.query(
      `SELECT role, content FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [conversationId]
    );
    res.json({ messages: result.rows, conversationId });
  } catch (err) {
    logger.error("history route error", { err });
    res.status(500).json({ error: "Could not load history." });
  }
});

const NewChatRequestSchema = z.object({
  sessionId: z.string().min(1),
});

/** Creates a genuinely new, empty conversation and returns its id. */
chatRouter.post("/new-chat", async (req, res) => {
  const parsed = NewChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { sessionId } = parsed.data;

  try {
    const userId = await resolveUserId(req, sessionId);
    // A brand-new conversation has a brand-new id, so it naturally has no
    // Redis session key yet — no explicit clear needed, unlike before when
    // memory was keyed by userId and could carry over between chats.
    const conversationId = await createConversation(userId);
    res.json({ ok: true, conversationId });
  } catch (err) {
    logger.error("new-chat route error", { err });
    res.status(500).json({ error: "Could not start a new chat." });
  }
});

const DeleteConversationSchema = z.object({
  sessionId: z.string().min(1),
  conversationId: z.string().uuid(),
});

/** Permanently deletes a conversation and its messages. */
chatRouter.post("/conversations/delete", async (req, res) => {
  const parsed = DeleteConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { sessionId, conversationId } = parsed.data;

  try {
    const userId = await resolveUserId(req, sessionId);
    const owns = await conversationBelongsToUser(conversationId, userId);
    if (!owns) return res.status(403).json({ error: "That conversation doesn't belong to you." });

    await deleteConversation(conversationId);
    res.json({ ok: true });
  } catch (err) {
    logger.error("delete conversation error", { err });
    res.status(500).json({ error: "Could not delete that conversation." });
  }
});

const RenameConversationSchema = z.object({
  sessionId: z.string().min(1),
  conversationId: z.string().uuid(),
  title: z.string().min(1).max(100),
});

/** Sets a user-chosen title for a conversation, overriding auto-titling. */
chatRouter.post("/conversations/rename", async (req, res) => {
  const parsed = RenameConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { sessionId, conversationId, title } = parsed.data;

  try {
    const userId = await resolveUserId(req, sessionId);
    const owns = await conversationBelongsToUser(conversationId, userId);
    if (!owns) return res.status(403).json({ error: "That conversation doesn't belong to you." });

    await renameConversation(conversationId, title);
    res.json({ ok: true });
  } catch (err) {
    logger.error("rename conversation error", { err });
    res.status(500).json({ error: "Could not rename that conversation." });
  }
});

const ImageMessageSchema = z.object({
  message: z.string().max(4000).default(""), // caption/question is optional — "what's this?" is the implicit default
  sessionId: z.string().min(1),
  conversationId: z.string().uuid().nullable().optional(),
  // Base64 data URL (e.g. "data:image/jpeg;base64,...") — validated as a
  // non-empty string here; the actual format/size is Groq's problem to
  // reject if malformed, rather than duplicating that validation here.
  image: z.string().min(1),
  name: z.string().optional(),
});

/**
 * Handles a message with an uploaded image attached (vision request).
 * Separate from /chat because the request/response shape and processing
 * path are meaningfully different (no streaming, no web search, routed to
 * a vision-capable model) — keeping it a distinct endpoint is clearer than
 * overloading /chat with an optional image field.
 */
chatRouter.post("/chat/image", async (req, res) => {
  const parsed = ImageMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { message, sessionId, image, name } = parsed.data;

  try {
    const userId = await resolveUserId(req, sessionId, name);
    let conversationId: string;
    try {
      conversationId = await resolveConversationId(req, userId, sessionId, parsed.data.conversationId, name);
    } catch {
      return res.status(403).json({ error: "That conversation doesn't belong to you." });
    }

    const captionForTitle = message || "Image";
    await setTitleIfMissing(conversationId, captionForTitle);

    const result = await handleImageMessage(userId, conversationId, message, image, name);
    await touchConversation(conversationId);

    res.json({ ...result, conversationId });
  } catch (err) {
    logger.error("image chat route error", { err });
    res.status(500).json({ error: "Something went wrong analyzing that image. Please try again." });
  }
});
