import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import legacy from '@vitejs/plugin-legacy'

// On the HR platform the app is mounted at hr.rdcc.ai/eval; everywhere else it
// sits at the root. Vite bakes `base` into the built asset URLs and exposes it
// to the client as import.meta.env.BASE_URL — see src/basePath.js.
const base = process.env.BASE_PATH ? `${process.env.BASE_PATH}/` : '/'

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    legacy({
      targets: ['defaults', 'not IE 11']
    })
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
})
