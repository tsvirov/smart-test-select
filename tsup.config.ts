import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  platform: 'node',
  target: 'node20',
  // ts-morph bundles its own dynamic require('fs')-style internals that esbuild cannot
  // convert to ESM — keep these as real node_modules dependencies instead of inlining them.
  external: ['ts-morph', 'commander', 'typescript'],
});
