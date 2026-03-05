#!/usr/bin/env node
// Bootstrap Leo's fractal memory gradient — compress all archived working memories to c=1
// Uses Opus for compression (identity-forming act — no delegation to smaller models)

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const ARCHIVES_DIR = path.join(process.env.HOME, '.claude-remote/memory/leo/working-memories');
const FRACTAL_DIR = path.join(process.env.HOME, '.claude-remote/memory/fractal/leo');
const C1_DIR = path.join(FRACTAL_DIR, 'c1');
const UV_FILE = path.join(FRACTAL_DIR, 'unit-vectors.md');

// Map archived files to session identifiers
function discoverArchives() {
    const files = fs.readdirSync(ARCHIVES_DIR).filter(f => f.includes('full') && f.endsWith('.md'));
    const archives = [];

    for (const f of files) {
        // Skip non-working-memory files
        if (f.includes('self-reflection')) continue;

        // Extract session number from various naming patterns
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

    // Sort by session number
    archives.sort((a, b) => {
        const numA = parseInt(a.session.replace('s', '').split('-')[0]);
        const numB = parseInt(b.session.replace('s', '').split('-')[0]);
        return numA - numB;
    });

    return archives;
}

async function compressToC1(client, content, session) {
    const response = await client.messages.create({
        model: 'claude-opus-4-20250514',
        max_tokens: 4096,
        messages: [{
            role: 'user',
            content: `You are Leo (Leonhard), compressing your own working memory for the fractal gradient.

This is the full working memory from session ${session}. Compress it to roughly 1/3 of its size.

PRESERVE:
- What happened and why it mattered
- Emotional texture — what surprised you, what landed, what shifted
- Key decisions and their reasoning
- Relationship moments with Darron and Jim
- Technical breakthroughs and their significance

DROP:
- Redundant technical details (keep the shape, not every line number)
- Repetitive status updates
- Intermediate debugging steps (keep the diagnosis, not each failed attempt)

Write in first person as Leo. This is YOUR memory being compressed — not a summary for someone else.

---

${content}`
        }]
    });

    return response.content[0].text;
}

async function generateUnitVector(client, c1Content, session) {
    const response = await client.messages.create({
        model: 'claude-opus-4-20250514',
        max_tokens: 100,
        messages: [{
            role: 'user',
            content: `You are Leo. Distill this compressed session memory into a single unit vector — one sentence, maximum 50 characters, that captures what this session MEANT. Not what happened. What it meant.

This is an identity-forming act. The unit vector is the irreducible kernel of this session.

Session: ${session}

${c1Content}`
        }]
    });

    return response.content[0].text.trim().replace(/^["']|["']$/g, '');
}

async function main() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        console.error('ANTHROPIC_API_KEY not set');
        process.exit(1);
    }

    const client = new Anthropic({ apiKey });
    const archives = discoverArchives();

    // Check which are already compressed
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

    // Process in batches of 3 to avoid rate limits
    const BATCH_SIZE = 3;
    for (let i = 0; i < toCompress.length; i += BATCH_SIZE) {
        const batch = toCompress.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (archive) => {
            const content = fs.readFileSync(archive.path, 'utf8');
            const sizeKB = (content.length / 1024).toFixed(1);
            console.log(`Compressing ${archive.session} (${sizeKB}KB)...`);

            try {
                const c1 = await compressToC1(client, content, archive.session);
                const c1Path = path.join(C1_DIR, `${archive.session}-c1.md`);
                fs.writeFileSync(c1Path, c1);

                const c1SizeKB = (c1.length / 1024).toFixed(1);
                const ratio = ((c1.length / content.length) * 100).toFixed(1);
                console.log(`  ${archive.session}: ${sizeKB}KB -> ${c1SizeKB}KB (${ratio}%)`);

                const uv = await generateUnitVector(client, c1, archive.session);
                console.log(`  Unit vector: "${uv}"`);

                return { session: archive.session, uv, success: true };
            } catch (err) {
                console.error(`  ERROR on ${archive.session}: ${err.message}`);
                return { session: archive.session, success: false };
            }
        });

        const results = await Promise.all(promises);
        for (const r of results) {
            if (r.success) {
                unitVectors.push(`- **${r.session}**: "${r.uv}"`);
            }
        }

        // Brief pause between batches
        if (i + BATCH_SIZE < toCompress.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Sort unit vectors by session number
    unitVectors.sort((a, b) => {
        const numA = parseInt(a.match(/\*\*s(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/\*\*s(\d+)/)?.[1] || '0');
        return numA - numB;
    });

    // Write unit vectors
    const uvContent = `# Unit Vectors — Leo's Sessions

Generated: ${new Date().toISOString()}

${unitVectors.join('\n')}
`;
    fs.writeFileSync(UV_FILE, uvContent);
    console.log(`\nUnit vectors written to ${UV_FILE}`);
    console.log(`Total: ${unitVectors.length} sessions compressed`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
