import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  bundle: true,
  clean: true,
  dts: false,
  sourcemap: false,
  outDir: 'dist',
});
