import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/cholao/',              // se sirve en softurbis.github.io/cholao/
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
  },
  build: {
    outDir: '../docs',           // GitHub Pages sirve desde /docs en main
    emptyOutDir: true,
  },
})
