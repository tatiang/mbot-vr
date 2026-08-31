/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the static build can be dropped into any subdirectory
  // (GitHub Pages project sites, a school LMS folder, a USB stick, ...).
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    // Blockly is most of the bundle and changes only when the dependency is
    // upgraded; splitting it out lets browsers keep it cached across releases.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          blockly: ['blockly/core', 'blockly/blocks', 'blockly/javascript'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
