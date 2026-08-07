import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Clear out any previously-registered service worker first, in case
    // an earlier broken version is still active in the browser cache.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    }).finally(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal — app still works as a normal website if this fails.
      });
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
