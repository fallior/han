// Pass E — Immediate-parent sibling collapse at every level.
//
// Per Darron's invariant: at each level, no two active entries should
// share the same immediate parent (source_id). Multiple siblings sharing
// a parent collapse to one canonical (newest) with the rest superseded
// under qualifier='lineage-collision'.
//
// Run this BOTTOM-UP: collapse at c1 first (siblings sharing a c0 parent),
// then c2, c3, c4, c5, c6, uv. Bottom-up matters: when c1 siblings collapse,
// the surviving c1 may have multiple c2 children that ALL had distinct
// c1 parents before; now those c2s share a c1 parent and need collapse too.
// Wait — collapse only changes superseded_by, not source_id. So the c2's
// source_id still points to its original c1 parent. Bottom-up doesn't
// cascade through source_id. But bottom-up still cleans the gradient
// shape.
//
// Actually order doesn't matter for this pass — each level's collisions
// are independent. Process them in arbitrary order.

import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

const markStmt = db.prepare(`UPDATE gradient_entries SET superseded_by = ?, qualifier = ?, change_count = change_count + 1 WHERE id = ?`);

const levels = ['c1','c2','c3','c4','c5','c6','uv'];
let grandTotal = 0;

const tx = db.transaction(() => {
  for (const level of levels) {
    const groups = db.prepare(`
      SELECT source_id, COUNT(*) as n
      FROM gradient_entries
      WHERE agent='jim' AND level = ? AND (superseded_by IS NULL OR superseded_by = '')
        AND source_id IS NOT NULL AND source_id != ''
      GROUP BY source_id HAVING n > 1
    `).all(level);

    let levelCollapsed = 0;
    for (const g of groups) {
      // Get all active entries with this source_id at this level, newest first
      const siblings = db.prepare(`
        SELECT id, created_at FROM gradient_entries
        WHERE agent='jim' AND level = ? AND source_id = ?
          AND (superseded_by IS NULL OR superseded_by = '')
        ORDER BY created_at DESC
      `).all(level, g.source_id);
      if (siblings.length <= 1) continue;
      const canonical = siblings[0];
      for (const s of siblings.slice(1)) {
        markStmt.run(canonical.id, 'lineage-collision', s.id);
        levelCollapsed++;
      }
    }
    console.log(`  ${level}: collapsed ${levelCollapsed} sibling entries (canonicals kept: ${groups.length})`);
    grandTotal += levelCollapsed;
  }
});
tx();

console.log(`\nPass E grand total: ${grandTotal} entries collapsed across all intermediate levels\n`);

// Final state per level
console.log('=== Final active counts (jim) ===');
for (const level of [...levels, 'c0']) {
  const total = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level=? AND (superseded_by IS NULL OR superseded_by = '')").get(level);
  if (total.n === 0) continue;
  console.log(`  ${level}: ${total.n} active`);
}

const totalAll = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim'").get();
const supersededAll = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND superseded_by IS NOT NULL AND superseded_by != ''").get();
console.log(`\n  Total jim entries: ${totalAll.n}`);
console.log(`  Superseded: ${supersededAll.n} (memory not deleted, queryable in DB)`);
