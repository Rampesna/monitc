import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['ssh2', 'nodemailer', 'cpu-features', 'sshcrypto']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify('1.0.0')
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'recharts-vendor': ['recharts'],
            'xterm-vendor': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search'],
            'icons-vendor': ['lucide-react']
          }
        }
      },
      chunkSizeWarningLimit: 2000
    }
  }
})
