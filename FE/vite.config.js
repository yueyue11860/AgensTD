import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const devServerPort = Number(process.env.FRONTEND_PORT ?? process.env.PORT ?? 5173);
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        fs: {
            allow: ['..'],
        },
        watch: {
            ignored: ['**/.dev-runtime/**', '**/BE/dist/**'],
        },
        host: '0.0.0.0',
        port: Number.isFinite(devServerPort) ? devServerPort : 5173,
    },
});
