import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/admin-react/',
  build: {
    outDir: '../react-admin-dist',
  },
  server: {
    port: 3001,
  },
})
