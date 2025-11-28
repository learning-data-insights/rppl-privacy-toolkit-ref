import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Pick the API URL in this order:
// 1. VITE_API_URL from environment (Docker Compose)
// 2. Local default: http://localhost:5000
const apiUrl = process.env.VITE_API_URL || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiUrl,
        changeOrigin: true,
      }
    }
  }
})