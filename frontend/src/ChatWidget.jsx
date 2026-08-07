import React, { useState, useRef, useEffect } from "react";
import { API_BASE, getSessionId, authHeaders } from "./auth.js";
import profilePhoto from "./assets/profile.jpg";

const APP_NAME = "Solograph AI";

const WELCOME_MESSAGE = {
  role: "assistant",
  content: `Hi! I'm ${APP_NAME}. How can I help you today?`,
};

// Shown only on a genuinely empty conversation (just the welcome message),
// mirroring the capabilities listed in the About panel so new users can
// see what the app can actually do instead of facing a blank input.
const SUGGESTION_CHIPS = [
  { label: "Explain a topic", prompt: "Can you explain " },
  { label: "Help me write something", prompt: "Help me write " },
  { label: "Solve a problem", prompt: "Help me solve this problem: " },
  { label: "Coding help", prompt: "I need help with some code: " },
];

// Backend embeds generated images as [IMAGE]url[/IMAGE] inside the stored
// message content, so history loading needs no separate image field —
// this just extracts the URL for rendering, same shape for live replies
// and reloaded history.
function extractImageUrl(content) {
  const match = /^\[IMAGE\](.+)\[\/IMAGE\]$/.exec(content?.trim() || "");
  return match ? match[1] : null;
}

// Recognizes the model's card content (prompts, code, essays, guides,
// templates, etc.) wrapped as [CARD title="..."]...[/CARD]. Splits the
// message into an ordered list of segments — plain text and cards — so
// surrounding conversation renders normally while card content renders in
// its own component. Handles the streaming case where a card has been
// opened but not yet closed (content still arriving) by treating the
// trailing open card as "still streaming" rather than dropping it.
const CARD_OPEN_RE = /\[CARD\s+title="([^"]*)"\]/;

function parseMessageSegments(content, streamComplete) {
  if (!content) return [];
  const segments = [];
  let remaining = content;

  while (remaining.length > 0) {
    const openMatch = CARD_OPEN_RE.exec(remaining);
    if (!openMatch) {
      segments.push({ type: "text", content: remaining });
      break;
    }

    const beforeCard = remaining.slice(0, openMatch.index);
    if (beforeCard.trim()) segments.push({ type: "text", content: beforeCard });

    const afterOpenTag = remaining.slice(openMatch.index + openMatch[0].length);
    const closeIdx = afterOpenTag.indexOf("[/CARD]");

    if (closeIdx === -1) {
      // No closing tag found in the text yet. If the overall message has
      // actually finished streaming (e.g. the model hit its token limit
      // before writing [/CARD]), treat the card as complete anyway rather
      // than showing a "still generating" indicator forever on content
      // that will never grow further.
      segments.push({ type: "card", title: openMatch[1], content: afterOpenTag, streaming: !streamComplete });
      break;
    }

    segments.push({
      type: "card",
      title: openMatch[1],
      content: afterOpenTag.slice(0, closeIdx),
      streaming: false,
    });
    remaining = afterOpenTag.slice(closeIdx + "[/CARD]".length);
  }

  return segments;
}

