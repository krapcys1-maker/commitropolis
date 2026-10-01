# The universe: how to build it (research, 2026-09-30)

Companion to [VISION.md](VISION.md): how we render and feed it, and which ready-made parts we can use.

## The mapping (agreed direction)

| Scale | Is | Shows |
|---|---|---|
| Galaxy | GitHub | Spiral arms = languages / ecosystems. **Distance from the core = account age**: user IDs are sequential, so the galaxy grew outward from 2008, just as GitHub did. Named sectors (Titan Cluster, AI Nebula, Stellar Nursery…) are defined in [LORE.md](LORE.md) |
| Star system | An organisation (the sun) | Brightness = the org's total stars. The org's own repos are **megastructures**: rings and stations around the sun, with cities on them. Member and contributor planets orbit it. Independent developers live in small systems of their language arm |
| **Planet** | **An account (a person)** | **Development level = total stars** (a Kardashev-like scale from Dust to Galactic, see [LORE.md](LORE.md)). Size = total code. Atmosphere colour = main language. City lights on the night side = activity in the last 30 days |
| City on the planet | One of that person's repos | Our current city: districts, buildings, history, the code elevator |
| Night sky over a city | Stargazers | One star per person who starred the repo |

## Can it scale to "billions"?

GitHub has **180M+ developers and 630M repositories** ([Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)). Rendering that is solved, the same way Space Engine, Elite Dangerous and No Man's Sky do it: **never draw billions at once.**

