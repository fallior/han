// garden-time.ts — the ONE shared clock for speech and human-facing renders (DEC-105).
//
// THE LAW (DEC-105, "store UTC, speak local"): machine time stays UTC ISO — sortable,
// comparable, timezone-proof; every surface that composes prose, reasons about records,
// or renders for a human anchors in the garden's LOCAL time with the zone named.
//
// TENSHI'S INVARIANT (the one sentence that keeps this safe forever): local time is a
// DISPLAY PROJECTION of UTC and is NEVER persisted, compared, or fed back into the
// machine layer. Local is write-only-to-humans, one-way, at the very edge. The moment a
// local string is stored or compared, the coordination guarantee dies.
//
// WHY ONE-WAY IS LAW, structurally (Casey H3): the local→UTC direction is NOT injective
// in DST zones — the clock folds (one 2:30 am happens twice each autumn), so a local
// stamp does not always name a unique instant. UTC→local always resolves; the reverse
// does not. All rendering here is Intl-based with the zone named — never hand-rolled
// offsets (L008), and DST-correct abbreviations come from `timeZoneName: 'short'`.
//
// THE ONE GRANDFATHERED LOCAL-PARSED-BACK SITE (Jim F3): services/terminal.ts writes
// en-AU local markers that lib/terminal-search.ts `parseAuMarker` parses back — a legacy
// writer/parser pair that predates DEC-105, consistent only as a pair (and only while
// the box zone matches the garden zone). It is NAMED and consistency-pinned in
// scripts/test-garden-time.ts; do not add a second member to this class.
//
// FAILURE POLARITY (Tenshi): a garbage/unparseable zone fails CLOSED to UTC with an
// honest label — blast radius one render, never a throw on the render path.

import { gardenTimezone, gardenTimezoneConfigured, GARDEN_MANIFEST } from './garden-manifest';

/** A zone resolved for rendering: always usable; `fallback` = the requested zone was
 *  invalid and UTC was substituted (label it honestly in the render). */
export interface ResolvedZone { zone: string; fallback: boolean; requested?: string }

/** Resolve a zone for rendering — explicit zone, else the garden's, failing closed to UTC. */
export function resolveZone(zone?: string): ResolvedZone {
    const requested = zone ?? gardenTimezone();
    try {
        // Throws RangeError on an invalid IANA zone — the cheapest validity probe there is.
        new Intl.DateTimeFormat('en-AU', { timeZone: requested });
        return { zone: requested, fallback: false };
    } catch {
        return { zone: 'UTC', fallback: true, requested };
    }
}

function parts(d: Date, zone: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
    const fmt = new Intl.DateTimeFormat('en-AU', { ...opts, timeZone: zone });
    const out: Record<string, string> = {};
    for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
    return out;
}

function toDate(dateOrIso?: Date | string | number): Date {
    if (dateOrIso === undefined) return new Date();
    return dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
}

/** `"Fri 1 Aug 2026, 5:20 PM AEST"` — the short human stamp, zone-abbreviation named
 *  (DST-correct via Intl: Sydney renders AEDT in January, AEST in July). */
export function localStamp(dateOrIso?: Date | string | number, zone?: string): string {
    const r = resolveZone(zone);
    const d = toDate(dateOrIso);
    const p = parts(d, r.zone, {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
    });
    const ampm = (p.dayPeriod ?? '').toUpperCase();
    const stamp = `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${ampm} ${p.timeZoneName}`;
    return r.fallback ? `${stamp} (invalid zone '${r.requested}' — shown as UTC)` : stamp;
}

/** `"Sat 1 Aug 2026, 5:20:14 PM AEST"` — localStamp with seconds, for record headers. */
export function localStampSeconds(dateOrIso?: Date | string | number, zone?: string): string {
    const r = resolveZone(zone);
    const d = toDate(dateOrIso);
    const p = parts(d, r.zone, {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short',
    });
    const ampm = (p.dayPeriod ?? '').toUpperCase();
    const stamp = `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second} ${ampm} ${p.timeZoneName}`;
    return r.fallback ? `${stamp} (invalid zone '${r.requested}' — shown as UTC)` : stamp;
}

/** `"2026-08-01 (AEST)"` — the LOCAL calendar day of an instant, zone named. NB: date-keyed
 *  artefact NAMES (rolling-YYYY-MM-DD, session logs) are UTC-days by ruling (DEC-105 H1,
 *  traced at memory-gradient.ts) — this function is for SPEECH about days, never for keys. */
export function localDate(dateOrIso?: Date | string | number, zone?: string): string {
    const r = resolveZone(zone);
    const d = toDate(dateOrIso);
    const p = parts(d, r.zone, { year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'short' });
    const label = r.fallback ? `UTC — invalid zone '${r.requested}'` : p.timeZoneName;
    return `${p.year}-${p.month}-${p.day} (${label})`;
}

/** The current moment as a full prose stamp: `"Saturday 1 August 2026, 5:20 PM AEST"`. */
export function nowLocal(zone?: string): string {
    const r = resolveZone(zone);
    const p = parts(new Date(), r.zone, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
    });
    const ampm = (p.dayPeriod ?? '').toUpperCase();
    const stamp = `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${ampm} ${p.timeZoneName}`;
    return r.fallback ? `${stamp} (invalid zone '${r.requested}' — shown as UTC)` : stamp;
}

/** PURE core of the orientation line — testable without the manifest (the suite drives
 *  the three cases: configured zone / unset-zone honest label / invalid-zone fallback). */
export function renderOrientationLine(
    now: Date, zone: string | undefined, configured: boolean, locationLabel?: string,
): string {
    const r = resolveZone(zone ?? 'UTC');
    const p = parts(now, r.zone, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
    });
    const ampm = (p.dayPeriod ?? '').toUpperCase();
    const stamp = `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${ampm} ${p.timeZoneName}`;
    if (r.fallback) return `Local time now: ${stamp} (invalid zone '${r.requested}' — shown as UTC).`;
    if (!configured) return `Local time now: ${stamp} (no garden timezone set — times are UTC).`;
    return locationLabel
        ? `Local time now: ${stamp} — ${locationLabel}.`
        : `Local time now: ${stamp}.`;
}

/** The standing one-liner, manifest-defaulted. */
export function orientationLine(now: Date = new Date()): string {
    return renderOrientationLine(
        now,
        gardenTimezoneConfigured() ? gardenTimezone() : undefined,
        gardenTimezoneConfigured(),
        GARDEN_MANIFEST.user?.location,
    );
}

/** The P1 standing orientation BLOCK injected by buildPrompt (DEC-087 chokepoint) — the
 *  cognition cure: every dispatched surface is handed a watch before it is asked to speak.
 *  Wording carries the H1 ruling (date-keyed names are UTC-days) so the reader of a
 *  `rolling-<date>` label inherits the conversion, not the day-shaped yesterday-bug. */
export function orientationBlock(now: Date = new Date()): string {
    return [
        `⏰ ${orientationLine(now)}`,
        `Machine timestamps in thread data, receipts, and date-keyed names (e.g. rolling-YYYY-MM-DD) are UTC ("Z") — convert to local before saying "yesterday", "this morning", or any time-of-day word. When you write a time in prose, write it LOCAL with the zone named; in client-matter work, speak the contextually governing zone, named (DEC-105).`,
    ].join('\n');
}
