// Vite development TypeScript config (kept for editors that read ts configs)
// Purpose: identical to `vite.config.js` but present for editor integrations
// that prefer a TypeScript config file.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], server: { port: 5173 } });
