#!/usr/bin/env tsx
// test-garden-clock.ts — DEC-105 P3 gates for the ADMIN's client clock (pure module,
// no server imports — Jim's fold 2 verified by construction: the import list is Intl only).
//
//   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-garden-clock.ts

import { setGardenZone, gardenZone, zoneLabel, inGardenZone } from '../src/ui/react-admin/src/lib/garden-clock';
import * as fs from 'node:fs';
import * as path from 'node:path';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
    cond ? pass++ : fail++;
    console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${!cond && detail ? ` — ${detail}` : ''}`);
};

// Before any zone arrives: honest UTC.
ok('pre-bootstrap the clock is honest UTC', gardenZone() === 'UTC' && zoneLabel(new Date('2026-01-15T12:00:00Z')) === 'UTC');

// The manifest zone arrives (the /api/ecosystem bootstrap).
setGardenZone('Australia/Brisbane');
ok('manifest zone accepted', gardenZone() === 'Australia/Brisbane');
ok('zone label is DST-correct (Brisbane = AEST always)', zoneLabel(new Date('2026-01-15T12:00:00Z')) === 'AEST');
const t = new Date('2026-01-15T12:00:00Z').toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', ...inGardenZone() });
ok('a formatter spreading inGardenZone() renders garden time (22:00 for 12:00Z)', /10:00\s*pm|22:00/i.test(t), t);

// DST zone renders both faces.
setGardenZone('Australia/Sydney');
ok('Sydney January = AEDT', zoneLabel(new Date('2026-01-15T12:00:00Z')) === 'AEDT');
ok('Sydney July = AEST', zoneLabel(new Date('2026-07-15T12:00:00Z')) === 'AEST');

// Fail-closed: garbage zone ⇒ UTC with the fallback marker (Jim's fold 2 polarity).
setGardenZone('Not/AZone');
ok('garbage zone fails CLOSED to UTC', gardenZone() === 'UTC');
ok('…and the label carries the fallback marker', zoneLabel(new Date('2026-01-15T12:00:00Z')) === 'UTC*');

// Unset (a garden with no declared zone) ⇒ honest UTC, no marker.
setGardenZone(undefined);
ok('unset zone = honest UTC, unmarked', gardenZone() === 'UTC' && zoneLabel(new Date('2026-01-15T12:00:00Z')) === 'UTC');

// Structural: the module imports NOTHING (pure Intl — no server libs in the bundle).
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'react-admin', 'src', 'lib', 'garden-clock.ts'), 'utf8');
ok('garden-clock imports nothing (pure — the G2b law stays server-side)', !/^import /m.test(src));
// Structural: the zone reaches the client from the API, never a hardcoded literal.
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'react-admin', 'src', 'App.tsx'), 'utf8');
ok('App bootstraps the zone from /api/ecosystem (manifest-fed, fold 1)',
    /api\/ecosystem[\s\S]{0,200}?setGardenZone\(data\.timezone\)/.test(app));
const clockSrcFiles = ['src/ui/react-admin/src/utils.ts', 'src/ui/react-admin/src/lib/utils.ts', 'src/ui/react-admin/src/lib/garden-clock.ts', 'src/ui/react-admin/src/App.tsx'];
const hardcoded = clockSrcFiles.filter(f => /Australia\//.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
ok('no hardcoded zone anywhere in the clock path', hardcoded.length === 0, hardcoded.join(', '));

console.log(`\ngarden-clock gates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
