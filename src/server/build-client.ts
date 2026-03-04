#!/usr/bin/env npx tsx
/**
 * Build client TypeScript → JavaScript bundle using esbuild
 */
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'ui', 'app.ts')],
    outfile: path.join(__dirname, '..', 'ui', 'app.js'),
    bundle: false,
    format: 'iife',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'info',
});

esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'ui', 'admin.ts')],
    outfile: path.join(__dirname, '..', 'ui', 'admin.js'),
    bundle: false,
    format: 'iife',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'info',
});