// Very rough language guess from the first line of a code block, purely
// for the card header label — not used for actual syntax highlighting
// logic, just a small "Python" / "JavaScript" hint if it's obvious.
function guessCodeLanguage(content) {
  const trimmed = content.trim();
  const fenceMatch = /^```(\w+)/.exec(trimmed);
  if (fenceMatch) return fenceMatch[1];
  const firstLine = trimmed.split("\n")[0] || "";
  if (/^(def |import |from .+ import)/.test(firstLine)) return "python";
  if (/^(function|const|let|var|import .+ from)/.test(firstLine)) return "javascript";
  if (/^#include/.test(firstLine)) return "c";
  if (/^public class/.test(firstLine)) return "java";
  return null;
}

// Strips a leading/trailing ```lang fence if the model wrapped the card
// content in one anyway (harmless if it does; this just avoids showing
// the backtick fence characters inside the card).
function stripCodeFence(content) {
  const trimmed = content.trim();
  const fenced = /^```[\w]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

// Turns **bold** segments within a single line into <strong> elements.
// Kept intentionally minimal — matches only what the system prompt asks
// the model to produce, not a general-purpose markdown spec.
function renderInline(text, keyPrefix) {
  // Split on **bold** first (checked first since it's a longer match),
  // then *italic* within the remaining plain segments. Any leftover lone
  // asterisk that isn't part of a valid pair gets silently dropped rather
  // than shown as a literal "*" character — the model occasionally leaves
  // a stray one, and showing it looks like a rendering bug.
  const boldSplit = text.split(/(\*\*[^*]+\*\*)/g);
  return boldSplit.flatMap((part, i) => {
    const boldMatch = /^\*\*([^*]+)\*\*$/.exec(part);
    if (boldMatch) {
      return [
        <span key={`${keyPrefix}-b${i}`} style={styles.mdBold}>
          {boldMatch[1]}
        </span>,
      ];
    }

    // No bold here — check this plain segment for *italic* runs.
    const italicSplit = part.split(/(\*[^*]+\*)/g);
    return italicSplit.map((sub, j) => {
      const italicMatch = /^\*([^*]+)\*$/.exec(sub);
      if (italicMatch) {
        return (
          <em key={`${keyPrefix}-i${i}-${j}`} style={styles.mdItalic}>
            {italicMatch[1]}
          </em>
        );
      }
      // Strip any remaining unpaired asterisks rather than displaying them.
      const cleaned = sub.replace(/\*/g, "");
      return cleaned ? <React.Fragment key={`${keyPrefix}-t${i}-${j}`}>{cleaned}</React.Fragment> : null;
    });
  });
}

/**
 * Lightweight markdown renderer for chat bubbles. Covers exactly what the
 * system prompt asks the model to produce — bold text, numbered lists,
 * and bullet points — rather than pulling in a full markdown library for
 * a narrow, known set of formatting.
 */
function MarkdownText({ content }) {
  const lines = content.split("\n");
  const blocks = [];
  let currentList = null; // { type: 'ol' | 'ul', items: [{ text, children: [] }] }

  function flushList() {
    if (!currentList) return;
    const Tag = currentList.type;
    const isBulleted = currentList.type === "ul";
    blocks.push(
      <Tag
        key={`list-${blocks.length}`}
        style={isBulleted ? styles.mdList : { ...styles.mdList, paddingLeft: 20, listStyle: "decimal" }}
      >
        {currentList.items.map((item, i) => (
          <li key={i} style={styles.mdListItem}>
            {isBulleted && <span style={styles.mdBulletDot} />}
            {renderInline(item.text, `li-${blocks.length}-${i}`)}
            {item.children && item.children.length > 0 && (
              <ul style={{ ...styles.mdList, marginTop: 4 }}>
                {item.children.map((child, ci) => (
                  <li key={ci} style={styles.mdListItem}>
                    <span style={styles.mdBulletDot} />
                    {renderInline(child, `li-${blocks.length}-${i}-${ci}`)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </Tag>
    );
    currentList = null;
  }

  lines.forEach((line, idx) => {
    // Headings (# / ## / ###) get distinct weight/size so long essays and
    // guides have real visual hierarchy — heading bolder/larger than
    // subheading, both bolder than normal bulleted/numbered text.
    const h1Match = /^#\s+(.+)$/.exec(line);
    const h2Match = /^##\s+(.+)$/.exec(line);
    const h3Match = /^###\s+(.+)$/.exec(line);
    // A short standalone line ending in ":" is also treated as a
    // subheading — the model often writes section labels this way
    // ("Key Steps:", "Summary:") without using literal # marks.
    const colonHeadingMatch = /^([A-Z][A-Za-z0-9 '&/-]{2,40}):\s*$/.exec(line.trim());

    const numberedMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    // Bullets are only indented under the current numbered item if the
    // line itself is indented (starts with whitespace) — a bullet at the
    // start of the line (no leading space) is treated as its own separate
    // bulleted list, not nested under a number.
    const indentedBulletMatch = /^\s+[-•*]\s+(.*)$/.exec(line);
    const bulletMatch = /^[-•*]\s+(.*)$/.exec(line);

    if (h1Match) {
      flushList();
      blocks.push(
        <div key={`h1-${idx}`} style={styles.mdHeading}>
          {renderInline(h1Match[1], `h1-${idx}`)}
        </div>
      );
    } else if (h2Match || h3Match) {
      flushList();
      const text = (h2Match || h3Match)[1];
      blocks.push(
        <div key={`h2-${idx}`} style={styles.mdSubheading}>
          {renderInline(text, `h2-${idx}`)}
        </div>
      );
    } else if (colonHeadingMatch) {
      flushList();
      blocks.push(
        <div key={`ch-${idx}`} style={styles.mdSubheading}>
          {renderInline(line.trim(), `ch-${idx}`)}
        </div>
      );
    } else if (numberedMatch) {
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push({ text: numberedMatch[1], children: [] });
    } else if (indentedBulletMatch && currentList && currentList.type === "ol") {
      // Nest under the most recent numbered item instead of starting a
      // new, separate bulleted list — this is what keeps the numbered
      // list continuous (1, 2, 3...) instead of resetting to "1." every
      // time a sub-bullet interrupts it.
      const lastItem = currentList.items[currentList.items.length - 1];
      lastItem.children.push(indentedBulletMatch[1]);
    } else if (bulletMatch) {
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push({ text: bulletMatch[1], children: [] });
    } else {
      flushList();
      if (line.trim() === "") {
        blocks.push(<div key={`br-${idx}`} style={{ height: 8 }} />);
      } else {
        blocks.push(
          <div key={`line-${idx}`} style={styles.mdLine}>
            {renderInline(line, `line-${idx}`)}
          </div>
        );
      }
    }
  });
  flushList();

  return <>{blocks}</>;
}

// A response is treated as "code" for rendering purposes (monospace font,
// dark inset block, no markdown list/bold parsing) if its title says so
// or the content itself looks like source code — otherwise it renders
// through the same MarkdownText path as normal prose cards.
function looksLikeCode(title, content) {
  if (/\bcode\b/i.test(title)) return true;
  const codeSignals = /^```|;\s*$|^\s*(function|def |class |import |const |let |var |#include|public |private )/m;
  return codeSignals.test(content);
}

/**
 * Renders reusable AI output (prompts, code, essays, guides, templates,
 * study notes, step-by-step instructions) in a distinct card, separate
 * from the normal chat bubble flow — mirrors the "writing card" pattern
 * from ChatGPT-style interfaces. Content streams in live if the card is
 * still being generated (title/content grow as tokens arrive).
 */
function ResponseCard({ title, content, streaming }) {
  const [copied, setCopied] = useState(false);
  const isCode = looksLikeCode(title, content);
  const displayContent = isCode ? stripCodeFence(content) : content;
  const language = isCode ? guessCodeLanguage(content) : null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (permissions, insecure context) —
      // silently no-op rather than showing a broken error state for a
      // secondary action.
    }
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: displayContent });
      } catch {
        // User cancelled the share sheet, or share isn't actually
        // supported despite the API existing — not an error to surface.
      }
    } else {
      handleCopy(); // graceful fallback on browsers without the Web Share API
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.cardTitle}>{title || "Response"}</span>
        <div style={styles.cardActions}>
          <button style={styles.cardActionBtn} onClick={handleCopy} aria-label="Copy">
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          {typeof navigator !== "undefined" && (
            <button style={styles.cardActionBtn} onClick={handleShare} aria-label="Share">
              <ShareIcon />
            </button>
          )}
        </div>
      </div>
      <div style={styles.cardBody}>
        {language && <div style={styles.cardLangTag}>{language}</div>}
        {isCode ? (
          <pre style={styles.cardCode}>
            <code>{displayContent}</code>
          </pre>
        ) : (
          <div style={styles.cardProse}>
            <MarkdownText content={displayContent} />
          </div>
        )}
        {streaming && <span style={styles.cardStreamingDot} />}
      </div>
    </div>
  );
}

