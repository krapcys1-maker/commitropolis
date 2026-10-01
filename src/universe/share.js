import { worldCard, worldOf, SITE } from '../card.js';

// "Share this world": the world's card for a profile README (download it, or let a daily GitHub
// Action redraw it), a link to the world, and the usual places to post it.

export const REPO = 'krapcys1-maker/commitverse';
const enc = encodeURIComponent;

export function shareHtml(data) {
  const svg = worldCard(worldOf(data, data.repos));
  const url = `${SITE}?planet=${enc(data.login)}`;
  return `
    <div class="share">
      <img class="share-card" alt="@${data.login}'s world card" src="data:image/svg+xml;charset=utf-8,${enc(svg)}" />
      <div class="share-row">
        <button class="chip world" data-share="svg">⬇ Download card</button>
        <button class="chip world" data-share="md">⧉ README snippet</button>
        <button class="chip world" data-share="yml">⧉ Daily update</button>
      </div>
      <p class="note">Put the card in your profile README. With the <i>Daily update</i> workflow in your profile repository, a GitHub Action redraws it every day as your world grows.</p>
      <div class="share-row">
        <button class="chip world" data-share="link">🔗 Copy link</button>
        <a class="chip world" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${enc(`My GitHub account as a world in the Commitverse 🪐`)}&url=${enc(url)}">𝕏</a>
        <a class="chip world" target="_blank" rel="noopener" href="https://bsky.app/intent/compose?text=${enc(`My GitHub account as a world in the Commitverse 🪐 ${url}`)}">Bluesky</a>
        <a class="chip world" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}">LinkedIn</a>
      </div>
    </div>`;
}

export function wireShare(root, data, toast) {
  const svg = () => worldCard(worldOf(data, data.repos));
  const url = `${SITE}?planet=${enc(data.login)}`;
  const snippet = `[![My world in the Commitverse](commitverse-world.svg)](${url})`;
  const workflow = `# .github/workflows/commitverse.yml in your profile repository (github.com/${data.login}/${data.login})
name: Commitverse world
on:
  schedule: [{ cron: '0 3 * * *' }]
  workflow_dispatch:
permissions:
  contents: write
jobs:
  card:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ${REPO}/card@main
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add commitverse-world.svg
          git commit -m "Commitverse: my world today" || exit 0
          git push
`;
  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${what}.`);
    } catch {
      toast(`Couldn't reach the clipboard. Here it is:<pre class="copy-fallback">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`);
    }
  };
  root.querySelectorAll('[data-share]').forEach((el) => {
    el.onclick = () => {
      const kind = el.dataset.share;
      if (kind === 'svg') {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([svg()], { type: 'image/svg+xml' })), download: 'commitverse-world.svg' });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      } else if (kind === 'md') copy(snippet, 'the README snippet: commit commitverse-world.svg next to your README');
      else if (kind === 'yml') copy(workflow, 'the workflow: save it as .github/workflows/commitverse.yml in your profile repository');
      else if (kind === 'link') copy(url, 'the link to this world');
    };
  });
}
