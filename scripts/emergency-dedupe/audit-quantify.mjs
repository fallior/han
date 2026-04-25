// Quantify Leo's auto-dedupe-needs-review accuracy by Jaccard word-overlap
import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

function jaccard(a, b) {
  const aw = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const bw = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (aw.size === 0 && bw.size === 0) return 1;
  let inter = 0;
  for (const w of aw) if (bw.has(w)) inter++;
  const union = aw.size + bw.size - inter;
  return union > 0 ? inter / union : 0;
}

console.log('=== Jaccard distribution for auto-dedupe-needs-review ===');
const rows = db.prepare(`
  SELECT r.id, r.content as r_content, c.content as c_content
  FROM gradient_entries r INNER JOIN gradient_entries c ON r.superseded_by = c.id
  WHERE r.agent='jim' AND r.qualifier = 'auto-dedupe-needs-review'
`).all();

const buckets = { '0.00-0.10': 0, '0.10-0.30': 0, '0.30-0.50': 0, '0.50-0.70': 0, '0.70-1.00': 0 };
const lowJacc = [];
for (const r of rows) {
  const j = jaccard(r.r_content, r.c_content);
  if (j < 0.10) buckets['0.00-0.10']++;
  else if (j < 0.30) buckets['0.10-0.30']++;
  else if (j < 0.50) buckets['0.30-0.50']++;
  else if (j < 0.70) buckets['0.50-0.70']++;
  else buckets['0.70-1.00']++;
  if (j < 0.30) lowJacc.push({ id: r.id, j, r: r.r_content, c: r.c_content });
}
for (const [b, n] of Object.entries(buckets)) console.log(`  ${b}: ${n}`);

console.log(`\nLow-Jaccard count (< 0.30 — genuinely different content) =`, lowJacc.length);
console.log(`These should likely be restored to active.\n`);

console.log('=== Same audit for was-true-when ===');
const wtw = db.prepare(`
  SELECT r.id, r.content as r_content, c.content as c_content
  FROM gradient_entries r INNER JOIN gradient_entries c ON r.superseded_by = c.id
  WHERE r.agent='jim' AND r.qualifier = 'was-true-when'
`).all();

const wtwBuckets = { '0.00-0.10': 0, '0.10-0.30': 0, '0.30-0.50': 0, '0.50-0.70': 0, '0.70-1.00': 0 };
for (const r of wtw) {
  const j = jaccard(r.r_content, r.c_content);
  if (j < 0.10) wtwBuckets['0.00-0.10']++;
  else if (j < 0.30) wtwBuckets['0.10-0.30']++;
  else if (j < 0.50) wtwBuckets['0.30-0.50']++;
  else if (j < 0.70) wtwBuckets['0.50-0.70']++;
  else wtwBuckets['0.70-1.00']++;
}
for (const [b, n] of Object.entries(wtwBuckets)) console.log(`  ${b}: ${n}`);
