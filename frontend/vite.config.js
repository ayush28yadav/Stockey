// Vite development configuration
// Purpose: provide a small, conventional dev server configuration used
// by contributors locally. Port and plugins are intentionally minimal.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], server: { port: 5173 } });
