import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /<repo>/.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 }, // three.js is one large chunk by design
});
