import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
// @ts-expect-error -- plain ESM helper without type declarations
import { buildDefine } from '../../scripts/build-info.mjs';

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    define: buildDefine(),
    resolve: {
      alias: {
        '@raisedline/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      },
    },
    server: {
      fs: { allow: ['../..'] },
    },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: !single,
      chunkSizeWarningLimit: 1200,
    },
  };
});
