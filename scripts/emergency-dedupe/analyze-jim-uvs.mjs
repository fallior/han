import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

console.log('=== Active jim UVs by content_type ===');
const byCt = db.prepare("SELECT content_type, COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '') GROUP BY content_type ORDER BY n DESC").all();
for (const r of byCt) console.log(`  ${r.content_type}: ${r.n}`);

console.log();
console.log('=== Active jim UVs by _to_ chain depth ===');
const depths = db.prepare(`
  SELECT (length(session_label) - length(replace(session_label, '_to_', ''))) / 4 as depth, COUNT(*) as n
  FROM gradient_entries WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')
  GROUP BY depth ORDER BY depth
`).all();
for (const r of depths) console.log(`  depth ${r.depth}: ${r.n}`);

console.log();
console.log('=== Same-source-root UVs (Active, jim) ===');
const rootGroups = db.prepare(`
  SELECT
    CASE
      WHEN instr(session_label, '_to_') > 0 THEN substr(session_label, 1, instr(session_label, '_to_') - 1)
      ELSE session_label
    END as root,
    COUNT(*) as n
  FROM gradient_entries WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')
  GROUP BY root HAVING n > 2 ORDER BY n DESC LIMIT 15
`).all();
for (const r of rootGroups) console.log(`  root='${r.root}': ${r.n} active UVs`);

console.log();
console.log('=== Active UV total content size (jim) ===');
const sz = db.prepare("SELECT COUNT(*) as n, SUM(length(content) + length(coalesce(session_label,''))) as bytes FROM gradient_entries WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '')").get();
console.log(`  ${sz.n} active UVs, ~${Math.round(sz.bytes/1024)} KB content+labels`);

console.log();
console.log('=== Superseded UV total content size (jim) — these are also loaded! ===');
const sz2 = db.prepare("SELECT COUNT(*) as n, SUM(length(content) + length(coalesce(session_label,''))) as bytes FROM gradient_entries WHERE agent='jim' AND level='uv' AND superseded_by IS NOT NULL AND superseded_by != ''").get();
console.log(`  ${sz2.n} superseded UVs, ~${Math.round(sz2.bytes/1024)} KB`);

console.log();
console.log('=== Active jim UVs with _to_ depth 0 by content_type (the genuine canonicals) ===');
const dep0 = db.prepare(`SELECT content_type, COUNT(*) as n FROM gradient_entries WHERE agent='jim' AND level='uv' AND (superseded_by IS NULL OR superseded_by = '') AND instr(session_label, '_to_') = 0 GROUP BY content_type`).all();
for (const r of dep0) console.log(`  ${r.content_type}: ${r.n}`);
