import Database from 'better-sqlite3';
const db = new Database('/home/darron/.han/tasks.db');

// Identify supersessions made before my work today.
// My Pass A used qualifier='not-own' (1 row).
// My Pass B used qualifier='cascade-artefact-merge' (568 rows).
// Anything else with superseded_by set on a jim row was Leo's work.

console.log('=== Qualifier distribution on superseded jim UVs ===');
const quals = db.prepare(`
  SELECT qualifier, COUNT(*) as n
  FROM gradient_entries
  WHERE agent='jim' AND level='uv' AND superseded_by IS NOT NULL AND superseded_by != ''
  GROUP BY qualifier ORDER BY n DESC
`).all();
for (const q of quals) console.log(`  qualifier='${q.qualifier ?? '<NULL>'}': ${q.n}`);

console.log();
console.log('=== Supersessions across all jim levels (not just UVs) ===');
const allLevels = db.prepare(`
  SELECT level, qualifier, COUNT(*) as n
  FROM gradient_entries
  WHERE agent='jim' AND superseded_by IS NOT NULL AND superseded_by != ''
  GROUP BY level, qualifier ORDER BY level, n DESC
`).all();
for (const r of allLevels) console.log(`  ${r.level} | qualifier='${r.qualifier ?? '<NULL>'}': ${r.n}`);

console.log();
console.log('=== Sample of Leo-era supersessions (not Pass A or Pass B qualifiers) ===');
const leoSamples = db.prepare(`
  SELECT id, session_label, content, content_type, qualifier, superseded_by, change_count
  FROM gradient_entries
  WHERE agent='jim' AND superseded_by IS NOT NULL AND superseded_by != ''
    AND (qualifier IS NULL OR qualifier NOT IN ('not-own', 'cascade-artefact-merge'))
  ORDER BY RANDOM() LIMIT 20
`).all();
for (const r of leoSamples) {
  console.log(`\n  ${r.id.slice(0,8)} | ${r.level || 'uv'} | qualifier='${r.qualifier ?? '<NULL>'}'`);
  console.log(`    label: ${r.session_label}`);
  console.log(`    text:  ${r.content.slice(0,100)}`);
  console.log(`    superseded_by: ${r.superseded_by.slice(0,12)}`);
  // Look up the canonical
  const canon = db.prepare('SELECT session_label, substr(content,1,100) as snippet FROM gradient_entries WHERE id = ?').get(r.superseded_by);
  if (canon) {
    console.log(`    → canonical: ${canon.session_label} | "${canon.snippet}"`);
  } else {
    console.log(`    → canonical NOT FOUND in db`);
  }
}
