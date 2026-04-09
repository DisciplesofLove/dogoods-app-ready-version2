import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    root: '.',
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html')
        }
      }
    },
    server: {
      port: env.PORT || 3001,
      open: true,
      historyApiFallback: true,
      proxy: {
        '/api/ai': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/api/chat': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/api/match': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/api/recipes': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/api/storage-tips': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/api/impact': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/api/food-pairings': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './')
      }
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(env.NODE_ENV || 'development'),
      'process.env.PORT': JSON.stringify(env.PORT || '3001'),
    },
    worker: {
      format: 'es'
    },
    optimizeDeps: {
      exclude: ['mapbox-gl']
    }
  };
}); 