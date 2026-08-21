import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend config comes from frontend/.env (see .env.example). The API base URL
// is never hardcoded in application code.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT ?? 5173),
      host: '127.0.0.1',
      strictPort: true,
    },
    build: { outDir: 'dist', sourcemap: true },
  };
});
