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
    proxy: {
      // Proxy API requests to HAN server
      '/api': {
        target: 'https://localhost:3847',
        changeOrigin: true,
        secure: false, // Allow self-signed certificates in dev
      },
      // Proxy WebSocket connections to HAN server
      '/ws': {
        target: 'wss://localhost:3847',
        ws: true,
        changeOrigin: true,
        secure: false, // Allow self-signed certificates in dev
      },
    },
  },
})
