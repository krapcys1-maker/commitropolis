# Vision: the universe of open source

> Others build a city of code. We build the universe it lives in, and you can zoom from the whole of open source down to a single line.

[BENCHMARK.md](BENCHMARK.md) shows where the bar is. This document is about going somewhere nobody has gone. The rule stays the one that got us here: **every visual element carries real data.** Imagination sets the form, and git history fills it with truth.

## One zoom, seven scales

| Scale | Metaphor | What it shows (real data) |
|---|---|---|
| **Universe** | All of open source | Every repo we know, clustered into galaxies |
| **Galaxy** | An ecosystem (JavaScript, Rust, Python, AI…) | Spiral arms are sub-ecosystems (frontend, tooling, ML). Galaxies ignite when an ecosystem is born (Node 2009, Rust 2015, the AI nebula of 2023) |
| **Star system** | An owner or organisation | The sun's brightness is the org's total stars; its planets are its repos |
| **Planet** | A repository | Size = code size. Atmosphere colour = main language. **City lights on the night side = activity in the last 30 days**, like Earth at night. Archived repos are frozen worlds. Forks are moons and colonies |
| **Surface** | The city we already have | Continents = top-level folders, districts = folders, buildings = files, all on a curved horizon |
| **Building** | A file | Floors = lines (the code elevator, already built) |
| **Bedrock** | The file's history | **Geological strata**: cut a core sample and every layer is the year its lines were written (`git blame`); click a layer to see its commit |

The transitions between scales are the product. Picture diving from a galaxy into a solar system, landing through a planet's atmosphere, flying between towers, and riding an elevator into the code. It should be one continuous, cinematic camera move.

## The universe runs on real events

| In the universe | In git / GitHub |
|---|---|
| A planet forming from dust | The first commit |
| Continents rising, cities growing | Code being written, per folder |
| **Asteroid impact**: a crater, then regrowth | A massive refactor or deletion (thousands of lines removed in one commit) |
| Ruins | Deleted files (already built: demolitions) |
| **Rocket launch from the spaceport** | A release tag; the version number is painted on the rocket |
| Shuttles docking and waiting in orbit | Open pull requests. Merge = landing and unloading, and the buildings grow |
| Storms over a district | Open issues about that code; lightning for critical bugs |
| Red aurora | Failing CI |
| **The night sky on the planet** | **Stargazers: one star per person who starred the repo.** A repo with 200k stars has a Milky Way overhead; click a star to see who it is |
| Ships travelling between planets | Contributors who work on several repos. The social graph becomes flight paths |
| Trade routes of light between planets | Dependencies; traffic = downloads |
| **Parallel universes** | **Branches and forks.** A branch is an alternate timeline: toggle a pull request to see a ghost version of the city with its changes. Merging collapses the timelines |

## Signature moments (each one a clip)

1. **Orbit to street in one move.** Space → atmosphere (clouds, heat glow) → skyline → street → a building's facade → its code. No cuts.
2. **The Big Bang of open source.** 2008 → today in 60 seconds, as galaxies ignite, planets form, and the AI nebula explodes in 2023. The flagship video.
3. **A planet's life.** Dust → first commit → continents → cities → the great refactor asteroid → rebirth → today's city lights.
4. **Stargazer sky.** Stand in a repo's city at night and see a sky made of the people who starred it.
5. **Release night.** Scrub to a big release and a rocket launches from the spaceport.
6. **What-if timeline.** Open a pull request and watch the city shimmer into its alternate version.
7. **Core sample.** Drill into a file and pull out its geology, 2009 at the bottom and last week on top.

## Modes

- **Explorer.** Fly your own ship (your GitHub identity) through the universe; land anywhere.
- **Time machine.** Scrub time at any scale: a file, a city, a galaxy, the universe.
- **Archaeologist.** Strata, core samples, the commit behind every layer.
- **Constellations.** Curated tours drawn as constellations across the sky, e.g. *jQuery → Backbone → Angular → React → Vue → Svelte*, narrated by the AI guide from verified sources.
- **Your universe.** Your starred and contributed repos as a personal galaxy, with a share card.

## Why this can work (and isn't just a pretty idea)

- **Nobody owns the full zoom.** Map of GitHub has the map but no cities; code cities have a city but no world. The continuous zoom from the universe to one line of code is new.
- **The metaphors map cleanly onto the data.** Stars are stargazers, branches are parallel timelines, releases are launches. Viewers can understand them in one look, with no legend needed.
- **Built-in growth loops.** "Add your planet", the stargazer sky ("I'm a star in React's sky"), badges, personal galaxies.
- **The expensive work is already done.** Honest history, meaningful lights, the code elevator and the Blender renderer all carry over unchanged. The surface of a planet *is* our city.

## How to get there (each step ships something)

1. **Tiny planet.** Wrap the existing city onto a small planet (curved horizon, the sea on the far side, atmosphere, the city lights seen from orbit), plus the orbit-to-street landing. It is a big visual differentiator for little new infrastructure.
2. **City world v1** (from BENCHMARK): streets with painted names, architecture by file type, rooftops.
3. **Star systems and galaxies v0:** seeded from GitHub metadata (500–1000 repos, 50–100 prebaked planets), searchable, with fly-to and land.
4. **Events:** asteroid refactors, release rockets, the stargazer sky.
5. **Ingest service:** "add your planet", unexplored worlds built on first landing.
6. **The Big Bang video**, then the AI guide and constellation tours.
