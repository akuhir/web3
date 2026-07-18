# Web3 in Nigeria — Feasibility Study

A static website version of the presentation "Challenges and Prospects of Web3 Development in Nigeria" (Minna Institute of Technology and Innovation).

## Files

- `index.html` — page content and structure
- `styles.css` — all styling (self-contained, no build step)
- `script.js` — mobile nav toggle + scroll-reveal animation

No build tools, frameworks, or dependencies required — just static files.

## Host it on GitHub Pages

1. Create a new repository on GitHub (or use an existing one).
2. Add these three files (`index.html`, `styles.css`, `script.js`) to the repo root — or to a `/docs` folder if you prefer.
3. Push to GitHub.
4. In the repo, go to **Settings → Pages**.
5. Under **Source**, select the branch (usually `main`) and the folder (`/root` or `/docs`).
6. Save. GitHub will give you a URL like `https://yourusername.github.io/repo-name/` within a minute or two.

That's it — no further configuration needed.

## Local preview

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.
