# Web3 Development in Nigeria — Static Site

Black & white static site version of the presentation. Every point and subheading
is rendered as a solid black callout card with its own custom-generated icon.

## Files

- `index.html` — all 10 slides as sections, one section per deck slide
- `styles.css` — strict black & white styling, black callout card system
- `script.js` — mobile nav toggle
- `assets/` —49 custom-generated PNG icons (one per point/subheading), white line art on transparent background, plus cover and conclusion marks

## Icon naming

Icons are named by slide/topic, e.g. `def-decentralization.png`, `challenge-regulatory.png`,
`future-education.png`. Each is referenced exactly once in `index.html`.

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
