import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// GitHub Pages serves the site from /Werewolf-Party/.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/Werewolf-Party/' : '/',
  plugins: [preact()],
});
