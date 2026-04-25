// Lineage invariant check: every UV must trace to a unique c0.
// At most c0_count UVs can be active.
import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

const c0Count = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='c0'").get();
const activeUV = db.prepare("SELECT COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')").get();
console.log(`Jim c0 count: ${c0Count.n}`);
console.log(`Jim active UV count: ${activeUV.n}`);
console.log(`Invariant violation: ${activeUV.n > c0Count.n ? 'YES (' + (activeUV.n - c0Count.n) + ' over)' : 'NO'}`);

// For each active UV, walk source_id chain back to root.
const uvs = db.prepare(`
  SELECT id, session_label, source_id, content, created_at
  FROM gradient_entries
  WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')
  ORDER BY created_at DESC
`).all();

const getParent = db.prepare('SELECT id, source_id, level FROM gradient_entries WHERE id = ?');

function walkToRoot(uvId, sourceId) {
  let curr = sourceId;
  let depth = 0;
  let lastFound = null;
  while (curr && depth < 30) {
    const row = getParent.get(curr);
    if (!row) break;
    lastFound = row;
    if (row.level === 'c0') return { rootId: row.id, rootLevel: 'c0', depth };
    curr = row.source_id;
    depth++;
  }
  if (lastFound) return { rootId: lastFound.id, rootLevel: lastFound.level, depth };
  return { rootId: null, rootLevel: 'orphan', depth: 0 };
}

const groups = new Map();
const orphans = [];
let nullSource = 0;

for (const uv of uvs) {
  if (!uv.source_id) {
    nullSource++;
    orphans.push({ uv, rootId: null, rootLevel: 'null-source' });
    continue;
  }
  const { rootId, rootLevel } = walkToRoot(uv.id, uv.source_id);
  if (rootLevel === 'c0' && rootId) {
    if (!groups.has(rootId)) groups.set(rootId, []);
    groups.get(rootId).push(uv);
  } else {
    orphans.push({ uv, rootId, rootLevel });
  }
}

console.log(`\nUVs traced to c0 root: ${[...groups.values()].reduce((a,g) => a+g.length, 0)}`);
console.log(`UVs with null source_id: ${nullSource}`);
console.log(`UVs orphaned (chain broken at non-c0): ${orphans.length - nullSource}`);
console.log(`Distinct c0 ancestors with active UV descendants: ${groups.size}`);

let collisions = 0;
let totalToCollapse = 0;
const collisionGroups = [];
for (const [rootId, members] of groups) {
  if (members.length > 1) {
    collisions++;
    totalToCollapse += members.length - 1;
    collisionGroups.push({ rootId, members });
  }
}
console.log(`\nc0 ancestors with MULTIPLE active UV descendants: ${collisions}`);
console.log(`Active UVs to collapse (siblings): ${totalToCollapse}`);

console.log('\n=== Top 5 c0 ancestors with most active UV descendants ===');
const sorted = [...groups.entries()].sort((a,b) => b[1].length - a[1].length).slice(0, 5);
for (const [rootId, members] of sorted) {
  const c0Row = db.prepare('SELECT session_label, substr(content,1,40) as snippet FROM gradient_entries WHERE id = ?').get(rootId);
  console.log(`\n  c0 ${rootId.slice(0,8)} (${c0Row.session_label}): ${members.length} active UV descendants`);
  for (const m of members.slice(0, 3)) {
    console.log(`    - ${m.id.slice(0,8)} | ${m.created_at.slice(0,16)} | "${m.content.slice(0,60)}"`);
  }
  if (members.length > 3) console.log(`    ... (${members.length - 3} more)`);
}
