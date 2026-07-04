/**
 * test-mnt023-root-cure.ts — the writer root-cure gate (chooseMarkerAction) + the
 * MNT-026 quotation sanitiser (sanitizeMarkerText). Pure functions, no FS/DB.
 * Band fixed at [20000, 30000] (the shipped defaults) so the tests are config-independent.
 */
import { chooseMarkerAction, sanitizeMarkerText, stripMarkers, parseMarkers } from '../src/server/lib/memory-paired-writer';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };

const BANDS = { harvestMin: 20_000, placeMin: 25_000, max: 30_000 };
const tok = (n: number) => 'x'.repeat(n * 4); // countTokens ≈ chars/4
const MARKER = (id: string) => `<!-- WM-BOUNDARY: id=${id} ts=2026-07-04T12:00:00.000Z -->`;

console.log('chooseMarkerAction — the harvest/placement gate (placeMin = Tail, Darron\'s ~25K design):');
check('small file (5K) → out-of-band (no premature marker)',
    chooseMarkerAction(tok(5_000), BANDS) === 'out-of-band');
check('EOF in HARVEST band but below placeMin (22K) → out-of-band (wait for the ~25K thought-edge)',
    chooseMarkerAction(tok(22_000), BANDS) === 'out-of-band');
check('EOF at the design target (25K), no markers → PLACE',
    chooseMarkerAction(tok(25_000), BANDS) === 'place');
check('EOF 27K, marker already in the harvest band (22K) → in-band-exists (no double-supply)',
    chooseMarkerAction(tok(22_000) + MARKER('B1') + tok(5_000), BANDS) === 'in-band-exists');
check('THE MNT-023 STALL CASE: stranded below-band marker (18.7K) must NOT block → PLACE',
    chooseMarkerAction(tok(18_700) + MARKER('B1782906780360') + tok(6_300), BANDS) === 'place');
check('EOF past the trigger (35K), no harvest-band marker → out-of-band (bite-fab territory, no dishonest EOF marker)',
    chooseMarkerAction(tok(35_000), BANDS) === 'out-of-band');
check('EOF past the trigger BUT a harvest-band marker exists (25K) → in-band-exists (rotation will harvest it)',
    chooseMarkerAction(tok(25_000) + MARKER('B2') + tok(10_000), BANDS) === 'in-band-exists');
check('in-band marker at 24K covers the band even with EOF past it (Jim\'s label nit fixed: this IS the in-band case)',
    chooseMarkerAction(tok(24_000) + MARKER('B3') + tok(8_000), BANDS) === 'in-band-exists');
check('marker ABOVE max only: file 40K w/ marker at 32K → out-of-band (nothing harvestable, EOF past trigger)',
    chooseMarkerAction(tok(32_000) + MARKER('B4') + tok(8_000), BANDS) === 'out-of-band');

console.log('sanitizeMarkerText — MNT-026 quotation byte-stuffing:');
const quoted = `An entry that quotes ${MARKER('BGHOST')} verbatim in prose.`;
const sanitized = sanitizeMarkerText(quoted);
check('quoted marker no longer parses', parseMarkers(sanitized).length === 0);
check('quoted marker survives stripMarkers (no lived-record deletion)', stripMarkers(sanitized).includes('WM-BOUNDARY: id=BGHOST'));
check('mention stays human-legible', sanitized.includes('<!·-- WM-BOUNDARY: id=BGHOST'));
check('non-marker comments untouched', sanitizeMarkerText('<!-- an ordinary html comment -->') === '<!-- an ordinary html comment -->');
check('real markers (written downstream, never through the sanitiser) still parse', parseMarkers(MARKER('BREAL')).length === 1);
check('idempotent (double-sanitise = same bytes)', sanitizeMarkerText(sanitized) === sanitized);

console.log(`\nmnt023-root-cure: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
