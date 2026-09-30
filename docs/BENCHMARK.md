# Benchmark: how far behind are we?

*2026-09-30. Checked live in the browser (demos) and against READMEs and screenshots. Scores are 0–5 and subjective, but each one is backed by something we saw.*

## The field, best first

| Project | ★ | What it is | What it does best |
|---|---|---|---|
| [thegitcity.com](https://thegitcity.com) ([srizzon/git-city](https://github.com/srizzon/git-city)) | 5.8k | GitHub *profiles* as buildings in one shared city (87k buildings) | **Product and spectacle.** A terminal-style loader, a scripted fly-over intro with captions, real geography (a bay and a bridge from OpenStreetMap), a lo-fi radio, 4 themes, a graphics-quality switch, a fly-and-collect-coins game, leaderboards, a shop, a live activity ticker, "Road to 100K" |
| [codecity.io](https://codecity.io) ([thalida/codecity](https://github.com/thalida/codecity)) | 3 | **Our direct competitor:** any repo → city | **Paste any git URL** (GitHub, GitLab, Codeberg, Bitbucket) with a step-by-step build log. A floating island in space. **A real street network** with folder names painted on the roads, file-type icons on the roofs, a forest (commit = tree), fireflies (authors), a Live/Timeline switch |
| [Repolis](https://hyeonsangjeon.github.io/Repolis/) | 47 | A user's repos as a walkable town | **Life and charm.** A third-person avatar, named NPC residents with routines, a plaza with a fountain, a campfire and benches, a "Gitber" taxi that drives you to a repo, a guided tour |
| [GithubCity](https://honzaap.github.io/GithubCity) | 1.3k | Contributions as a low-poly city | **Handmade assets.** Modelled buildings, roads, a beach, palms, mountains, wind turbines, birds |
| [Gitlantis](https://github.com/liltrendi/gitlantis) | 501 | Repo as an ocean (VS Code) | **Game feel.** Sail a boat between lighthouses (folders) and buoys (files); minimap, compass, breadcrumbs |
| [maximalcode/git-city](https://github.com/maximalcode/git-city) | 3 | Desktop git client on a city | **Modes.** 6 colour encodings with legends, Night / Golden Hour, a minimap, farm mode, PR blast radius, a 10-second history replay |
| [Gource](https://github.com/acaudwell/Gource) | 13.2k | History as a 2D animated tree | **The video.** Contributor avatars fly to files and zap them; offline render to ffmpeg |

## Scorecard

| | Us | best in class |
|---|---|---|
| **World** | | |
| Landscape / setting | 1: a dark grid | 5: GithubCity, Repolis |
| Streets | 1: outlines only | 5: codecity.io (named roads) |
| Building variety and detail | 2.5: blocks and towers, procedural windows | 5: GithubCity, Repolis |
| Life (traffic, people, creatures) | 1: beams during the timelapse only | 5: Repolis |
| Lighting and post-processing | **4**: night, bloom, reflections | 4: Git City |
| Offline, poster-quality renders | **5**: Blender/Cycles | 1: others offer PNG export at best |
| **Product** | | |
| "Paste a URL → city" | 0: CLI ingest only | 5: codecity.io, Git City |
| Loading and first impression | 1 | 5: Git City's terminal intro |
| Cinematic intro | 2: auto-orbit | 5: Git City |
| Navigation aids (minimap, compass, breadcrumbs) | 1: search | 4: maximalcode, Gitlantis |
| Themes and quality settings | 0 | 4: Git City, maximalcode |
| Sound | 0 | 3: Git City's radio |
| Social and viral loops | 1: deep links | 5: Git City |
| **Meaning** | | |
| Honest history (renames, demolitions) | **5** | 3: maximalcode's timelapse |
| Encodings that mean something | **4**: lit windows = recency, beams = commits | 4: codecity.io (trees, fireflies) |
| Reading code inside the world | **4**: elevator, floors = lines | 3: Gitlantis opens the file in the editor |
| AI | 0 (designed) | 3: Repolis' Gitber |

**Verdict.** Our *ideas* are ahead: honest history, the code elevator, Blender posters. Our *world* and our *product* are a skeleton. Next to codecity.io our city looks like a debug view: no roads, no landscape, no life, and you can't even paste a URL. That is fixable, and the fixes can carry meaning, which none of the others manage.

## What to build, in order

### 1. A world, not a chart (the biggest gap)

Every element carries data, as the lit windows already do.

- **Setting.** The city on an island at night, with a reflective sea around it (the neon mirrored on the water), hills behind, a moon and slow clouds. It frames every screenshot and video.
- **Street network.** The treemap gaps become real roads with asphalt, lane markings, sidewalks, crosswalks and street lamps. **Folder names are painted on the road**, like codecity.io, but in our neon style. Main avenues are top-level folders, side streets are subfolders.
- **Architecture by file type**, so you can read the city like a map:

  | File type | Building |
  |---|---|
  | source | glass towers |
  | tests | concrete labs with rooftop antennas |
  | docs | old library with a pitched roof |
  | config | small utility buildings, tanks and pipes |
  | assets | warehouses |
  | CI (`.github`) | control tower |
  | README | town-hall landmark at the root |
  | lockfiles and manifests | harbour cranes and containers |

- **Rooftops.** AC units, water towers, helipads on the giants, and **neon signs with the file name** on the biggest buildings.
- **Nature with meaning.** Parks in districts of **old, stable code**: the longer the code has lasted unchanged, the bigger the trees. Churn keeps a district paved; stability grows greenery.

### 2. Life, tied to history (the video depends on it)

- **Contributor drones (Gource's best idea, in 3D).** Every author is a glowing drone with their avatar colour. In the timelapse it flies to the files it commits and builds them (the beam). The crowd over hot spots shows where the team works.
- **Traffic.** Cars with headlights and taillights flow along the streets. Density follows the commit rate of the district, so a busy era is rush hour.
- **Weather as eras.** Rain during big refactors (commits that delete a lot); a clear night during calm maintenance.
- **Sound.** Soft ambient city sound plus **the history as music**: each commit is a note, with pitch by file type and loudness by size. It is new, and it's made for the video.

### 3. Product: the first 10 seconds

- **Paste any git URL → city.** An ingest service (a queue, a worker, and cached bundles per `repo@sha`) with a **live build log** styled like `git clone` output. The gallery of famous repos is prebaked, so it opens instantly.
- **A cinematic intro per repo.** Fly-over with captions: name, age, contributors, the biggest demolition, the tallest tower.
- **Navigation.** A minimap with a compass, breadcrumbs for the current district, and a "where am I" pin.
- **Themes.** Neon Night (default), Golden Hour, Blueprint, and a graphics-quality switch.
- **Share.** Poster export, "then vs now" cards, a compare view (React vs Vue skylines).

### 4. The AI guide (designed in [ARCHITECTURE.md](ARCHITECTURE.md#6-ai-layer))

It lands on top of a world that is worth touring.

## The big idea: a land of cities (open source as one world)

**Proposal.** Instead of one city at a time, a whole land. Every repository is a settlement on a shared map, anyone can add theirs, and clicking a settlement flies you down into its city (what we have now). Leave it and you are back on the map, where you can travel on or search by type.

**Verdict: yes, and it should become the product's top layer.** The reasons:

- **It is what spread elsewhere.** Git City's 5.8k stars come from one shared world where everyone looks for themselves. [Map of GitHub](https://anvaka.github.io/map-of-github/) (anvaka, 2.9k★) proved people love a *map* of open source, but there each repo is a dot. We would be the first map where every dot is a real, enterable city with its history.
- **It gives a clean zoom from a world down to one line of code.** World → region (ecosystem) → settlement (repo) → district (folder) → building (file) → floor (lines). Essentially Google Earth for open source.
- **It's a growth loop.** "Add your project" plus a README badge ("visit our city") means every added repo advertises the map.
- **It fixes the one-off problem.** A single visualizer gets tried once; a world gets explored.

### Geography that means something

| Map feature | Data |
|---|---|
| Regions / countries | Ecosystems. By language to start; later clusters by shared stargazers (anvaka's method) or by dependencies |
| Village → town → city → metropolis | Repository size (LOC / files) |
| Night lights on the map | Activity in the last 30 days |
| Ghost towns | Archived repositories |
| Roads between settlements | **Dependencies**, like trade routes. Heavily used libraries become highway hubs |
| Neighbours on the horizon, seen from inside a city | Its dependencies; click one to travel along the road |

### The empty-world problem, solved by seeding

- **Map content from metadata only:** 500–1000 top repositories across languages, using stars, language, topics, size, last push and archived from the GitHub API. This is cheap (~300 KB), so the map is full on day one.
- **Prebaked cities:** the 50–100 most famous repos are fully ingested, so they open instantly.
- **The rest are "unexplored":** visible on the map as construction sites. The first visitor triggers the ingest, with the city being built live, and afterwards it is cached for everyone. The wait becomes a feature.
- **Add yours:** paste a URL, and the repo is ingested and placed in its region next to similar projects, with a permalink and a badge. Public repos only, with size limits and rate limits; a GitHub login is needed to add, to keep spam out.

### Costs and risks

- **The ingest service moves up the roadmap.** It was planned anyway; the world needs it for "unexplored" and "add yours".
- **Storage.** Roughly 0.5–5 MB per city bundle, so a few GB for thousands of cities. Cheap on object storage.
- **Rendering the map.** Thousands of settlements as instanced mini-skylines on procedural terrain, with LOD. Cheap. City bundles load only on entry.
- **The biggest risk is order, not tech.** A world of plain box-cities disappoints more than one box-city. The cities have to look good first.

## Proposed order of work

1. **City world v1:** street network with painted names, architecture by file type, rooftops, and water and terrain around the city. *After this, a screenshot beats codecity.io.*
2. **The land v0:** a seeded map (500–1000 repos from metadata, 50–100 prebaked cities), regions by ecosystem, dependency roads, search and filters, and the dive-in / fly-out transition.
3. **Life v1 and the first video:** contributor drones, traffic, the commit soundtrack; render "Express: 17 years in 30 seconds".
4. **Ingest service:** unexplored settlements get built on first visit, "add your project", badges.
5. **AI guide.**
