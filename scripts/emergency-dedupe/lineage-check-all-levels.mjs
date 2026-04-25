// Check lineage invariant at every level, not just UV.
// At each level, no two active entries should share the same parent (source_id).
import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

const levels = ['c1','c2','c3','c4','c5','c6','uv'];

console.log('=== Sibling collisions at each level (jim, active only) ===');
for (const level of levels) {
  const total = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level=? AND (superseded_by IS NULL OR superseded_by = '')").get(level);
  if (total.n === 0) continue;

  const groups = db.prepare(`
    SELECT source_id, COUNT(*) as n
    FROM gradient_entries
    WHERE agent='jim' AND level = ? AND (superseded_by IS NULL OR superseded_by = '')
      AND source_id IS NOT NULL AND source_id != ''
    GROUP BY source_id HAVING n > 1
  `).all(level);

  let collisions = 0;
  let toCollapse = 0;
  for (const g of groups) {
    collisions++;
    toCollapse += g.n - 1;
  }
  const nullSource = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level=? AND (superseded_by IS NULL OR superseded_by = '') AND (source_id IS NULL OR source_id = '')").get(level);
  console.log(`  ${level}: total=${total.n}, parent-groups-with-collisions=${collisions}, would-collapse=${toCollapse}, null-source=${nullSource.n}`);
}
