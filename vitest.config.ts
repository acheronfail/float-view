import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';
import { svelteTesting } from '@testing-library/svelte/vite';

// https://vitejs.dev/config/
export default defineConfig(
  mergeConfig(baseConfig, {
    plugins: [svelteTesting()],
    test: {
      environment: 'jsdom',
      setupFiles: ['src/setup-tests.ts'],
      deps: {
        optimizer: {
          web: {
            include: ['vitest-canvas-mock'],
          },
        },
      },
      alias: {
        '@testing-library/svelte': '@testing-library/svelte/svelte5',
      },
    },
  }),
);