- **Hierarchical LOD.** The galaxy is a density field (haze sprites) plus a few hundred thousand GPU points. Closer in, octree tiles of real systems stream in; inside a system, its planets load; landing on a planet loads its cities. There are only thousands of objects on screen at any moment. Web references: a three.js galaxy with ~494k stars in 3 LOD levels, and a [WebGPU compute galaxy](https://threejsroadmap.com/blog/galaxy-simulation-webgpu-compute-shaders) simulating 1M+ stars at 60 fps.
- **Deterministic addresses.** An account's position comes from its ID, language and org. Every account has a stable place in the galaxy before we have fetched anything about it, which makes the universe procedural but seeded by real data.
- **Data on demand.**
  - A planet costs 1–2 GitHub API calls (profile, repos, languages), cached server-side.
  - A city's full history is ingested when someone first lands there (seconds for small repos), then cached per `repo@sha`.
  - Famous places are prebaked.
- **What is *not* possible, and not needed:** precomputing the history of 630M repos, or showing every city at once.
- **Precision across scales:** camera-relative rendering (a floating origin), plus a separate scene per scale with crossfades. One float32 world cannot hold both a galaxy and a line of code.

## Ready-made parts worth using (licences checked)

| What | Where | Licence | Use |
|---|---|---|---|
| Physically based atmosphere (Bruneton precomputed scattering) | [@takram/three-atmosphere](https://github.com/takram-design-engineering/three-geospatial) (1.7k★) | MIT | Planet limb glow from orbit and skies during descent. Photoreal ([ISS render](https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/main/packages/atmosphere/docs/iss.jpg)). WebGPU-ready. Earth-tuned, so custom planet sizes need testing |
| Volumetric clouds, light shafts, haze | @takram/three-clouds (same repo) | MIT | Flying down through clouds into a city |
| Procedural planets reference | [dgreenheck/threejs-procedural-planets](https://github.com/dgreenheck/threejs-procedural-planets) | MIT | Terrain noise layers, shading, atmosphere particles |
| Procedural trees | [dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree) (1.7k★) | MIT | Parks of old, stable code |
| Galaxy shader reference | [AmitDigga/threejs-galaxy-shader](https://github.com/AmitDigga/threejs-galaxy-shader) | MIT | Spiral arms, core glow |
| Cube-sphere planet, water, clouds | [ZyFou/ProceduralTerrains](https://github.com/ZyFou/ProceduralTerrains) (619★) | MIT | Reference for planet mode and LOD |
| Post-processing | pmndrs `postprocessing` | MIT | Better bloom, SMAA, LUT colour grading; takram depends on it |
| Real night sky: 1.7 billion stars (Gaia DR2 + Hipparcos + Tycho) | [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851) | Credit NASA/GSFC SVS and ESA/Gaia/DPAC | Far background behind our galaxy |
| Blender procedural planet generator (geometry nodes, rings, moons) | [Kimalio/ppg](https://github.com/Kimalio/ppg) | MIT | Blender posters of planets and systems |
| Spaceships and props | Quaternius, Kenney | CC0 | Contributor ships, spaceports, release rockets |
| HDRIs and textures | Poly Haven | CC0 | Blender renders |

## Status (2026-10-02)

| Piece | State | Where |
|---|---|---|
| Galaxy: 3,959 seeded worlds, sectors, 240 protostars, git singularity, fly-in, the galaxy as of any year (`setYear`) | ✅ v0 | `src/universe/galaxyView.js`, `tools/universe/seed.mjs` |
| Worlds: baked cube-map terrain and clouds, raymarched atmosphere, language styles, night lights (an anti-aliased street network) and highways, civilisation by level | ✅ v0 | `src/universe/planet.js`, `planetView.js` |
| Landing: dusk sun, an arc around the world (never through it), descent through the clouds, arrival in the city | ✅ | `planetView.js`, `src/main.js` (`?arrive`) |
| Story: prologue, Galactic Codex, levels, sectors | ✅ | `src/universe/lore.js`, `docs/LORE.md` |
| Blender posters of worlds and cities | ✅ | `tools/blender/render_planet.py`, `render_city.py` |
| Organisation star systems: a star, megastructure arcs, the flagship as a Dyson ring, member worlds | ✅ v0 | `src/universe/orgView.js`, `tools/universe/seed-orgs.mjs` |
| Mapping service: uncharted cities surveyed on demand, with progress | ✅ v0 (runs locally and in Docker; not hosted yet) | `server/`, `src/config.js` |
| Live events: supernovae, release rockets, asteroid impacts, galactic news | ✅ v0 | `tools/universe/events.mjs`, `src/cityEvents.js` |
| The film, "The Big Bang of open source": director mode, frame-by-frame capture, synthesised score | ✅ | `src/universe/director.js`, `src/cityDirector.js`, `tools/video/` |
| The cluster: 14 galaxies by kind of code, git at the centre, migration comets | ✅ v0 | `src/universe/cosmos.js`, `universeView.js` |
| One continuous zoom from the cluster to a line (scale ladder, push past a scale's limit) | ✅ | `src/scale.js`, every view's `zoomTarget()` |
| A city for any public repository, raised live from the GitHub API (4 requests) | ✅ | `src/liveCity.js` |
| A living universe: daily reseed, migration log, joining by star | ✅ v0 | `tools/universe/seed.mjs`, `.github/workflows/universe.yml` |
| Living details: night traffic, aurorae by activity, contributor fleets, a cosmic web, a warp between scales | ✅ | `src/traffic.js`, `planet.js`, `universeView.js`, `materials.js` (FinishShader `uWarp`) |
| A time machine in every galaxy; an autopilot from the cluster to any world (`?home=`) | ✅ | `galaxyView.js`, `src/universe/main.js` |
| World cards for READMEs (animated SVG, a GitHub Action) and a share panel | ✅ | `src/card.js`, `card/`, `src/universe/share.js` |
| A film of any city, recorded in the browser with its soundtrack | ✅ | `src/recorder.js`, `src/cityDirector.js`, `public/media/city-film.mp3` |
| Live ambient sound (WebAudio) | ✅ | `src/sound.js` |

Implementation notes:
- **Terrain is baked once per world into a half-float cube map** (height in R, clouds in G), plus an equirectangular land mask read back to the CPU for placing cities. Per-frame shading then samples only textures.
- **The atmosphere is a back-faced shell** that ray-marches single scattering (after glsl-atmosphere) from the real camera position, so it works both from orbit and during the descent.
- **Cities are placed deterministically** (seeded by `login/repo`) on land, biggest first. The same rules run in the Blender script, which rebuilds the terrain with `mathutils.noise`.

## Build order

1. **One person's planet.**
   - A procedural planet seeded by the person's languages: oceans, continents, atmosphere, clouds.
   - Each repo is a city of lights on a continent, sized by its code.
   - Orbit it, click a city, and fly down through the atmosphere and clouds into our city view.
   - Demo subject: a prolific developer with many famous repos.
2. **A solar system.** An org sun with megastructure rings for the org's repos and member planets on orbits; fly between them.
3. **The galaxy.** Seed 100k–1M accounts (GH Archive, GitHub search), in spiral arms by language and age; search, fly-to, land.
4. **Ingest service.** Unknown planets and cities are built on first visit; "add yourself".
5. **Events and the flagship video.** Release rockets, refactor asteroids, the stargazer sky, "The Big Bang of open source".
