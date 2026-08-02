// garden-clock.ts — the admin's ONE clock (DEC-105 P3). The zone arrives from the
// MANIFEST via /api/ecosystem (set once at app mount) — never hardcoded client-side
// (Jim's fold 1: a fork's admin must show its OWN garden's time, the DEC-081 rule in
// the browser). This module is deliberately pure and server-import-free (fold 2: the
// G2b allow-list stays a server-side law; the client gets its own few lines) and
// FAIL-CLOSED: absent or garbage zone ⇒ render UTC with the honest label — the same
// door garden-time holds server-side. Local is a display projection of UTC, never
// persisted, compared, or fed back (Tenshi's invariant — this file only ever renders).

let zone: string | undefined;
let honest = true; // false ⇒ we fell back to UTC because the supplied zone was garbage

/** Set from /api/ecosystem's `timezone` at app mount. Validates via Intl; fail-closed. */
export function setGardenZone(z: string | undefined | null): void {
    if (!z) { zone = undefined; honest = true; return; } // unset garden ⇒ honest UTC
    try {
        new Intl.DateTimeFormat('en-AU', { timeZone: z });
        zone = z; honest = true;
    } catch {
        zone = undefined; honest = false; // garbage ⇒ UTC, labelled as a fallback
    }
}

/** The zone every formatter renders in ('UTC' until the manifest zone arrives). */
export function gardenZone(): string { return zone ?? 'UTC'; }

/** The short zone label rendered beside times (AEST/AEDT/UTC…, DST-correct via Intl). */
export function zoneLabel(d: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-AU', { timeZone: gardenZone(), timeZoneName: 'short', hour: 'numeric' }).formatToParts(d);
    const name = parts.find(p => p.type === 'timeZoneName')?.value ?? 'UTC';
    return honest ? name : `${name}*`; // * = the supplied zone was invalid; showing UTC
}

/** Intl options fragment: spread into any toLocale* call so it renders garden time. */
export function inGardenZone(): { timeZone: string } { return { timeZone: gardenZone() }; }
