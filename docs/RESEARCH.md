# Prior art and positioning

*Researched 2026-09-30. Star counts from the GitHub API on that day.*

## TL;DR

- **The idea is crowded.** "Repo as a 3D city" has at least 15 public implementations from 2025–2026 alone, several with timelapse or an AI chat. None of them passed ~60 stars. The idea alone won't carry us.
- **What spread was the artifact and the entry point, not the metaphor.** The adjacent projects that did break out (gitdiagram 17.6k★, Gource 13.2k★, git-city 5.8k★, codeflow 5.4k★, gitlogue 5.1k★) win on a one-step entry (paste a URL, or swap `hub` for `diagram` in it), a shareable output (video, card, image), and a strong look.
- **The gap:** nobody combines **correct full history** (renames + demolitions), a **cinematic, deterministic video export**, and an **AI guide whose claims are verified against the code** and drive the camera. That combination is our wedge.

## Landscape

### Adjacent projects that broke out

| Project | ★ | What it is | Why it spread | What we take |
|---|---|---|---|---|
| [acaudwell/Gource](https://github.com/acaudwell/Gource) | 13.2k | 2D animated tree of a repo's history (since 2009) | Videos of famous repos; offline render to ffmpeg | Frame-by-frame render → ffmpeg; captions, date counter, speed controls |
| [ahmedkhaleel2004/gitdiagram](https://github.com/ahmedkhaleel2004/gitdiagram) | 17.6k | AI architecture diagram of any repo | **Replace `hub` with `diagram` in a GitHub URL**; now also 1-min narrated videos (16:9 and 9:16, burned captions) and an MCP server | URL swap as the entry point; a vertical video format; an MCP server so agents can use it |
| [srizzon/git-city](https://github.com/srizzon/git-city) | 5.8k | Your GitHub *profile* as a pixel-art building in a shared city | Identity and social loop: claim your building, share cards, compare mode | Share cards (landscape + stories); **compare mode** ("React vs Vue skyline") |
| [braedonsaunders/codeflow](https://github.com/braedonsaunders/codeflow) | 5.4k | Paste a GitHub URL → dependency graph, blast radius, health score | Zero setup, browser-only, answers a real question ("what breaks if I change this?") | Blast radius / dependencies as roads (later) |
| [unhappychoice/gitlogue](https://github.com/unhappychoice/gitlogue) | 5.1k | Cinematic commit replay in the terminal | "Cinematic" + screensaver mode | Screensaver / ambient mode |
| [erikbern/git-of-theseus](https://github.com/erikbern/git-of-theseus) | 3.0k | Stacked plots of code survival by cohort ("half-life of code") | A striking, true insight about code age | **Code strata:** building floors coloured by the year their lines were written |
| [rodrigo-brito/gocity](https://github.com/rodrigo-brito/gocity) / [aserg-ufmg/JSCity](https://github.com/aserg-ufmg/JSCity) | 1.8k / 1.4k | Classic code cities for Go / JS | First "paste a repo" code cities | Language-agnostic from day one (we count lines, not ASTs) |
| [githubocto/repo-visualizer](https://github.com/githubocto/repo-visualizer) | 1.3k | GitHub Action that commits an SVG diagram of the repo to README | Lives in READMEs, which is free distribution | **A GitHub Action that renders your repo's timelapse GIF/MP4 for the README** |
| [honzaap/GithubCity](https://github.com/honzaap/GithubCity) | 1.3k | Contribution calendar as a 3D city | Pretty and personal | — |
| [MaibornWolff/codecharta](https://github.com/MaibornWolff/codecharta) | 540 | Enterprise code-metrics city | Deep metrics | Hotspot = size × churn |

### Direct competitors (repo → 3D city, 2025–2026)

| Project | ★ | Notes |
|---|---|---|
| [thalida/codecity](https://github.com/thalida/codecity) ([codecity.io](https://codecity.io)) | 3 | Streets = dirs, buildings = files, commits grow trees, authors are fireflies. Docker, hosted. **The URL carries the whole view state**, including the timeline commit and the selection. |
| [maximalcode/git-city](https://github.com/maximalcode/git-city) | 3 | Desktop git client on top of a city; history replays in ~10 s; **sky follows each commit's local hour**; six colour encodings with legends; footprint from peak LOC. |
| [Cristofervaltz/RepoRewind](https://github.com/Cristofervaltz/RepoRewind) | 28 | 3D force graph plus time scrubbing; local WebLLM "storyteller" narrates eras. |
| [Manavarya09/code-city](https://github.com/Manavarya09/code-city) | 9 | Client-side via GitHub API, `?repo=` links; bug-fix commits become fires, contributors walk around. Time travel is still on its wishlist. |
| [hyeonsangjeon/Repolis](https://github.com/hyeonsangjeon/Repolis) | 47 | Walkable town of a *user's* repos; natural-language search ("Gitber") drives you to a repo. |
| [parrisdigital/repository-city](https://github.com/parrisdigital/repository-city) | 5 | Profile → metropolis; file categories (src/test/docs/config) as materials; PNG export; aggregation for large trees. |
| ViewGit ([dev.to](https://dev.to/viewgit/visualize-your-git-repository-as-a-3d-city-28j0)), [RepoVerse](https://repoverse.online/), [bryan-uipath/code-city](https://github.com/bryan-uipath/code-city), [grahambrooks/codecity](https://github.com/grahambrooks/codecity), [Pardesco/hypernovum](https://github.com/Pardesco/hypernovum), [Mdeux25/agentwatch](https://github.com/Mdeux25/agentwatch), [cosmo666/codemap](https://github.com/cosmo666/codemap), [ProdByRnV/semantic-codebase-navigator](https://github.com/ProdByRnV/semantic-codebase-navigator) | 0–96 | Variations: CLI dashboards with an AI chat, VS Code extensions, RAG chat next to a 3D view, agent-activity maps. |

### Research

Wettel, Lanza & Robbes ran a controlled experiment on CodeCity ([ICSE 2011](https://wettel.github.io/download/Wettel11a-icse.pdf)). Participants were **+24% more correct and 12% faster** than an Eclipse + Excel baseline. The gain came on tasks that need an **overview**; tasks that need a **precise** answer showed no advantage. → We position Commitropolis for overview, onboarding and storytelling, and hand precise questions off to the code: every building links to the file at the exact commit.

## Weaknesses we saw across the field

1. **History is missing or wrong.** Most tools show only the current tree (the GitHub tree API has no history). The ones with a timelapse replay history on the HEAD layout and neither follow renames nor show deletions. We measured what this costs on `expressjs/express`:
   - **66% of all lines ever added** went into paths that no longer exist at HEAD. Following renames only moves this from 34% to 36%, so the rest is genuinely deleted code: `docs/` (moved out in 2012), the old `spec/` suite, and middleware/router code extracted from `lib/`.
   - In 2009–2013, only **35% of commits** (1,371 of 3,869) touch a path that exists today.

   A HEAD-only timelapse therefore shows an almost empty city for its first four years and misses the biggest events in the repo's life.
2. **Scale caps.** Browser-only tools hit GitHub API limits (60 req/h unauthenticated, truncated trees) and cap at roughly 10k files or aggregate. None of them show Linux.
3. **No real video export.** You get screen recordings at best. gitdiagram narrates 2D diagrams; Gource videos are 2D and have no narration.
4. **The AI is bolted on.** It is a generic RAG chat panel, or era text that isn't tied to the camera. Nobody verifies that a cited file or line actually says what the model claims.
5. **Gimmicks over meaning.** Fires, walking characters and farm mode are fun, but they don't answer a question. Every visual encoding we add should mean something.

## How we stand out, ranked by leverage

1. **Honest history** (already in the MVP). File identity is carried through renames, and every file that ever existed gets a lot. The timelapse shows construction *and demolition* (red flashes, then ruins).
2. **Cinematic export.** A deterministic frame renderer produces 60 fps MP4 at 16:9 and 9:16, with a date counter and era captions. A gallery of famous repos is pre-rendered.
3. **AI director + grounded guide.** Eras come from churn change-points and are labelled from commit messages. "Show me where login happens" returns a multi-stop camera tour whose citations are verified against the file text before the camera moves. Tours are shareable links and can be rendered to video.
4. **Scale.** Linux-class repos run at 60 fps thanks to time-bucketed deltas, sparse GPU updates and prebaked bundles.
5. **Signature visuals that carry meaning.** Lit windows mean recent work, so abandoned code goes dark. Commits are beams of light. Floors are lines of code: walking into a building opens its code, and scrolling rides an elevator up the facade. Next come code strata (blame age per floor), demolition scenes, and a morph between the folder layout and a semantic (embedding) layout that shows where the architecture and the folder tree disagree.
6. **Built-in distribution.** URL swap, a README Action/badge that renders your repo's timelapse, share cards, a compare view, an embeddable iframe, and an MCP server ("show this in the city").

## Naming

"Git City", "GitCity", "CodeCity" and "Code City" are each used several times ([google/CodeCity](https://github.com/google/CodeCity), [thegitcity.com](https://thegitcity.com), [codecity.io](https://codecity.io), …). We picked **Commitropolis**: no GitHub repository used that name as of 2026-09-30.
