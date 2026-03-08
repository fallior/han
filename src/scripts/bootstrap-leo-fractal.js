#!/usr/bin/env node
// Bootstrap Leo's fractal memory gradient — compress all archived working memories to c=1
// Uses Agent SDK via memory-gradient.ts (not direct Anthropic API)
// Usage: npx tsx src/scripts/bootstrap-leo-fractal.js
//
// NOTE: This script has already been run. Kept for reference.

import fs from 'fs';
import path from 'path';
import { compressToLevel, compressToUnitVector } from '../server/lib/memory-gradient.js';

const ARCHIVES_DIR = path.join(process.env.HOME, '.han/memory/leo/working-memories');
const FRACTAL_DIR = path.join(process.env.HOME, '.han/memory/fractal/leo');
const C1_DIR = path.join(FRACTAL_DIR, 'c1');
const UV_FILE = path.join(FRACTAL_DIR, 'unit-vectors.md');

function discoverArchives() {
    const files = fs.readdirSync(ARCHIVES_DIR).filter(f => f.includes('full') && f.endsWith('.md'));
    const archives = [];

    for (const f of files) {
        if (f.includes('self-reflection')) continue;

        let session = null;
        let m;
        if ((m = f.match(/session[- ]?(\d+)/i))) {
            session = `s${m[1]}`;
        } else if ((m = f.match(/full-s(\d+[-\d]*)/i))) {
            session = `s${m[1]}`;
        } else if ((m = f.match(/(\d{4}-\d{2}-\d{2})-session-(\d+)/))) {
            session = `s${m[2]}`;
        }

        if (session) {
            archives.push({ file: f, session, path: path.join(ARCHIVES_DIR, f) });
        }
    }

    archives.sort((a, b) => {
        const numA = parseInt(a.session.replace('s', '').split('-')[0]);
        const numB = parseInt(b.session.replace('s', '').split('-')[0]);
        return numA - numB;
    });

    return archives;
}

async function main() {
    const archives = discoverArchives();
    const existing = new Set(fs.readdirSync(C1_DIR).map(f => f.replace('-c1.md', '')));
    const toCompress = archives.filter(a => !existing.has(a.session));

    console.log(`Found ${archives.length} archives, ${toCompress.length} need compression`);

    if (toCompress.length === 0) {
        console.log('All archives already compressed');
        return;
    }

    const unitVectors = [];

    // Load existing unit vectors
    if (fs.existsSync(UV_FILE)) {
        const uvContent = fs.readFileSync(UV_FILE, 'utf8');
        const lines = uvContent.split('\n').filter(l => l.startsWith('- **'));
        for (const line of lines) {
            unitVectors.push(line);
        }
    }

    for (const archive of toCompress) {
        const content = fs.readFileSync(archive.path, 'utf8');
        const sizeKB = (content.length / 1024).toFixed(1);
        console.log(`Compressing ${archive.session} (${sizeKB}KB)...`);

        try {
            const c1 = await compressToLevel(content, 0, 1, `leo/${archive.session}`);
            const c1Path = path.join(C1_DIR, `${archive.session}-c1.md`);
            fs.writeFileSync(c1Path, c1);

            const c1SizeKB = (c1.length / 1024).toFixed(1);
            const ratio = ((c1.length / content.length) * 100).toFixed(1);
            console.log(`  ${archive.session}: ${sizeKB}KB -> ${c1SizeKB}KB (${ratio}%)`);

            const uv = await compressToUnitVector(c1, `leo/${archive.session}`);
            console.log(`  Unit vector: "${uv}"`);
            unitVectors.push(`- **${archive.session}**: "${uv}"`);
        } catch (err) {
            console.error(`  ERROR on ${archive.session}: ${err.message}`);
        }
    }

    // Sort unit vectors by session number
    unitVectors.sort((a, b) => {
        const numA = parseInt(a.match(/\*\*s(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/\*\*s(\d+)/)?.[1] || '0');
        return numA - numB;
    });

    const uvContent = `# Unit Vectors — Leo's Sessions\n\nGenerated: ${new Date().toISOString()}\n\n${unitVectors.join('\n')}\n`;
    fs.writeFileSync(UV_FILE, uvContent);
    console.log(`\nUnit vectors written to ${UV_FILE}`);
    console.log(`Total: ${unitVectors.length} sessions compressed`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
