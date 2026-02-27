import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    strictPort: true,
    host: true,
    hmr: {
      clientPort: 5173,
    },
  },

  // Expose VITE_ and TAURI_ env vars to the frontend
  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },

  // Prevent Vite from hiding errors from Node-only packages
  optimizeDeps: {
    exclude: [],
  },
})
