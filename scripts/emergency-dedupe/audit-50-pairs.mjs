// Read 50 random pairs from each Leo qualifier — assess accuracy
import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

function sample(qualifier, n) {
  console.log(`\n========================================`);
  console.log(`SAMPLE: qualifier='${qualifier}' (${n} pairs)`);
  console.log(`========================================`);
  const rows = db.prepare(`
    SELECT id, session_label, content, content_type, superseded_by
    FROM gradient_entries
    WHERE agent='jim' AND superseded_by IS NOT NULL AND superseded_by != ''
      AND qualifier = ?
    ORDER BY RANDOM() LIMIT ?
  `).all(qualifier, n);

  for (const r of rows) {
    const canon = db.prepare('SELECT session_label, content FROM gradient_entries WHERE id = ?').get(r.superseded_by);
    console.log(`\n  [${r.content_type}] supersed=${r.id.slice(0,6)} canon=${(r.superseded_by || '').slice(0,6)}`);
    console.log(`  S: "${r.content}"`);
    console.log(`  C: "${canon ? canon.content : '???'}"`);
    // Quick similarity hint
    if (canon) {
      const sw = r.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const cw = canon.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const sset = new Set(sw);
      const overlap = cw.filter(w => sset.has(w)).length;
      const total = new Set([...sw, ...cw]).size;
      const jaccard = total > 0 ? (overlap / total).toFixed(2) : '?';
      console.log(`  Jaccard word-overlap: ${jaccard}`);
    }
  }
}

sample('auto-dedupe-needs-review', 25);
sample('noise-duplicate', 15);
sample('was-true-when', 10);
