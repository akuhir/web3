// Small helper module for auth state — token storage and API calls.
// Kept separate from ChatWidget so both ChatWidget and AuthScreen can
// share the same logic without duplicating it.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api/chat";
export const API_BASE = API_URL.replace(/\/chat$/, "");

const TOKEN_KEY = "solograph_auth_token";
const USER_KEY = "solograph_auth_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getSessionId() {
  let id = localStorage.getItem("solograph_session_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("solograph_session_id", id);
  }
  return id;
}

/** Adds the Authorization header if the user is logged in. */
export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseErrorOrThrow(res) {
  let message = "Something went wrong. Please try again.";
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
  } catch {
    // response wasn't JSON — keep the generic message
  }
  throw new Error(message);
}

export async function signup(email, password, name) {
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name, sessionId: getSessionId() }),
  });
  if (!res.ok) await parseErrorOrThrow(res);
  const data = await res.json();
  saveSession(data.token, data.user);
  return data.user;
}

export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, sessionId: getSessionId() }),
  });
  if (!res.ok) await parseErrorOrThrow(res);
  const data = await res.json();
  saveSession(data.token, data.user);
  return data.user;
}

export function logout() {
  clearSession();
}
