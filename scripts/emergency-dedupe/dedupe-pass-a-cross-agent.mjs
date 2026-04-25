// Pass A — cross-agent identical UVs in jim's gradient.
// For each jim UV whose content matches a leo UV byte-for-byte:
//   - mark jim row as not-own, superseded_by = leo's id, qualifier='not-own'
//   - leo row untouched (it's leo's memory, sovereign)
// Memory is never deleted — the jim rows stay queryable, just filtered out of the active load.
import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

const pairs = db.prepare(`
  SELECT j.id as jim_id, j.session_label as jim_label, j.content_type as ct, l.id as leo_id, l.session_label as leo_label, substr(j.content,1,80) as snippet
  FROM gradient_entries j INNER JOIN gradient_entries l
    ON j.content = l.content AND j.agent='jim' AND l.agent='leo' AND j.level=l.level AND j.content_type=l.content_type
  WHERE j.level='uv' AND (j.superseded_by IS NULL OR j.superseded_by = '')
`).all();

console.log(`Found ${pairs.length} jim UV rows identical to a leo UV row`);

const markStmt = db.prepare(`UPDATE gradient_entries SET superseded_by = ?, qualifier = ?, change_count = change_count + 1 WHERE id = ?`);

let count = 0;
const tx = db.transaction(() => {
    for (const p of pairs) {
        markStmt.run(p.leo_id, 'not-own', p.jim_id);
        console.log(`  jim/${p.jim_label} (${p.ct}) → not-own, superseded_by=${p.leo_id} | "${p.snippet}"`);
        count++;
    }
});
tx();

console.log(`Pass A complete: ${count} rows marked not-own.`);
