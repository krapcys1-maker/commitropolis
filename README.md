# Commitverse

**The universe of open source.** Every GitHub account is a world, every repository is a city on it, and every star is a light in its sky. Fly from the whole galaxy down to a single line of code.

![Andrej Karpathy's world, a Level 6 Ecumenopolis: city lights on the night side, an orbital ring with a space elevator](docs/img/planet-karpathy.jpg)
<sub>@karpathy's world, rendered with Blender Cycles from real GitHub data. 494,341 ★ make it a Level 6 *Ecumenopolis*, 5,659 ★ short of *Galactic*. Its cities are nanoGPT, nanochat, llm.c, autoresearch…</sub>

## Travel

| The galaxy | A world | A building's code |
|---|---|---|
| ![The GitHub galaxy: spiral arms by language, the git singularity at the centre, the AI Nebula and the Stellar Nursery](docs/img/web-galaxy.jpg) | ![Night side of a world: city lights joined by highways, an orbital ring, a rocket launch](docs/img/web-planet-night.jpg) | ![Inside a building: scrolling the code rides an elevator up its floors](docs/img/web-code-elevator.jpg) |
| 3,953 real accounts in language arms and named sectors. Older accounts sit closer to the core: the galaxy grew outward the way GitHub did. | A person's repositories are cities on their continents. The level of civilisation comes from their stars; the lights come from recent work. | Land in a city to walk its history. Files are buildings, folders are districts, a building's floors are its lines of code. |

**Every world looks like its maker.** Rendered with Blender from the same rules as the browser:

| @sindresorhus · JavaScript desert · *Galactic* | @torvalds · C ice world · *Ecumenopolis* |
|---|---|
| ![A golden desert world with highways of light and two orbital rings](docs/img/planet-sindresorhus.jpg) | ![A cold ocean-and-ice world with an orbital ring and a space elevator](docs/img/planet-torvalds.jpg) |

**One continuous zoom:** galaxy → sector → star system → world → city → building → floor → line. Every visual rule is a measurement, so nothing is decoration:

| You see | It means |
|---|---|
| A world's size of civilisation (Dust → Galactic) | Total stars of the account, on a log scale: satellites at Colony, a moon base at Civilisation, a spaceport launching rockets at Industrial, an orbital ring and a space elevator at Spacefaring, a second ring and a swarm at Galactic |
| The kind of planet | Its main language: Python worlds are temperate, JavaScript worlds are deserts, Rust worlds rust, C worlds are ice |
| City lights on the night side | Where work happened recently; quiet code goes dark |
| Highways of light | Neighbouring cities (repos) of one world |
| The Stellar Nursery | Repositories born this year that are rising fast (protostars) |
| The AI Nebula, the Titan Cluster, the Silent Belt… | Sectors computed from topics, organisation size, archived state ([the lore](docs/LORE.md)) |
| git at the centre | Everything here is built with it |

## Honest history

| Express, mid-2011 | Express today |
|---|---|
| ![Express in 2011: a docs district in the middle of the city](docs/img/express-2011.jpg) | ![Express today: that district is gone, its lots are empty](docs/img/express-now.jpg) |

Cities keep their whole past. Files are followed through renames, and deleted code is demolished on screen. In Express, **66% of all lines ever added went into paths that no longer exist**, so a city built only from today's files would miss most of its story.

## Run it

```bash
npm install
npm run dev
```

It opens the galaxy. Search `@anyone` to fly to their world: showcase worlds are prebaked, and any other account is fetched live from the GitHub API.

Grow the universe yourself:

```bash
GITHUB_TOKEN=$(gh auth token) node tools/universe/seed.mjs   # reseed galaxy + showcase worlds
npm run ingest -- karpathy/nanoGPT                           # map a city's full history
```

## Posters with Blender

The same data can be rendered in Blender Cycles, which gives real atmosphere, glass and haze. You need [Blender](https://www.blender.org/download/) 5.x; a GPU helps.

```bash
blender -b -P tools/blender/render_planet.py -- --planet public/universe/planets/karpathy.json --out world.jpg
blender -b -P tools/blender/render_city.py -- --data public/data/expressjs-express.json --out city.jpg --at 2011-06-01
```

## Status

This is an early universe. Working now:
- the galaxy with sectors and protostars;
- worlds with levels, styles and night lights;
- landing into cities;
- the timelapse with demolitions;
- the code elevator;
- the lore prologue and the Codex;
- Blender posters.

Next up: solar systems for organisations, the "add your world" ingest service, release rockets and refactor asteroids from real events, and the AI guide. See [VISION](docs/VISION.md), [LORE](docs/LORE.md), [UNIVERSE_TECH](docs/UNIVERSE_TECH.md), [ARCHITECTURE](docs/ARCHITECTURE.md) and [BENCHMARK](docs/BENCHMARK.md).

## Credits

- Night sky: **NASA/Goddard Space Flight Center Scientific Visualization Studio**, Deep Star Maps 2020. Gaia DR2: ESA/Gaia/DPAC.
- Atmospheric scattering after [wwwtyro/glsl-atmosphere](https://github.com/wwwtyro/glsl-atmosphere) (Unlicense).
- Simplex noise: [ashima/webgl-noise](https://github.com/ashima/webgl-noise) (MIT).
- Built with [three.js](https://threejs.org), [Vite](https://vite.dev), [highlight.js](https://highlightjs.org) and [Blender](https://www.blender.org).
- Data: public GitHub API and git history.

## License

[MIT](LICENSE)
