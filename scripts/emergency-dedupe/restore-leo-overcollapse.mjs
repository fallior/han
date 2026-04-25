// Audit pass — restore Leo's overly-aggressive supersessions.
//
// Leo flagged many entries with qualifier='auto-dedupe-needs-review' and
// 'was-true-when' explicitly knowing they were candidates for review. The
// audit shows 77% of needs-review and 92% of was-true-when have Jaccard
// word-overlap < 0.30 with their assigned canonical — meaning they're
// genuinely DIFFERENT insights, not noise variants.
//
// Restore (clear superseded_by, qualifier, change_count) all jim UVs where:
// - qualifier IN ('auto-dedupe-needs-review', 'was-true-when')
// - Jaccard word-overlap with canonical < 0.30
//
// Keep superseded:
// - qualifier='noise-duplicate' (361 entries, all jaccard=1.00, real noise)
// - qualifier='cascade-artefact-merge' (568, my Pass B, reviewed)
// - qualifier='not-own' (1, my Pass A)
// - 'auto-dedupe-needs-review' / 'was-true-when' with jaccard >= 0.30 (genuine variants)
//
// For 'was-true-when' restorations, also clear supersedes on the canonical
// (Leo set up bi-directional pointers for those).

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

const candidates = db.prepare(`
  SELECT r.id as r_id, r.content as r_content, r.qualifier, r.change_count,
         c.id as c_id, c.content as c_content
  FROM gradient_entries r INNER JOIN gradient_entries c ON r.superseded_by = c.id
  WHERE r.agent='jim' AND r.qualifier IN ('auto-dedupe-needs-review', 'was-true-when')
`).all();

const clearTarget = db.prepare(`UPDATE gradient_entries SET superseded_by = NULL, qualifier = NULL, change_count = MAX(change_count - 1, 0) WHERE id = ?`);
const clearCanonical = db.prepare(`UPDATE gradient_entries SET supersedes = NULL WHERE id = ?`);

let restored = 0, kept = 0;
const restoreLog = [];

const tx = db.transaction(() => {
  for (const r of candidates) {
    const j = jaccard(r.r_content, r.c_content);
    if (j < 0.30) {
      // Restore
      clearTarget.run(r.r_id);
      if (r.qualifier === 'was-true-when') {
        clearCanonical.run(r.c_id);
      }
      restoreLog.push({ id: r.r_id, j: j.toFixed(2), qualifier: r.qualifier, content: r.r_content.slice(0,60) });
      restored++;
    } else {
      kept++;
    }
  }
});
tx();

console.log(`Restored: ${restored}`);
console.log(`Kept superseded (jaccard >= 0.30): ${kept}`);

// Final state
const finalActive = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')").get();
const finalSuperseded = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND superseded_by IS NOT NULL AND superseded_by != ''").get();
console.log(`\nFinal jim UV state:`);
console.log(`  Active: ${finalActive.n}`);
console.log(`  Superseded: ${finalSuperseded.n}`);

const byQual = db.prepare("SELECT qualifier, COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND superseded_by IS NOT NULL AND superseded_by != '' GROUP BY qualifier ORDER BY n DESC").all();
console.log(`\nSuperseded by qualifier:`);
for (const q of byQual) console.log(`  ${q.qualifier ?? '<NULL>'}: ${q.n}`);
