# Web3 Development in Nigeria — Feasibility Study

Static website version of the presentation, mirroring the original deck slide-for-slide (same titles, same wording, same icons), in black & white.

## Files

- `index.html` — all 10 slides as sections, same order and titles as the deck
- `styles.css` — black & white styling
- `script.js` — mobile nav toggle
- `assets/` — the original icons extracted from the .pptx

## Host it on GitHub Pages

1. Create a new repository on GitHub (or use an existing one).
2. Add `index.html`, `styles.css`, `script.js`, and the whole `assets/` folder to the repo root.
3. Push to GitHub.
4. In the repo, go to **Settings → Pages**.
5. Under **Source**, select the branch (usually `main`) and the folder (`/root`).
6. Save. GitHub gives you a URL like `https://yourusername.github.io/repo-name/` within a minute or two.

## Local preview

```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`.
