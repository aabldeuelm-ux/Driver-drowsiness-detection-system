import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  // Relative asset URLs make the static bundle portable under a domain root or
  // a hosted subpath. No local server address is embedded in the build.
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
  },
});
