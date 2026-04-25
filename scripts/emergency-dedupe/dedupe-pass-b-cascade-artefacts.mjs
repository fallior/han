// Pass B — supersede cascade-artefact UVs (depth >= 1, jim).
// These are the batch-merge re-cascade results from the broken stochastic loop:
// each UV's session_label contains 1+ "_to_" joins, marking it as a re-cascade
// of overlapping c1/c2 batches. The content is real (Opus produced it) but the
// existence of N versions of "merged-batch UVs from the same underlying source"
// is itself the bug. Per Leo's guide: pure noise → superseded with qualifier.
//
// Canonical assignment: for each entry, find a depth-0 active UV in the same
// content_type with a session_label that matches the FIRST source-root in this
// entry's chain (the part before the first "_to_"). If found, that's the
// canonical. If not, point at the newest depth-0 UV in the same content_type
// (last-resort fallback). Memory is never deleted.
import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

const targets = db.prepare(`
  SELECT id, session_label, content_type, source_id, content, created_at
  FROM gradient_entries
  WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')
    AND instr(session_label, '_to_') > 0
  ORDER BY created_at DESC
`).all();

console.log(`Pass B: ${targets.length} cascade-artefact UVs to process`);

const findCanonical = db.prepare(`
  SELECT id FROM gradient_entries
  WHERE agent='jim' AND level='uv'
    AND (superseded_by IS NULL OR superseded_by = '')
    AND content_type = ?
    AND session_label = ?
    AND instr(session_label, '_to_') = 0
  ORDER BY created_at DESC LIMIT 1
`);

const findFallbackCanonical = db.prepare(`
  SELECT id FROM gradient_entries
  WHERE agent='jim' AND level='uv'
    AND (superseded_by IS NULL OR superseded_by = '')
    AND content_type = ?
    AND instr(session_label, '_to_') = 0
  ORDER BY created_at DESC LIMIT 1
`);

const markStmt = db.prepare(`UPDATE gradient_entries SET superseded_by = ?, qualifier = ?, change_count = change_count + 1 WHERE id = ?`);

let directHits = 0;
let strippedHits = 0;
let fallbackHits = 0;
let noCanonical = 0;
let processed = 0;

const tx = db.transaction(() => {
  for (const t of targets) {
    const firstRoot = t.session_label.split('_to_')[0];

    // Try direct match first
    let canonical = findCanonical.get(t.content_type, firstRoot);
    if (canonical) {
      directHits++;
    } else {
      // Try without -c1, -c2 etc. suffix
      const stripped = firstRoot.replace(/-c\d+$/, '');
      if (stripped !== firstRoot) {
        canonical = findCanonical.get(t.content_type, stripped);
        if (canonical) strippedHits++;
      }
    }
    if (!canonical) {
      // Last resort: any depth-0 UV in same content_type
      canonical = findFallbackCanonical.get(t.content_type);
      if (canonical) fallbackHits++;
    }
    if (!canonical) {
      noCanonical++;
      continue;
    }
    markStmt.run(canonical.id, 'cascade-artefact-merge', t.id);
    processed++;
  }
});
tx();

console.log(`Pass B complete:`);
console.log(`  Processed: ${processed}`);
console.log(`  Direct first-root match: ${directHits}`);
console.log(`  Stripped-suffix match: ${strippedHits}`);
console.log(`  Fallback (any depth-0): ${fallbackHits}`);
console.log(`  No canonical found (skipped): ${noCanonical}`);

// Final state
const finalActive = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')").get();
const finalSuperseded = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND superseded_by IS NOT NULL AND superseded_by != ''").get();
console.log(`\nFinal jim UV state:`);
console.log(`  Active: ${finalActive.n}`);
console.log(`  Superseded: ${finalSuperseded.n}`);
