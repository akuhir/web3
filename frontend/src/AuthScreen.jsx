import React, { useState } from "react";
import { signup, login } from "./auth.js";

export default function AuthScreen({ onAuthenticated, onSkip }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = mode === "signup" ? await signup(email, password, name || undefined) : await login(email, password);
      onAuthenticated(user);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.brand}>Solograph AI</div>
        <h1 style={styles.title}>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p style={styles.subtitle}>
          {mode === "login"
            ? "Log in to pick up your conversations right where you left off."
            : "Sign up to save your conversation history across devices."}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          {mode === "signup" && (
            <input
              style={styles.input}
              type="text"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            required
          />

          {error && <div style={styles.error}>{error}</div>}

          <button style={styles.submitBtn} type="submit" disabled={loading}>
            {loading ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>

        <button
          style={styles.switchBtn}
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Don't have an account? Sign up" : "Already have an account? Log in"}
        </button>

        <button style={styles.skipBtn} onClick={onSkip}>
          Continue without an account
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f0f16",
    padding: 20,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: 360,
    display: "flex",
    flexDirection: "column",
  },
  brand: {
    color: "#6d5ef8",
    fontWeight: 700,
    fontSize: 15,
    marginBottom: 20,
    textAlign: "center",
  },
  title: {
    color: "#e8e8ec",
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 8px",
    textAlign: "center",
  },
  subtitle: {
    color: "#9c9cae",
    fontSize: 14,
    lineHeight: 1.5,
    margin: "0 0 28px",
    textAlign: "center",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  input: {
    background: "#1c1c28",
    border: "1px solid #2a2a38",
    borderRadius: 12,
    padding: "13px 16px",
    color: "#e8e8ec",
    fontSize: 15,
    outline: "none",
  },
  error: {
    color: "#ff8a8a",
    fontSize: 13.5,
    padding: "4px 2px",
  },
  submitBtn: {
    background: "#6d5ef8",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "13px 16px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 6,
  },
  switchBtn: {
    background: "none",
    border: "none",
    color: "#9c9cae",
    fontSize: 13.5,
    marginTop: 20,
    cursor: "pointer",
    textAlign: "center",
  },
  skipBtn: {
    background: "none",
    border: "none",
    color: "#5c5c6e",
    fontSize: 13,
    marginTop: 12,
    cursor: "pointer",
    textAlign: "center",
    textDecoration: "underline",
  },
};
