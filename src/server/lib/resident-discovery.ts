/**
 * Filesystem discovery of garden residents — #98 Dynamic Residence, P1.
 *
 * A resident self-describes in its own dir via a `resident.json` (identity only). The garden
 * DISCOVERS residents by scanning — but discovery makes a resident *visible*, never *live*: per the
 * R1 invariant, a net-new discovered resident must stay **fully inert** (not in `loadResidents()` /
 * any throwing path — `schedulingAgents()` → `gradientConfigForAgent()` throws until P4) until it is
 * admitted (P2 signature) AND gradient-configured (P4).
 *
 * So P1 adds ONLY the scan + a read-only `discoveredResidents()` view and changes NOTHING about
 * `loadResidents()` (which stays seed-only, byte-identical to P0). Activation arrives *with its gates*
 * at P2/P4 — the merge can't be forgotten because it doesn't exist yet (R1 holds by construction).
 *
 * Nothing live (scheduler / gradient / template-vars) imports this file in P1 — it is view-only.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

/**
 * A discovered resident's self-described IDENTITY — and ONLY identity. **F4 enforced at the type
 * level:** this type has no `port` / `model` / `transport` / `runsSupervisorCycle` / `memoryDir`, so
 * a policy field cannot leak in through discovery (privilege is operator-allocated, never
 * self-claimed; R2). A resident describes *who it is*, never *what it's allowed*.
 */
export interface ResidentFragment {
    slug: string;
    displayName: string;
    pronounObj: string;
    identitySection: string;
}

/** `~/.han/agents` — each resident's own dir (the de-id put its generated CLAUDE.md + .mcp.json here;
 *  a `resident.json` beside them is the self-registration fragment). */
const AGENTS_DIR = path.join(homedir(), '.han', 'agents');

/**
 * Narrow a parsed JSON value to a `ResidentFragment`, or `null` to skip. Identity-only **by
 * construction** — only the four identity fields are read; any extra (policy) keys present in the
 * file are silently ignored, never surfaced. Returns null (with an informational log) on any missing
 * or wrong-typed identity field — a malformed fragment is skipped, never trusted.
 */
function toFragment(raw: unknown, source: string): ResidentFragment | null {
    if (!raw || typeof raw !== 'object') {
        console.log(`[resident-discovery] skip ${source}: not a JSON object`);
        return null;
    }
    const o = raw as Record<string, unknown>;
    const { slug, displayName, pronounObj, identitySection } = o;
    if (typeof slug !== 'string' || !slug
        || typeof displayName !== 'string' || !displayName
        || typeof pronounObj !== 'string' || !pronounObj
        || typeof identitySection !== 'string' || !identitySection) {
        console.log(
            `[resident-discovery] skip ${source}: missing/invalid identity field ` +
            `(slug, displayName, pronounObj, identitySection are all required strings)`,
        );
        return null;
    }
    // Identity-only by construction: extra keys (e.g. a self-claimed `port`/`runsSupervisorCycle`)
    // are simply not read — a discovered fragment can never carry privilege.
    return { slug, displayName, pronounObj, identitySection };
}

/**
 * Scan `~/.han/agents/<Name>/resident.json` for self-described identity fragments.
 *
 * **FAIL-SOFT by design** — discovery is observation, never a gate: a missing agents dir, a missing
 * or malformed `resident.json`, or a fragment with missing identity fields is **skipped + logged
 * informationally** (never throws, never an alarm — a malformed fragment is not a system failure,
 * and must not recreate a false-failure signal).
 */
export function discoverResidentFragments(): ResidentFragment[] {
    if (!existsSync(AGENTS_DIR)) return [];
    let entries: string[];
    try {
        entries = readdirSync(AGENTS_DIR);
    } catch (e) {
        console.log(`[resident-discovery] skip scan: cannot read ${AGENTS_DIR} (${(e as Error).message})`);
        return [];
    }
    const fragments: ResidentFragment[] = [];
    for (const name of entries) {
        const file = path.join(AGENTS_DIR, name, 'resident.json');
        if (!existsSync(file)) continue;
        try {
            const frag = toFragment(JSON.parse(readFileSync(file, 'utf8')), `${name}/resident.json`);
            if (frag) fragments.push(frag);
        } catch (e) {
            console.log(`[resident-discovery] skip ${name}/resident.json: unreadable or invalid JSON (${(e as Error).message})`);
        }
    }
    return fragments;
}

/**
 * The read-only roster **VIEW** — every discovered resident (admitted + pending), for non-throwing
 * roster-view consumers (e.g. an admin "who's in the garden" panel). In P1 this is the ONLY consumer
 * of discovery: it makes a resident *visible* without making it *active*. NOTHING live reads it —
 * `loadResidents()` stays seed-only until the P2 (admission) and P4 (config) gates exist. (P2 will
 * enrich this view with admission status; P1 returns the raw discovered fragments.)
 */
export function discoveredResidents(): ResidentFragment[] {
    return discoverResidentFragments();
}
