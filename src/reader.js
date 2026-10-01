import 'highlight.js/styles/atom-one-dark.css';

const LINE_HEIGHT = 18; // px, must match .reader-body pre in styles.css

const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp',
  hpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift', md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml',
  html: 'xml', xml: 'xml', css: 'css', scss: 'scss', sass: 'scss', less: 'less', sh: 'bash', sql: 'sql', toml: 'ini', ini: 'ini',
};

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// "Entering" a building: the file's code opens beside it, and scrolling rides an elevator up the facade.
// onRange(first, last) reports which lines are on screen so the city can light those floors.
export class CodeReader {
  constructor(root, { onRange, onClose }) {
    this.root = root;
    this.onRange = onRange;
    this.onClose = onClose;
    this.body = root.querySelector('.reader-body');
    this.gutter = root.querySelector('#reader-gutter');
    this.code = root.querySelector('#reader-code');
    this.lines = 0;
    this.token = 0;
    this.body.addEventListener('scroll', () => this.#report());
    root.querySelector('#reader-close').onclick = () => this.onClose();
  }

  get open() {
    return !this.root.hidden;
  }

  async show(data, file) {
    const token = ++this.token;
    this.root.hidden = false;
    this.root.querySelector('#reader-path').textContent = file.p;
    // a live snapshot (src/liveCity.js) only knows a file's size, and whether it was worked on lately
    this.root.querySelector('#reader-meta').textContent = data.snapshot
      ? `about ${file.loc.toLocaleString('en-US')} lines · ${file.c ? 'worked on lately' : 'quiet lately'}`
      : `${file.loc.toLocaleString('en-US')} lines · ${file.c} commits`;
    const gh = this.root.querySelector('#reader-gh');
    gh.hidden = !data.repo.url;
    if (data.repo.url) gh.href = `${data.repo.url}/blob/${data.repo.head}/${file.p}`;
    this.#message('Loading code…');

    if (!data.repo.url) return this.#message('Code preview needs a GitHub-hosted repository.');
    let text;
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${data.repo.name}/${data.repo.head}/${file.p.split('/').map(encodeURIComponent).join('/')}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      return this.#message(`Couldn't load the file (${err.message}).`);
    }
    if (token !== this.token) return;

    const hljs = (await import('highlight.js/lib/common')).default;
    const lang = EXT_LANG[file.p.split('.').pop().toLowerCase()];
    const html = lang && hljs.getLanguage(lang) && text.length < 800_000 ? hljs.highlight(text, { language: lang }).value : escapeHtml(text);
    if (token !== this.token) return;

    this.lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    this.gutter.textContent = Array.from({ length: this.lines }, (_, k) => k + 1).join('\n');
    this.code.innerHTML = html;
    this.body.scrollTop = 0;
    this.#report();
  }

  hide() {
    this.token++;
    this.root.hidden = true;
  }

  // Scripted scrolling (the film): report the new range at once instead of waiting for the scroll event.
  scrollTo(top) {
    this.body.scrollTop = top;
    this.#report();
  }

  get scrollMax() {
    return Math.max(0, this.lines * LINE_HEIGHT + 20 - this.body.clientHeight);
  }

  #message(text) {
    this.lines = 0;
    this.gutter.textContent = '';
    this.code.textContent = text;
  }

  #report() {
    if (!this.lines) return;
    const first = Math.floor(this.body.scrollTop / LINE_HEIGHT) + 1;
    const last = Math.min(this.lines, Math.floor((this.body.scrollTop + this.body.clientHeight) / LINE_HEIGHT));
    this.onRange(first, Math.max(first, last), this.lines);
  }
}
