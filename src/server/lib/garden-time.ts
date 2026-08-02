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
// THE ONE GRANDFATHERED LOCAL-PARSED-BACK SITE (Jim F3, root-cured at the seal):
// services/terminal.ts writes en-AU local markers that lib/terminal-search.ts
// `parseAuMarker` parses back — a legacy pair predating DEC-105. Since Jim's seal-rider
// fold the parser constructs in the WRITER's own zone (dateFromZonedParts below), so the
// pair is correct by construction on any box. It is NAMED, membership-gated and
// round-trip-pinned in scripts/test-garden-time.ts; no second member may join the class.
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

/**
 * Jim's root-cure fold (the DEC-105 seal riders, 2026-08-02): interpret wall-clock
 * PARTS as a moment in a named zone — the inverse render, for the ONE grandfathered
 * local-parsed-back pair. With this, parseAuMarker constructs its Date in the WRITER's
 * own zone (gardenTimezone()) instead of the box's, so the pair is correct BY
 * CONSTRUCTION on any box — UTC system clocks included — and the old box==garden
 * coincidence is retired rather than witnessed. Two-pass Intl technique; fail-closed
 * zone resolution as everywhere else.
 *
 * THE FOLD, NAMED WHERE THE EXCEPTION LIVES (Tenshi's informational note + Casey's
 * residual (b), both at the seal, 2026-08-02): this function runs the local→UTC
 * direction that DEC-105's own text declares NON-INJECTIVE. The two passes converge on
 * spring-forward gaps and ordinary offsets — but in the autumn FOLD hour (one wall
 * reading, two real instants) no algorithm can be "correct by construction", because
 * the input does not determine an answer. Resolution here is DETERMINISTIC-BUT-
 * ARBITRARY: it takes the STANDARD-TIME (later) instant — measured: Sydney 5 Apr 2026
 * 02:30 → 16:30Z, never 15:30Z — so a marker written in the first (daylight) pass
 * parses one hour late while still rendering back as 02:30 (it LOOKS correct; that is
 * the hazard). A gap-hour input (which the writer can never produce — it renders only
 * real instants) resolves to an instant that renders one hour on. One repeated hour
 * per year, DST gardens only, terminal-anchoring blast radius; suite-pinned so the
 * behaviour is measured, not believed.
 */
export function dateFromZonedParts(
    year: number, month1: number, day: number,
    hour: number, minute: number, second: number,
    zone?: string,
): Date {
    const r = resolveZone(zone);
    const target = Date.UTC(year, month1 - 1, day, hour, minute, second);
    let utc = target;
    for (let i = 0; i < 2; i++) {
        const p = parts(new Date(utc), r.zone, {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        } as Intl.DateTimeFormatOptions);
        const asIf = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
        utc += target - asIf;
    }
    return new Date(utc);
}

/**
 * Rider 3 of the DEC-105 seal (Casey's instrument, Tenshi's organ, 2026-08-02 — then
 * softened by Jim's root-cure fold the same day): the parseAuMarker pair originally
 * depended on box zone == garden zone by undocumented coincidence; the root cure
 * (dateFromZonedParts in the parser) retired that dependency — the pair is correct by
 * construction on any box. What this checker still reports is clock HYGIENE: a box
 * whose system zone differs from the garden's speaks two clocks in its own logs, cron
 * schedules and `date` output. Boot tripwire in server.ts (loud, never stop); the
 * standing daily read is FI #126's clock organ.
 */
export function boxZoneMatchesGarden(): { match: boolean; boxZone: string; gardenZone: string } {
    const boxZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    const gz = gardenTimezone();
    return { match: boxZone === gz, boxZone, gardenZone: gz };
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
