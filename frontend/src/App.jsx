import React, { useState, useEffect } from "react";
import ChatWidget from "./ChatWidget.jsx";
import AuthScreen from "./AuthScreen.jsx";
import { getStoredUser, getToken, clearSession } from "./auth.js";

const SKIP_KEY = "solograph_auth_skipped";

export default function App() {
  // Three possible states on load: known logged-in user, explicitly
  // skipped (continue anonymously), or neither yet decided (show AuthScreen).
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));
  const [skipped, setSkipped] = useState(() => sessionStorage.getItem(SKIP_KEY) === "1");

  function handleAuthenticated(newUser) {
    setUser(newUser);
  }

  function handleSkip() {
    sessionStorage.setItem(SKIP_KEY, "1");
    setSkipped(true);
  }

  function handleLogout() {
    clearSession();
    setUser(null);
    setSkipped(false);
  }

  if (!user && !skipped) {
    return <AuthScreen onAuthenticated={handleAuthenticated} onSkip={handleSkip} />;
  }

  return <ChatWidget user={user} onLogout={handleLogout} onLoginRequested={() => setSkipped(false)} />;
}