// Falls back to the raw URL string if it's malformed rather than throwing —
// used only as a display label when a search result has no title.
function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatConversationDate(iso) {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ChatWidget({ user, onLogout, onLoginRequested }) {
  const [messages, setMessages] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [conversations, setConversations] = useState([]);
  const [contextMenu, setContextMenu] = useState(null); // { type: 'text'|'image', index, x, y, content, imageUrl }
  const [convoMenu, setConvoMenu] = useState(null); // { conversationId, x, y }
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [editImageState, setEditImageState] = useState(null); // { originalPrompt, index }
  const [toast, setToast] = useState("");
  const [pendingImage, setPendingImage] = useState(null); // { dataUrl, name } or null
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const longPressTimer = useRef(null);

  async function loadHistory(targetConversationId) {
    setHistoryLoaded(false);
    try {
      const params = new URLSearchParams({ sessionId: getSessionId() });
      if (targetConversationId) params.set("conversationId", targetConversationId);
      const res = await fetch(`${API_BASE}/history?${params.toString()}`, {
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("history fetch failed");
      const data = await res.json();
      setConversationId(data.conversationId ?? targetConversationId ?? null);
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages.map((m) => ({ role: m.role, content: m.content, streamComplete: true })));
      } else {
        setMessages([WELCOME_MESSAGE]);
      }
    } catch {
      setMessages([WELCOME_MESSAGE]);
    } finally {
      setHistoryLoaded(true);
    }
  }

  async function loadConversationList() {
    try {
      const params = new URLSearchParams({ sessionId: getSessionId() });
      const res = await fetch(`${API_BASE}/conversations?${params.toString()}`, {
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("conversations fetch failed");
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      // Non-fatal — sidebar just shows empty/stale list if this fails.
    }
  }

  // On first load, restore the most recent conversation and the sidebar list.
  useEffect(() => {
    loadHistory();
    loadConversationList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tracks real browser connectivity so the offline banner reflects actual
  // network state, not just failed requests — catches the case where the
  // connection drops before the user tries to send anything.
  useEffect(() => {
    function handleOnline() {
      setIsOffline(false);
      // Reconnected — refresh in case anything changed while offline.
      loadConversationList();
    }
    function handleOffline() {
      setIsOffline(true);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  async function sendMessage(retryText, retryUserIndex) {
    const text = retryText ?? input.trim();
    if (!text || loading) return;

    let assistantIndex;
    if (retryText !== undefined) {
      // Retrying: reuse the existing user message, clear its failed flag,
      // and reset/reuse the assistant slot right after it instead of
      // appending new rows to the end of the conversation.
      setMessages((m) => {
        const next = [...m];
        if (next[retryUserIndex]) next[retryUserIndex] = { ...next[retryUserIndex], failed: false };
        return next;
      });
      assistantIndex = retryUserIndex + 1;
      setMessages((m) => {
        const next = [...m];
        next[assistantIndex] = { role: "assistant", content: "" };
        return next;
      });
    } else {
      setMessages((m) => [...m, { role: "user", content: text }]);
      setInput("");
      assistantIndex = messages.length + 1;
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
    }
    setLoading(true);

    const userIndexForFailure = retryText !== undefined ? retryUserIndex : assistantIndex - 1;

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message: text, sessionId: getSessionId(), conversationId }),
      });
      if (!res.ok || !res.body) throw new Error("Request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawAnyToken = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? ""; // keep the last, possibly-incomplete event for next chunk

        for (const rawEvent of events) {
          const lines = rawEvent.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const eventName = eventLine.slice(6).trim();
          const data = JSON.parse(dataLine.slice(5).trim());

          if (eventName === "token") {
            sawAnyToken = true;
            setMessages((m) => {
              const next = [...m];
              if (next[assistantIndex]) {
                next[assistantIndex] = { ...next[assistantIndex], content: next[assistantIndex].content + data.chunk };
              }
              return next;
            });
          } else if (eventName === "done") {
            // Image replies (and crisis/blocked replies) arrive as a
            // single "done" event with no prior "token" events — set the
            // full content directly in that case.
            if (!sawAnyToken && data.reply) {
              setMessages((m) => {
                const next = [...m];
                if (next[assistantIndex]) {
                  next[assistantIndex] = { ...next[assistantIndex], content: data.reply };
                }
                return next;
              });
            }
            if (data.sources && data.sources.length > 0) {
              setMessages((m) => {
                const next = [...m];
                if (next[assistantIndex]) {
                  next[assistantIndex] = { ...next[assistantIndex], sources: data.sources };
                }
                return next;
              });
            }
            // The stream has genuinely ended now — mark it complete so
            // an unclosed [CARD] tag (e.g. cut off by a token limit) stops
            // showing a "still generating" indicator on content that has
            // actually finished arriving.
            setMessages((m) => {
              const next = [...m];
              if (next[assistantIndex]) {
                next[assistantIndex] = { ...next[assistantIndex], streamComplete: true };
              }
              return next;
            });
            if (!conversationId && data.conversationId) setConversationId(data.conversationId);
          } else if (eventName === "error") {
            setMessages((m) => {
              const next = [...m];
              if (next[assistantIndex]) {
                next[assistantIndex] = { ...next[assistantIndex], content: data.error || "Sorry, something went wrong." };
              }
              return next;
            });
          }
        }
      }

      loadConversationList(); // refresh titles/order in the sidebar
    } catch {
      // Genuine network/connection failure — remove the empty assistant
      // placeholder and flag the user's message as failed so a retry
      // button can appear on it, rather than showing a dead-end error bubble.
      setMessages((m) => {
        const next = [...m];
        if (next[userIndexForFailure]) {
          next[userIndexForFailure] = { ...next[userIndexForFailure], failed: true };
        }
        if (next[assistantIndex]?.role === "assistant" && next[assistantIndex]?.content === "") {
          next.splice(assistantIndex, 1);
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow selecting the same file again later
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file");
      return;
    }
    // 8MB raw cap, well under Groq's 20MB limit but a sane ceiling for a
    // phone camera photo before base64 overhead pushes it past the
    // server's 12mb JSON body limit.
    if (file.size > 8 * 1024 * 1024) {
      showToast("Image is too large (max 8MB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPendingImage({ dataUrl: reader.result, name: file.name });
    };
    reader.onerror = () => showToast("Couldn't read that image");
    reader.readAsDataURL(file);
  }

  async function sendImageMessage() {
    if (!pendingImage || uploadingImage) return;
    const caption = input.trim();
    const image = pendingImage;

    setMessages((m) => [
      ...m,
      { role: "user", content: caption || "What's in this image?", previewImage: image.dataUrl },
    ]);
    setInput("");
    setPendingImage(null);
    setUploadingImage(true);
    setLoading(true);

    const assistantIndex = messages.length + 1;
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`${API_BASE}/chat/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          message: caption,
          sessionId: getSessionId(),
          conversationId,
          image: image.dataUrl,
        }),
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setMessages((m) => {
        const next = [...m];
        if (next[assistantIndex]) next[assistantIndex] = { ...next[assistantIndex], content: data.reply };
        return next;
      });
      if (!conversationId && data.conversationId) setConversationId(data.conversationId);
      loadConversationList();
    } catch {
      setMessages((m) => {
        const next = [...m];
        if (next[assistantIndex]) {
          next[assistantIndex] = {
            ...next[assistantIndex],
            content: "Sorry, I'm having trouble looking at that image right now. Please try again.",
          };
        }
        return next;
      });
    } finally {
      setUploadingImage(false);
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (pendingImage) {
        sendImageMessage();
      } else {
        sendMessage();
      }
    }
  }

  async function startNewChat() {
    setMenuOpen(false);
    setMessages([WELCOME_MESSAGE]);
    setConversationId(null);
    try {
      const res = await fetch(`${API_BASE}/new-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sessionId: getSessionId() }),
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      loadConversationList();
    } catch {
      // Non-fatal — screen has still reset either way.
    }
  }

  async function deleteConversationById(id) {
    setConvoMenu(null);
    try {
      await fetch(`${API_BASE}/conversations/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sessionId: getSessionId(), conversationId: id }),
      });
      setConversations((c) => c.filter((conv) => conv.id !== id));
      // If the deleted conversation was the one currently open, drop back
      // to a fresh state rather than showing a now-nonexistent chat.
      if (id === conversationId) {
        setConversationId(null);
        setMessages([WELCOME_MESSAGE]);
      }
      showToast("Conversation deleted");
    } catch {
      showToast("Couldn't delete");
    }
  }

  function startRename(id, currentTitle) {
    setConvoMenu(null);
    setRenamingId(id);
    setRenameValue(currentTitle || "");
  }

  async function submitRename(id) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    try {
      await fetch(`${API_BASE}/conversations/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sessionId: getSessionId(), conversationId: id, title }),
      });
      setConversations((c) => c.map((conv) => (conv.id === id ? { ...conv, title } : conv)));
    } catch {
      showToast("Couldn't rename");
    }
  }

  function openConvoMenu(e, id) {
    e.stopPropagation();
    const touch = e.touches ? e.touches[0] : e;
    setConvoMenu({ conversationId: id, x: touch.clientX, y: touch.clientY });
  }

  function openConversation(id) {
    setMenuOpen(false);
    loadHistory(id);
  }

  // Long-press detection: touch-hold for ~500ms opens the context menu.
  // Mouse users get the same behavior via mousedown/mouseup for testing
  // on desktop, though this app is primarily used on mobile.
  function startLongPress(e, type, index, content, imageUrl) {
    const touch = e.touches ? e.touches[0] : e;
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ type, index, x, y, content, imageUrl });
      if (navigator.vibrate) navigator.vibrate(15); // subtle haptic if supported
    }, 500);
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function showToast(text) {
    setToast(text);
    setTimeout(() => setToast(""), 1800);
  }

  async function copyMessageText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied");
    } catch {
      showToast("Couldn't copy");
    }
    setContextMenu(null);
  }

  function downloadImage(url) {
    // Pollinations URLs allow direct download this way; opening in a new
    // tab is the most reliable cross-browser fallback on mobile if the
    // download attribute isn't honored by the browser.
    const link = document.createElement("a");
    link.href = url;
    link.download = "solograph-image.jpg";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setContextMenu(null);
  }

  function retryMessage(index) {
    const msg = messages[index];
    if (!msg) return;
    sendMessage(msg.content, index);
  }

  function openEditImage(index) {
    // The prompt used to generate this image is the user's message
    // immediately before it in the list — the marker itself only stores
    // the resulting URL, not the original text.
    const originalPrompt = index > 0 ? messages[index - 1]?.content ?? "" : "";
    setEditImageState({ originalPrompt, index });
    setContextMenu(null);
  }

  async function submitEditedImage(newPrompt) {
    const text = newPrompt.trim();
    setEditImageState(null);
    if (!text) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message: text, sessionId: getSessionId(), conversationId }),
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      loadConversationList();
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.app}>
      <header style={styles.topBar}>
        <button style={styles.iconBtn} onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <HamburgerIcon />
        </button>
        <span style={styles.brand}>{APP_NAME}</span>
        <span style={{ width: 40 }} />
      </header>

      {isOffline && (
        <div style={styles.offlineBanner}>
          <OfflineIcon />
          <span>You're offline — messages will fail to send until you reconnect</span>
        </div>
      )}

      <main style={styles.messages}>
        {!historyLoaded && (
          <div style={{ ...styles.row, justifyContent: "center", marginTop: 40 }}>
            <span style={{ color: "#8a8474", fontSize: 14 }}>Loading conversation…</span>
          </div>
        )}
        {historyLoaded &&
          messages.map((m, i) => {
            const imageUrl = m.role === "assistant" ? extractImageUrl(m.content) : null;
            return (
              <div key={i} style={styles.messageColumn}>
                <div
                  style={{ ...styles.row, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}
                >
                  {imageUrl ? (
                    <div
                      style={{ ...styles.bubble, ...styles.botBubble, ...styles.imageBubble }}
                      onTouchStart={(e) => startLongPress(e, "image", i, m.content, imageUrl)}
                      onTouchEnd={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      onMouseDown={(e) => startLongPress(e, "image", i, m.content, imageUrl)}
                      onMouseUp={cancelLongPress}
                      onMouseLeave={cancelLongPress}
                    >
                      <img src={imageUrl} alt="Generated" style={styles.generatedImage} draggable={false} />
                    </div>
                  ) : m.failed ? (
                    <button
                      style={{ ...styles.bubble, ...styles.userBubble, ...styles.failedBubble }}
                      onClick={() => retryMessage(i)}
                    >
                      <div>{m.content}</div>
                      <div style={styles.retryRow}>
                        <RetryIcon />
                        <span>Tap to retry</span>
                      </div>
                    </button>
                  ) : m.role === "assistant" ? (
                    <div style={styles.assistantContent}>
                      {parseMessageSegments(m.content, m.streamComplete).map((seg, si) =>
                        seg.type === "card" ? (
                          <ResponseCard
                            key={si}
                            title={seg.title}
                            content={seg.content}
                            streaming={seg.streaming}
                          />
                        ) : (
                          <div
                            key={si}
                            style={styles.botBubble}
                            onTouchStart={(e) => startLongPress(e, "text", i, seg.content, null)}
                            onTouchEnd={cancelLongPress}
                            onTouchMove={cancelLongPress}
                            onMouseDown={(e) => startLongPress(e, "text", i, seg.content, null)}
                            onMouseUp={cancelLongPress}
                            onMouseLeave={cancelLongPress}
                          >
                            <MarkdownText content={seg.content} />
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div
                      style={{ ...styles.bubble, ...styles.userBubble }}
                      onTouchStart={(e) => startLongPress(e, "text", i, m.content, null)}
                      onTouchEnd={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      onMouseDown={(e) => startLongPress(e, "text", i, m.content, null)}
                      onMouseUp={cancelLongPress}
                      onMouseLeave={cancelLongPress}
                    >
                      {m.previewImage && (
                        <img src={m.previewImage} alt="Uploaded" style={styles.uploadedImagePreview} />
                      )}
                      {m.content}
                    </div>
                  )}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <div style={styles.sourcesWrap}>
                    <span style={styles.sourcesLabel}>Sources:</span>
                    {m.sources.map((s, si) => (
                      <a
                        key={si}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.sourceLink}
                      >
                        {s.title || safeHostname(s.url)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        {historyLoaded && messages.length === 1 && messages[0] === WELCOME_MESSAGE && (
          <div style={styles.chipsWrap}>
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip.label}
                style={styles.chip}
                onClick={() => {
                  setInput(chip.prompt);
                  textareaRef.current?.focus();
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {loading && (
          <div style={{ ...styles.row, justifyContent: "flex-start" }}>
            <div style={{ ...styles.bubble, ...styles.botBubble, ...styles.typingBubble }}>
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* Long-press context menu — positioned near the touch point */}
      {contextMenu && (
        <>
          <div style={styles.contextOverlay} onClick={() => setContextMenu(null)} />
          <div
            style={{
              ...styles.contextMenu,
              top: Math.min(contextMenu.y, window.innerHeight - 140),
              left: Math.min(Math.max(contextMenu.x - 90, 10), window.innerWidth - 190),
            }}
          >
            {contextMenu.type === "text" && (
              <button style={styles.contextItem} onClick={() => copyMessageText(contextMenu.content)}>
                <CopyIcon />
                <span>Copy</span>
              </button>
            )}
            {contextMenu.type === "image" && (
              <>
                <button style={styles.contextItem} onClick={() => downloadImage(contextMenu.imageUrl)}>
                  <DownloadIcon />
                  <span>Download image</span>
                </button>
                <button style={styles.contextItem} onClick={() => openEditImage(contextMenu.index)}>
                  <EditIcon />
                  <span>Edit image</span>
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Conversation options menu (rename/delete) — same pattern as the message context menu above */}
      {convoMenu && (
        <>
          <div style={styles.contextOverlay} onClick={() => setConvoMenu(null)} />
          <div
            style={{
              ...styles.contextMenu,
              top: Math.min(convoMenu.y, window.innerHeight - 140),
              left: Math.min(Math.max(convoMenu.x - 90, 10), window.innerWidth - 190),
            }}
          >
            <button
              style={styles.contextItem}
              onClick={() => {
                const conv = conversations.find((c) => c.id === convoMenu.conversationId);
                startRename(convoMenu.conversationId, conv?.title);
              }}
            >
              <EditIcon />
              <span>Rename</span>
            </button>
            <button
              style={{ ...styles.contextItem, color: "#c04a30" }}
              onClick={() => deleteConversationById(convoMenu.conversationId)}
            >
              <TrashIcon />
              <span>Delete</span>
            </button>
          </div>
        </>
      )}

      {/* Edit-image prompt modal */}
      {editImageState && (
        <>
          <div style={styles.overlay} onClick={() => setEditImageState(null)} />
          <div style={styles.editImageModal}>
            <div style={styles.drawerHeader}>
              <span style={styles.drawerTitle}>Edit image</span>
              <button style={styles.iconBtn} onClick={() => setEditImageState(null)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            <div style={styles.editImageBody}>
              <p style={styles.editImageLabel}>Describe the new version you want:</p>
              <EditImageForm
                initialValue={editImageState.originalPrompt}
                onSubmit={submitEditedImage}
              />
            </div>
          </div>
        </>
      )}

      {/* Toast for copy confirmation */}
      {toast && <div style={styles.toast}>{toast}</div>}

      <footer style={styles.inputBar}>
        {pendingImage && (
          <div style={styles.imagePreviewChip}>
            <img src={pendingImage.dataUrl} alt="" style={styles.imagePreviewThumb} />
            <span style={styles.imagePreviewName}>{pendingImage.name}</span>
            <button
              style={styles.imagePreviewRemove}
              onClick={() => setPendingImage(null)}
              aria-label="Remove image"
            >
              <CloseIcon />
            </button>
          </div>
        )}
        <div style={styles.inputWrap}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          <button
            style={styles.attachBtn}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach image"
          >
            <PaperclipIcon />
          </button>
          <textarea
            ref={textareaRef}
            style={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={pendingImage ? "Ask something about this image..." : "Message Solograph AI..."}
            rows={1}
          />
          <button
            style={{
              ...styles.sendBtn,
              opacity: (input.trim() || pendingImage) && !loading ? 1 : 0.4,
            }}
            onClick={() => (pendingImage ? sendImageMessage() : sendMessage())}
            disabled={(!input.trim() && !pendingImage) || loading}
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </div>
      </footer>

      {menuOpen && (
        <>
          <div style={styles.overlay} onClick={() => setMenuOpen(false)} />
          <nav style={styles.drawer}>
            {/* Fixed top section — never scrolls */}
            <div style={styles.drawerTop}>
              <div style={styles.drawerHeader}>
                <span style={styles.drawerTitle}>{APP_NAME}</span>
                <button style={styles.iconBtn} onClick={() => setMenuOpen(false)} aria-label="Close menu">
                  <CloseIcon />
                </button>
              </div>

              <button style={styles.drawerItem} onClick={startNewChat}>
                <PlusIcon />
                <span>New chat</span>
              </button>

              <button
                style={styles.drawerItem}
                onClick={() => {
                  setAboutOpen(true);
                  setMenuOpen(false);
                }}
              >
                <InfoIcon />
                <span>About</span>
              </button>

              <div style={styles.historyLabel}>Chats</div>
            </div>

            {/* Scrollable history list — the only part that scrolls */}
            <div style={styles.historyScroll}>
              {conversations.length === 0 && (
                <div style={styles.historyEmpty}>No conversations yet</div>
              )}
              {conversations.map((c) =>
                renamingId === c.id ? (
                  <div key={c.id} style={styles.historyRenameRow}>
                    <input
                      style={styles.historyRenameInput}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitRename(c.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      autoFocus
                      maxLength={100}
                    />
                    <button style={styles.historyRenameSave} onClick={() => submitRename(c.id)}>
                      <CheckIcon />
                    </button>
                  </div>
                ) : (
                  <div key={c.id} style={styles.historyItemRow}>
                    <button
                      style={{
                        ...styles.historyItem,
                        ...(c.id === conversationId ? styles.historyItemActive : {}),
                      }}
                      onClick={() => openConversation(c.id)}
                    >
                      <span style={styles.historyItemTitle}>{c.title || "New conversation"}</span>
                      <span style={styles.historyItemDate}>{formatConversationDate(c.lastMessageAt)}</span>
                    </button>
                    <button
                      style={styles.historyOptionsBtn}
                      onClick={(e) => openConvoMenu(e, c.id)}
                      aria-label="Conversation options"
                    >
                      <DotsIcon />
                    </button>
                  </div>
                )
              )}
            </div>

            {/* Fixed bottom section — never moves while scrolling history */}
            <div style={styles.drawerBottom}>
              {user ? (
                <>
                  <div style={styles.accountInfo}>
                    <div style={styles.accountAvatar}>{(user.name || user.email)[0].toUpperCase()}</div>
                    <div style={styles.accountText}>
                      <div style={styles.accountName}>{user.name || "Account"}</div>
                      <div style={styles.accountEmail}>{user.email}</div>
                    </div>
                  </div>
                  <button
                    style={styles.drawerItem}
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout?.();
                    }}
                  >
                    <LogoutIcon />
                    <span>Log out</span>
                  </button>
                </>
              ) : (
                <button
                  style={styles.drawerItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onLoginRequested?.();
                  }}
                >
                  <LoginIcon />
                  <span>Log in / Sign up</span>
                </button>
              )}
            </div>
          </nav>
        </>
      )}

      {aboutOpen && (
        <>
          <div style={styles.overlay} onClick={() => setAboutOpen(false)} />
          <div style={styles.aboutModal}>
            <div style={styles.drawerHeader}>
              <span style={styles.drawerTitle}>About</span>
              <button style={styles.iconBtn} onClick={() => setAboutOpen(false)} aria-label="Close about">
                <CloseIcon />
              </button>
            </div>
            <div style={styles.aboutContent}>
              <img src={profilePhoto} alt="Abubakar Muhammad Nurudeen" style={styles.aboutAvatarImg} />
              <h2 style={styles.aboutName}>Abubakar Muhammad Nurudeen</h2>

              <p style={styles.aboutText}>
                I'm the creator of this app and the founder of <strong>Solograph.Inc</strong>.
              </p>
              <p style={styles.aboutText}>
                I built this AI to make intelligent assistance more accessible, especially for
                students, researchers, and anyone looking for reliable help with learning, writing,
                coding, and everyday tasks. My goal is to create an assistant that is practical,
                easy to use, and continuously improving.
              </p>
              <p style={styles.aboutText}>
                This project is independently developed and powered by the SOLO-1.3 model. Unlike
                AI systems created by large organizations, this app is the result of one person's
                vision, dedication, and continuous development.
              </p>
              <p style={styles.aboutText}>
                Thank you for using this app and being part of its journey. Every update is
                focused on making it smarter, faster, and more helpful.
              </p>

              <a
                href="mailto:nurudeensolograph@gmail.com"
                style={styles.emailBtn}
                aria-label="Send an email to Abubakar Muhammad Nurudeen"
              >
                <EmailIcon />
                <span>nurudeensolograph@gmail.com</span>
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function LoginIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function OfflineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

/** Small controlled form for the "Edit image" modal, kept separate so its
 * own input state doesn't re-render the whole chat on every keystroke. */
function EditImageForm({ initialValue, onSubmit }) {
  const [value, setValue] = useState(initialValue || "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <textarea
        style={styles.editImageInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        autoFocus
      />
      <button type="submit" style={styles.editImageSubmit} disabled={!value.trim()}>
        Generate new image
      </button>
    </form>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
    </svg>
  );
}

function TypingDots() {
  return (
    <span style={styles.dotsWrap}>
      <span style={{ ...styles.dot, animationDelay: "0ms" }} />
      <span style={{ ...styles.dot, animationDelay: "150ms" }} />
      <span style={{ ...styles.dot, animationDelay: "300ms" }} />
      <style>{`
        @keyframes solograph-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </span>
  );
}

const styles = {
  app: {
    position: "fixed",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    background: "#f2efe9",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#2b2a27",
    overflow: "hidden",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 12px",
    borderBottom: "1px solid #e3ddd0",
    background: "#f2efe9",
    flexShrink: 0,
  },
  offlineBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 14px",
    background: "#fbe9d0",
    color: "#8a5a1e",
    fontSize: 12.5,
    flexShrink: 0,
  },
  iconBtn: {
    background: "none",
    border: "none",
    color: "#2b2a27",
    padding: 8,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  brand: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontWeight: 700,
    fontSize: 17,
    letterSpacing: 0.1,
    color: "#2b2a27",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  row: { display: "flex", width: "100%" },
  messageColumn: { display: "flex", flexDirection: "column", gap: 4 },
  sourcesWrap: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  sourcesLabel: {
    fontSize: 12,
    color: "#a39d8e",
  },
  sourceLink: {
    fontSize: 12,
    color: "#6d5ef8",
    textDecoration: "none",
    padding: "3px 9px",
    background: "#e7e2d6",
    borderRadius: 12,
  },
  regenerateBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginLeft: 2,
    padding: "6px 10px",
    background: "none",
    border: "1px solid #ddd6c7",
    borderRadius: 8,
    color: "#7a7568",
    fontSize: 12.5,
    cursor: "pointer",
  },
  chipsWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
    paddingLeft: 2,
  },
  chip: {
    padding: "9px 14px",
    background: "#e7e2d6",
    border: "none",
    borderRadius: 18,
    color: "#4a4638",
    fontSize: 13.5,
    cursor: "pointer",
  },
  // AI replies render as plain text directly on the page background — no
  // bubble at all, matching the reference design. Only user messages get
  // a bubble (bottom of this object).
  bubble: {
    maxWidth: "82%",
    padding: "10px 14px",
    borderRadius: 16,
    fontSize: 15.5,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
  },
  userBubble: {
    background: "#e7e2d6",
    color: "#2b2a27",
    borderBottomRightRadius: 4,
  },
  botBubble: {
    background: "none",
    color: "#2b2a27",
    border: "none",
    padding: 0,
    maxWidth: "100%",
  },
  assistantContent: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: "100%",
    maxWidth: "100%",
  },

  card: {
    display: "flex",
    flexDirection: "column",
    background: "#ffffff",
    borderRadius: 18,
    boxShadow: "0 2px 14px rgba(0,0,0,0.08)",
    border: "1px solid #ece7d9",
    overflow: "hidden",
    maxWidth: "100%",
    position: "relative",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid #f0ece0",
    background: "#faf8f3",
  },
  cardTitle: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontSize: 14.5,
    fontWeight: 700,
    color: "#3a362c",
  },
  cardActions: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  cardActionBtn: {
    width: 30,
    height: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    borderRadius: 8,
    color: "#7a7568",
    cursor: "pointer",
  },
  cardBody: {
    padding: "16px",
    position: "relative",
  },
  cardProse: {
    fontSize: 14.5,
    lineHeight: 1.6,
    color: "#2b2a27",
  },
  cardCode: {
    margin: 0,
    fontFamily: "'SF Mono', Menlo, Consolas, 'Courier New', monospace",
    fontSize: 13,
    lineHeight: 1.55,
    color: "#e8e8ec",
    background: "#1c1c22",
    padding: "14px",
    borderRadius: 10,
    overflowX: "auto",
    whiteSpace: "pre",
  },
  cardStreamingDot: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#6d5ef8",
    marginLeft: 4,
    animation: "solograph-bounce 1s infinite ease-in-out",
  },
  cardLangTag: {
    fontSize: 10.5,
    color: "#9a9384",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  typingBubble: { padding: "4px 0" },
  mdLine: { margin: 0 },
  mdList: {
    margin: "6px 0",
    paddingLeft: 4,
    listStyle: "none",
  },
  mdListItem: {
    marginBottom: 6,
    lineHeight: 1.55,
    paddingLeft: 18,
    position: "relative",
  },
  mdBulletDot: {
    position: "absolute",
    left: 2,
    top: 9,
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "#4a4638",
  },
  mdHeading: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontWeight: 700,
    fontSize: 19,
    lineHeight: 1.4,
    margin: "14px 0 6px",
    color: "#1f1e1a",
  },
  mdSubheading: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontWeight: 700,
    fontSize: 16,
    lineHeight: 1.45,
    margin: "10px 0 4px",
    color: "#2b2a27",
  },
  mdBold: {
    fontWeight: 700,
    textDecoration: "underline",
    textDecorationColor: "#b8b09a",
    textUnderlineOffset: 3,
  },
  mdItalic: {
    fontStyle: "italic",
  },
  failedBubble: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    background: "#e7e2d6",
    color: "#2b2a27",
    border: "1px solid #d98a6b",
    borderBottomRightRadius: 4,
    cursor: "pointer",
    font: "inherit",
    textAlign: "left",
  },
  retryRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "#a15436",
    opacity: 0.9,
  },
  imageBubble: { padding: 6, background: "#e7e2d6", borderRadius: 16 },
  generatedImage: {
    display: "block",
    width: "100%",
    maxWidth: 260,
    borderRadius: 12,
  },
  dotsWrap: { display: "inline-flex", gap: 4, alignItems: "center" },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#9a9384",
    display: "inline-block",
    animation: "solograph-bounce 1s infinite ease-in-out",
  },
  inputBar: {
    flexShrink: 0,
    padding: "10px 14px 18px",
    background: "#f2efe9",
  },
  inputWrap: {
    display: "flex",
    alignItems: "flex-end",
    gap: 6,
    background: "#ffffff",
    border: "1px solid #e3ddd0",
    borderRadius: 26,
    padding: "8px 8px 8px 10px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
  },
  attachBtn: {
    flexShrink: 0,
    width: 34,
    height: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    borderRadius: "50%",
    color: "#7a7568",
    cursor: "pointer",
  },
  imagePreviewChip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#ffffff",
    border: "1px solid #e3ddd0",
    borderRadius: 14,
    padding: "8px 10px",
    marginBottom: 8,
    maxWidth: 260,
  },
  imagePreviewThumb: {
    width: 34,
    height: 34,
    borderRadius: 8,
    objectFit: "cover",
    flexShrink: 0,
  },
  imagePreviewName: {
    fontSize: 12.5,
    color: "#4a4638",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  imagePreviewRemove: {
    flexShrink: 0,
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f0ece0",
    border: "none",
    borderRadius: "50%",
    color: "#7a7568",
    cursor: "pointer",
  },
  uploadedImagePreview: {
    display: "block",
    width: "100%",
    maxWidth: 220,
    borderRadius: 12,
    marginBottom: 6,
  },
  input: {
    flex: 1,
    resize: "none",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#2b2a27",
    fontSize: 15.5,
    fontFamily: "inherit",
    lineHeight: 1.4,
    maxHeight: 120,
    padding: "6px 0",
  },
  sendBtn: {
    flexShrink: 0,
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "#2b2a27",
    color: "#fff",
    border: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "opacity 0.15s ease",
  },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 20 },

  // Drawer is a column: fixed top, flexible scrollable middle, fixed bottom.
  drawer: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "82%",
    maxWidth: 320,
    background: "#f8f6f1",
    zIndex: 30,
    display: "flex",
    flexDirection: "column",
    boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
    overflow: "hidden",
  },
  drawerTop: {
    flexShrink: 0,
    padding: "14px 10px 6px",
  },
  drawerBottom: {
    flexShrink: 0,
    padding: "10px 10px 14px",
    borderTop: "1px solid #e3ddd0",
    background: "#f8f6f1",
  },
  drawerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 8px 16px",
  },
  drawerTitle: { fontWeight: 600, fontSize: 16, color: "#2b2a27" },
  drawerItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 10px",
    background: "none",
    border: "none",
    color: "#2b2a27",
    fontSize: 15,
    borderRadius: 10,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  },
  historyLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "#9a9384",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    padding: "14px 10px 6px",
  },
  historyScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0 6px",
    minHeight: 0, // required for flex child to actually scroll instead of pushing siblings
  },
  historyEmpty: {
    padding: "16px 14px",
    fontSize: 13.5,
    color: "#a39d8e",
  },
  historyItemRow: {
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  historyItem: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minWidth: 0,
    padding: "10px 12px",
    background: "none",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    textAlign: "left",
    marginBottom: 2,
  },
  historyOptionsBtn: {
    flexShrink: 0,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    color: "#9a9384",
    cursor: "pointer",
    borderRadius: 8,
  },
  historyRenameRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px 6px",
  },
  historyRenameInput: {
    flex: 1,
    background: "#ffffff",
    border: "1px solid #ddd6c7",
    borderRadius: 8,
    padding: "8px 10px",
    color: "#2b2a27",
    fontSize: 14,
    outline: "none",
  },
  historyRenameSave: {
    flexShrink: 0,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#2b2a27",
    border: "none",
    borderRadius: 8,
    color: "#fff",
    cursor: "pointer",
  },
  historyItemActive: {
    background: "#e7e2d6",
  },
  historyItemTitle: {
    fontSize: 14,
    color: "#2b2a27",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  historyItemDate: {
    fontSize: 11.5,
    color: "#a39d8e",
  },
  accountInfo: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 10px 6px",
  },
  accountAvatar: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: "#2b2a27",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  accountText: { minWidth: 0 },
  accountName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#2b2a27",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  accountEmail: {
    fontSize: 12,
    color: "#8a8474",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  aboutModal: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    background: "#f8f6f1",
    display: "flex",
    flexDirection: "column",
  },
  aboutContent: {
    padding: "24px 24px 40px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    overflowY: "auto",
  },
  aboutAvatarImg: {
    width: 96,
    height: 96,
    borderRadius: "50%",
    objectFit: "cover",
    marginBottom: 16,
    marginTop: 20,
    border: "2px solid #e3ddd0",
  },
  aboutName: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontSize: 20,
    fontWeight: 700,
    margin: "0 0 12px",
    color: "#2b2a27",
  },
  aboutText: { fontSize: 14.5, lineHeight: 1.6, color: "#5c5748", margin: "0 0 14px", maxWidth: 340 },
  emailBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    padding: "12px 18px",
    background: "#e7e2d6",
    border: "none",
    borderRadius: 12,
    color: "#3a362c",
    fontSize: 14,
    fontWeight: 500,
    textDecoration: "none",
  },

  contextOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    background: "transparent",
  },
  contextMenu: {
    position: "fixed",
    zIndex: 41,
    background: "#ffffff",
    border: "1px solid #e3ddd0",
    borderRadius: 12,
    boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
    overflow: "hidden",
    minWidth: 180,
  },
  contextItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "13px 16px",
    background: "none",
    border: "none",
    color: "#2b2a27",
    fontSize: 14.5,
    cursor: "pointer",
    textAlign: "left",
  },

  editImageModal: {
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 41,
    width: "88%",
    maxWidth: 340,
    background: "#f8f6f1",
    border: "1px solid #e3ddd0",
    borderRadius: 16,
    boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
  },
  editImageBody: { padding: "0 18px 20px" },
  editImageLabel: { fontSize: 13.5, color: "#8a8474", margin: "0 0 10px" },
  editImageInput: {
    background: "#ffffff",
    border: "1px solid #ddd6c7",
    borderRadius: 10,
    padding: "11px 13px",
    color: "#2b2a27",
    fontSize: 14.5,
    fontFamily: "inherit",
    resize: "none",
    outline: "none",
  },
  editImageSubmit: {
    background: "#2b2a27",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    fontSize: 14.5,
    fontWeight: 600,
    cursor: "pointer",
  },

  toast: {
    position: "fixed",
    bottom: 90,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#2b2a27",
    color: "#f2efe9",
    padding: "10px 18px",
    borderRadius: 20,
    fontSize: 13.5,
    zIndex: 50,
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
  },
};
