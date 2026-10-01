# Contributing to the Commitverse

Thanks for wanting to help build the universe. Every visual rule here is a measurement taken from public git and GitHub data, so new ideas start from the question *"what would this show?"*

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 (the universe) and /city.html (a city)
npm run build        # the static site in dist/
```

There is no backend. Data is baked into `public/` by scripts in `tools/` and `ingest/`, or fetched live from the GitHub API.

## Where things are

| Scale | Code |
|---|---|
| The cluster of galaxies | `src/universe/universeView.js`, `src/universe/cosmos.js`, `src/universe/galaxies.js` (who lives where) |
| A galaxy | `src/universe/galaxyView.js` |
| A star system / an organisation | `src/universe/systemView.js`, `src/universe/orgView.js` |
| A world | `src/universe/planet.js` (rendering), `src/universe/planetView.js` (interaction) |
| A city | `src/city.js`, `src/materials.js`, `src/timelapse.js`, `src/cityEvents.js`, `src/traffic.js`, `src/main.js` |
| A city raised live from GitHub | `src/liveCity.js` |
| The zoom between scales | `src/scale.js` and every view's `zoomTarget()` |
| The film and its tools | `src/universe/director.js`, `src/cityDirector.js`, `tools/video/` |
| World cards (README) | `src/card.js`, `card/` |
| Data | `tools/universe/seed.mjs` (daily), `ingest/ingest.mjs` (a city's history) |

The lore (`docs/LORE.md`) lists which rules hold and why. `docs/UNIVERSE_TECH.md` and `docs/ARCHITECTURE.md` explain how they're built.

## Good first contributions

- **A new world style.** Give a language its own climate in `WORLD_STYLES` (`src/universe/lore.js`).
- **A phenomenon from the lore that isn't drawn yet.** For example pulsars (steady releases) or binary stars (two repos that always change together).
- **Translations** of the README.
- **Performance on phones.** Measure first, then fix the slowest thing.

## Pull requests

- Keep each change small and focused, and describe what it shows and why.
- Run `npm run build` before you open the PR.
- New data must come from public sources, with credit where a licence asks for it.

By contributing you agree that your work is released under the [MIT License](LICENSE).
