import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/static/react-app/',
  build: {
    outDir: '../static/react-app',
    emptyOutDir: true,
  },
})
