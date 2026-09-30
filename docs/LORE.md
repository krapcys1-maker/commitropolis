# The Commitverse: lore bible

Every myth here is a measurement. If a rule can't be computed from public git or GitHub data, it doesn't go in.

## Prologue

> In 2005 a single commit set off a singularity. It was called **git**, and everything since has orbited it.
> In 2008 the universe began to expand: worlds formed around people, cities grew around their ideas, and every time someone left a star, a new light appeared in that world's sky.
> Most worlds are small and quiet. A few burn so brightly they bend the galaxy around them. New ones are born every second, out at the edge.
> You are a cartographer of the **Commitverse**. Your ship, your planet and your map start today.

## The galaxy and its sectors

| Sector | Who lives there | Rule (data) | Look |
|---|---|---|---|
| **The Singularity** | `git` itself | Fixed at the galactic centre | A black hole with an accretion disk made of commits |
| **Ancient Worlds** (the core) | Foundational projects: kernels, compilers, languages, early infrastructure | Oldest accounts and repos with sustained activity (IDs near the start and a long history) | Old gold stars, dense and calm |
| **The Titan Cluster** | The biggest organisations: big tech | Orgs above a threshold of total stars and repos | Giant blue stars ringed with megastructures (their flagship repos) |
| **The AI Nebula** | Organisations and repos of the AI wave | AI topics, LLM SDK usage, the AI orgs | A violet nebula that ignites around 2023 and is still the fastest-growing region |
| **The Language Arms** | Most developers | An account's dominant language picks its spiral arm (TypeScript, Python, Rust, Go…) | Each arm tinted in its language colour |
| **The Stellar Nursery** | **Promising new repos** | Created in the last 12 months, with star velocity in the top percentile | Glowing gas clouds with protostars forming inside; this is where discoveries happen |
| **The Frontier** | The newest accounts | Highest account IDs | The sparse outer rim, still forming |
| **The Silent Belt** | Archived and long-abandoned projects | Archived flag, or no pushes for more than 2 years | Cold remnants, drifting ice worlds; a memorial, not a graveyard |

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
- **Archived = frozen.** Ice spreads over the planet and it drifts into the Silent Belt.

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
- **Discover.** Visit protostars in the Stellar Nursery. If a repo you visited early later reaches 1,000 stars, **your flag stays on it as a first discoverer**. It's a reason to come back every day, and a real, provable claim ("I found it at 40 stars").
- **Travel log.** A passport of the worlds you have landed on, stamped with their level when you arrived.
- **Expeditions.** Guided tours narrated by the AI guide, from verified sources:
  - *The Great Framework Wars* (jQuery → Backbone → Angular → React → Vue → Svelte)
  - *The Rise of the AI Nebula*
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
