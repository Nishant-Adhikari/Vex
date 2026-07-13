# VEX Mission Companion — pitch site

Public, static pitch site for the **VEX Mission Companion** (the companion character
is named *Vexa*), the private, security-bound status mirror for long-running VEX
missions.

The demo uses simulated states and a presentation-only sprite atlas. It has no API
calls, analytics, wallet integration, database access, or ability to inspect a local
VEX installation.

## Design

Flat dark-navy, editorial language modeled on projectvex.ai — no gradients, glows,
or neon. Type is self-hosted as woff2 (fully inert, no external requests):

- **Instrument Serif** — editorial display headlines
- **Instrument Sans** — body / UI
- **JetBrains Mono** — uppercase eyebrows, labels, numbers

Fonts live in `assets/fonts/` and are served with `font-src 'self'`. The rest of the
CSP stays `'self'` / inert (`connect-src 'none'`, no external hosts).

## Build

```bash
node build.mjs
```

Copies `index.html`, `styles.css`, `app.js`, the sprite atlas, and `assets/fonts/`
into `dist/`.
