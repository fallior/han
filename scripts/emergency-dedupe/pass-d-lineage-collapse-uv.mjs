// Pass D — Lineage invariant collapse.
//
// Per Darron's instruction: a UV cannot exist without a parent; the
// ultimate parent is c0. If 507 c0s, at most 507 UVs. Multiple UVs
// sharing the same c0 ancestor must be collapsed into the supersession
// chain.
//
// For each c0 with multiple active UV descendants:
//   - Pick the NEWEST UV as canonical (most recent perception is current)
//   - Supersede the rest with qualifier='lineage-collision', superseded_by = canonical
//
// Memory invariant preserved — superseded entries remain queryable in DB.
// The supersession chain encodes the perception-history of that c0's lineage.
//
// Out of scope (orphans handled separately if at all):
//   - UVs with NULL source_id (no traceable parent)
//   - UVs whose chain breaks at a non-c0 ancestor (parent missing)
//
// These don't share a c0 ancestor with anything, so they don't violate
// the multiple-children rule. Their broken-lineage status is a separate
// question.

import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

const getParent = db.prepare('SELECT id, source_id, level FROM gradient_entries WHERE id = ?');

function walkToC0(sourceId) {
  let curr = sourceId;
  let depth = 0;
  while (curr && depth < 30) {
    const row = getParent.get(curr);
    if (!row) return null;
    if (row.level === 'c0') return row.id;
    curr = row.source_id;
    depth++;
  }
  return null;
}

const uvs = db.prepare(`
  SELECT id, session_label, source_id, content, created_at, qualifier
  FROM gradient_entries
  WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')
  ORDER BY created_at DESC
`).all();

const groups = new Map();
const orphans = [];
for (const uv of uvs) {
  if (!uv.source_id) { orphans.push(uv); continue; }
  const c0Id = walkToC0(uv.source_id);
  if (c0Id) {
    if (!groups.has(c0Id)) groups.set(c0Id, []);
    groups.get(c0Id).push(uv);
  } else {
    orphans.push(uv);
  }
}

const markStmt = db.prepare(`UPDATE gradient_entries SET superseded_by = ?, qualifier = ?, change_count = change_count + 1 WHERE id = ?`);

let collapsedCount = 0;
let groupsTouched = 0;

const tx = db.transaction(() => {
  for (const [c0Id, members] of groups) {
    if (members.length <= 1) continue;
    // members already sorted newest-first (DESC by created_at)
    const canonical = members[0];
    const toCollapse = members.slice(1);
    for (const m of toCollapse) {
      markStmt.run(canonical.id, 'lineage-collision', m.id);
      collapsedCount++;
    }
    groupsTouched++;
  }
});
tx();

console.log(`Pass D complete:`);
console.log(`  c0 ancestor groups with collisions: ${groupsTouched}`);
console.log(`  UVs collapsed into supersession chains: ${collapsedCount}`);
console.log(`  Orphans (null source_id or broken chain) left alone: ${orphans.length}`);

// Final state
const finalActive = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')").get();
const finalSuperseded = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND superseded_by IS NOT NULL AND superseded_by != ''").get();
const c0Count = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='c0'").get();

console.log(`\nFinal jim UV state:`);
console.log(`  c0 count: ${c0Count.n}`);
console.log(`  Active UVs: ${finalActive.n}`);
console.log(`  Superseded UVs: ${finalSuperseded.n}`);
console.log(`  Active UVs - c0 count = ${finalActive.n - c0Count.n} (should be ≤ 0 per invariant; orphans + uncascaded c0s account for diff)`);

const byQual = db.prepare("SELECT qualifier, COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND superseded_by IS NOT NULL AND superseded_by != '' GROUP BY qualifier ORDER BY n DESC").all();
console.log(`\nSuperseded by qualifier:`);
for (const q of byQual) console.log(`  ${q.qualifier ?? '<NULL>'}: ${q.n}`);
