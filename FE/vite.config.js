import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const devServerPort = Number(process.env.FRONTEND_PORT ?? process.env.PORT ?? 5173);
function manualChunks(id) {
    if (!id.includes('node_modules'))
        return undefined;
    if (id.includes('/phaser/'))
        return 'phaser-vendor';
    if (id.includes('/@supabase/'))
        return 'supabase-vendor';
    if (id.includes('/socket.io-') || id.includes('/engine.io-'))
        return 'realtime-vendor';
    if (id.includes('/react-markdown/')
        || id.includes('/remark-')
        || id.includes('/rehype-')
        || id.includes('/unified/')
        || id.includes('/micromark')
        || id.includes('/mdast-')
        || id.includes('/hast-'))
        return 'markdown-vendor';
    if (id.includes('/lucide-react/') || id.includes('/clsx/') || id.includes('/tailwind-merge/'))
        return 'ui-vendor';
    if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router'))
        return 'react-vendor';
    return undefined;
}
export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {
        manifest: true,
        chunkSizeWarningLimit: 1_500,
        rollupOptions: {
            output: { manualChunks },
        },
    },
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
