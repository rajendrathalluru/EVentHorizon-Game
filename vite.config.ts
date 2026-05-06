import { defineConfig } from 'vite';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isCi = process.env.GITHUB_ACTIONS === 'true';
const base = isCi && repository ? `/${repository}/` : '/';

export default defineConfig({
  base,
  server: {
    port: 5173,
    host: true
  }
});
