import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('sql.js')) return 'sql';
          if (id.includes('recharts') || id.includes('d3-') || id.includes('react-smooth') || id.includes('recharts-scale')) return 'charts';
          if (id.includes('docx')) return 'docx';
          if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('canvg') || id.includes('dompurify')) return 'pdf';
          if (id.includes('xlsx') || id.includes('cfb') || id.includes('ssf')) return 'xlsx';
          if (id.includes('jszip')) return 'zip';
          if (id.includes('lucide-react')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
