# The Commitverse: lore bible

Every myth here is a measurement. If a rule can't be computed from public git or GitHub data, it doesn't go in.

## Prologue

> In 2005 a single commit set off a singularity. It was called **git**, and everything since has orbited it.
> In 2008 the universe began to expand: worlds formed around people, cities grew around their ideas, and every time someone left a star, a new light appeared in that world's sky.
> Most worlds are small and quiet. A few burn so brightly they bend the galaxy around them. New ones are born every second, out at the edge.
> You are a cartographer of the **Commitverse**. Your ship, your planet and your map start today.

## The cluster of galaxies

The Commitverse is a cluster of **14 galaxies** around **git**, the singularity at its centre. Every world (account) belongs to exactly one galaxy. The rules run in this order, so the first one that fits wins ([cosmos.js](../src/universe/cosmos.js)):

| Galaxy | Who lives there | Rule (data) | Look |
|---|---|---|---|
| **The Titan Galaxy** | The giants of GitHub | 100,000 stars or more | A golden giant elliptical around git |
| **The AI Galaxy** | Worlds that build AI | AI topics on most of their stars, or one of the AI labs | A violet two-armed spiral |
| **The Silent Galaxy** | Worlds that went quiet | Archived, or nothing pushed for two years | A dim, distant elliptical: a memorial, not a graveyard |
| **The Python, JavaScript, TypeScript, Rust, Go, C & C++, JVM & .NET, Apple & Mobile, Functional and Scripting Galaxies** | Everyone else | The family of the world's main language (the Scripting Galaxy takes every language without a galaxy of its own) | Spirals in their languages' colours, one arm per language |
| **The Rising Galaxy** | Protostars: promising new repos | Created in the last 12 months, among the fastest-climbing | An irregular galaxy of pink star-forming knots; this is where discoveries happen |

Inside a spiral, **older worlds sit nearer the core**: user IDs are sequential, so a galaxy grew outward the way GitHub did. Inside an elliptical, the brightest worlds sit at the heart.

### Migrations: the universe is alive

The universe is reseeded from GitHub every day ([universe.yml](../.github/workflows/universe.yml)). Whatever changed becomes history:

- **Ignition.** When a protostar passes **100,000 ★** it ignites. It leaves the Rising Galaxy, and its world joins the Titans. You see it cross the cluster as a comet.
- **Migration.** A world whose numbers carry it into another galaxy moves there: it grows into a Titan, falls silent, or turns to AI. The move goes into the migration log and the galactic news.
- **Joining.** Anyone who stars the project's repository gets a world in the galaxy of their language at the next update.

### The one galaxy (the film)

Before the cluster split up, the Commitverse was drawn as a single galaxy with sectors. That is how it looks in the film, and it is still there at `?galaxy=all`. Its sectors were the Ancient Worlds (the oldest accounts) at the core, the Titan Cluster, the AI Nebula, the Language Arms, the Stellar Nursery, the Frontier and the Silent Belt.

## Planet development: stars are energy

A planet (a person) develops with the **total stars across its repos**. The scale is logarithmic, like a Kardashev scale for open source.

| Level | Stars | The world |
|---|---|---|
| 0 · Dust | 0 | A bare rock, one campfire (the first commit) |
| 1 · Outpost | 1–9 | A few lit huts, dirt tracks |
| 2 · Colony | 10–99 | Towns joined by roads, a first satellite |
| 3 · Civilisation | 100–999 | Night lights visible from orbit, a moon base |
| 4 · Industrial | 1k–9.9k | Megacities, a spaceport launching rockets on every release |
| 5 · Spacefaring | 10k–99k | An orbital ring, a space elevator, fleets of contributor ships |
| 6 · Ecumenopolis | 100k–499k | City lights over the whole night side, ring stations |
| 7 · Galactic | 500k+ | Bends its region: its own halo of light, visible from anywhere |

**Each city (repo) has its own tier by its own stars:** village, town, city, metropolis. A metropolis gets a landmark tower and its own spaceport.

Two rules keep the world alive:

- **Activity keeps the lights on.** A planet whose repos go quiet slowly dims: roads crack, greenery takes back the streets. Work brings it back.
- **Archived = frozen.** Ice spreads over the planet and it drifts into the Silent Galaxy.

Stars measure attention, not quality. The lore says so openly: some of the best code lives on quiet planets, and the guide shows people where.

## Phenomena (live events)

| Phenomenon | Data | What you see |
|---|---|---|
| **Supernova** | A repo gains stars explosively (e.g. +5k in a week) | A flash seen across the galaxy, and an entry in the galactic news |
| **Comet** | A repo that trended hard, then went quiet | Flies across its arm with a fading tail |
| **Pulsar** | Releases on a steady rhythm | Blinks at its real release cadence |
| **Binary stars** | Two projects that always change together (co-committed, shared maintainers) | Two worlds orbiting each other |
| **Launch** | A release tag | A rocket with the version number lifts off the spaceport |
| **Impact** | A massive refactor or deletion | An asteroid strike: a crater, then regrowth (the demolitions we already show) |
| **Gravity** | Number of dependents | Heavy libraries bend the space around them; the orbits of dependent worlds lean toward them |
| **Storms** | Open issues on a district | Weather over that part of a city |

## You, the cartographer

- **Claim your planet.** Sign in with GitHub, land on your own world, and watch it evolve as you ship.
- **Discover.** Visit protostars in the Rising Galaxy. If a repo you visited early later reaches 1,000 stars, **your flag stays on it as a first discoverer**. It's a reason to come back every day, and a real, provable claim ("I found it at 40 stars").
- **Travel log.** A passport of the worlds you have landed on, stamped with their level when you arrived.
- **Expeditions.** Guided tours narrated by the AI guide, from verified sources:
  - *The Great Framework Wars* (jQuery → Backbone → Angular → React → Vue → Svelte)
  - *The Rise of the AI Galaxy*
  - *Ancient Worlds: the code that runs everything*
- **Galactic news.** Supernovae, launches, impacts and new protostars, as a live feed and a daily digest.

## Field notes from the first survey (2026-09-30)

True observations from the seeded data. The universe writes its own stories.

- **The most influential AI code is tiny.** nanoGPT (63k ★) is a city of 24 buildings. micrograd (17k ★) has 10.
- **@karpathy's world is 5,659 ★ short of Galactic.** Today it is an Ecumenopolis with 494,341 ★.
- **@sindresorhus is already Galactic.** 1,130 cities, more than a million stars, two orbital rings.
- **Some giants live in systems, not on worlds.** @dhh's personal world is small (392 ★) because Rails belongs to an organisation's star. The map is honest about where things live.
- **Most of a city's past is gone.** In Express, two thirds of all lines ever written went into paths that no longer exist.
- **The Titan Cluster is heavy.** @microsoft alone carries 2.1M ★ across the surveyed repos.

## Tone and naming

- The name is **Commitverse**, with Commitropolis as the first city. We don't borrow GitHub's own names (such as "Octoverse").
- Real organisations and people appear as they appear on GitHub (public accounts, public data), with no logos and no invented claims. Framing stays positive or neutral: archived projects go to a *memorial* belt, and no real project is "swallowed by a black hole".
- The style is awe first and humour second. It should feel like a planetarium show, not a meme.
