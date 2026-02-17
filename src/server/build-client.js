#!/usr/bin/env node
/**
 * Build client TypeScript → JavaScript bundle using esbuild
 */
const esbuild = require('esbuild');
const path = require('path');

esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'ui', 'app.ts')],
    outfile: path.join(__dirname, '..', 'ui', 'app.js'),
    bundle: false,
    format: 'iife',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'info',
});
