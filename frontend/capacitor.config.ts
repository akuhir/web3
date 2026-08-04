import { CapacitorConfig } from "@capacitor/cli";

// This wraps your already-deployed Vercel site in a native Android shell,
// rather than bundling a local copy of the frontend. That means the APK
// always shows whatever is currently live on Vercel — no separate rebuild
// needed when you update the web app, only when you change native/APK-level
// settings (app name, icon, permissions, etc).
const config: CapacitorConfig = {
  appId: "com.solograph.ai",
  appName: "Solograph AI",
  webDir: "dist",
  server: {
    url: "https://solographai.vercel.app",
    cleartext: false,
  },
};

export default config;
