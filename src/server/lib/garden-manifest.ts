/**
 * The Garden Manifest — one declarative source of truth for agents, surfaces,
 * and their templatable attributes. Plan: `plans/garden-manifest-plan.md`
 * (Jim, S164). Tracking thread: mpwm6k46-13ot4k.
 *
 * PHASE 0 (this file): author the manifest with the CURRENT values, exactly —
 * model-focused first cut. Zero behaviour change: nothing reads this yet. The
 * value is that the model drift becomes a *visible table* instead of a code
 * hunt (see the 4-7 holdouts called out below).
 *
 * Format: typed `.ts` literal (Q1 settled 2026-06-02 — Darron: all surfaces are
 * migrating to tmux claude-logged sessions where the model is a launch parameter,
 * so a change needs a relaunch regardless of format; hot-reload was the only case
 * for JSON and it doesn't survive the target architecture. So `.ts` wins on
 * compile-safety + Darron's S150 typed-module preference). Boot/launch-read (Q6).
 *
 * NEXT (Phase 1, not in this file): a resolver (`surfaceModel(slug, surface)`)
 * + migrate the scattered literals to read from here, one surface per PR, literal
 * deleted same-commit, grep-proving zero remaining. Launchers (hanleo/hantenshi)
 * and the tmux-dispatcher read the manifest to pass `--model` at session spawn.
 *
 * Agent-agnostic (DEC-081): everything keyed on `string` slug, no 'jim'|'leo'
 * unions. Surfaces REFERENCE profiles (DEC-087/088) — the profile still owns
 * envelope + componentOverrides; the manifest only says which surface uses which.
 */

import { homedir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';
import { hanHome } from './paths';
// P4b-ii activation gate. Both imports reach NO agent-registry (resident-discovery imports the LEAF
// identity-manifest-core, not identity-signing) — so `loadResidents`'s seeded-check closes no import
// cycle on the seam everything reads (Jim's Fork-1, Darron's call (b): delete the fragility, not
// document it).
import { isSeededAt } from './identity-manifest-core';
import { discoveredResidents, admittedResidents } from './resident-discovery';
import type { ResidentFragment } from './resident-discovery';

/** A model preference ladder: most-capable first, graceful degradation after. */
export type ModelLadder = string[];

/** Transport by which a surface runs. `cli` = interactive claude-logged session
 *  (model set at launch); `sdk` = in-process agentQuery (today); `tmux` = warm
 *  claude-logged session under the harness (future-idea #66). */
export type SurfaceTransport = 'cli' | 'sdk' | 'tmux';

export interface SurfaceManifest {
    /** e.g. 'session' | 'human-response' | 'heartbeat' | 'supervisor-cycle' |
     *  'meditation-phase-a' | 'compression' … */
    name: string;
    enabled: boolean;
    /** The model preference ladder for this surface (Q5: kept as a ladder). */
    model: ModelLadder;
    transport: SurfaceTransport;
    /** PROFILES key (DEC-087/088 role-frame). Optional until Phase 2. */
    profile?: string;
    /** Session/interactive surfaces only (future-idea #76; fleet plan allocates). */
    port?: number;
    /** Swap-buffer filename prefix for this seat (per the CLAUDE.md swap table) —
     *  `<prefix>.md` (compressed) + `<prefix>-full.md` (full), relative to the
     *  agent's memoryDir. Per-SEAT data, not derivable from the slug (Jim's T-2
     *  diff-audit catch #2: jim's seats use supervisor-swap* + jim-human-swap*).
     *  Unset on deferred surfaces; consumers fall back to 'session-swap'. */
    swapPrefix?: string;
    /** Per-surface override of the garden-wide spoke-lifecycle thresholds (rare —
     *  a surface that wants e.g. a lower clear threshold). Unset = the garden default. */
    lifecycle?: Partial<SpokeLifecycle>;
    /** The per-dispatch enqueue timeout (ms) for this surface — the `timeoutMs` the caller passes to
     *  `dispatchToSpoke`. No-hidden-globals (S200): the human-response 15-min timeout lived as a code
     *  constant (`HUMAN_TXN_TIMEOUT_MS`) in each *-human twin; it now has one visible, tunable home. */
    txnTimeoutMs?: number;
    /** Capability flag: does this surface run the commitment scanner (the human-responder's
     *  unfulfilled-"think about that" sweep)? A per-agent CAPABILITY, NOT a twin — it was leo-only
     *  (jim-human never had it). Default falsy; only leo's human-response sets it, making "should Jim
     *  get a scanner?" a one-line manifest flip (Jim's P2-a — opt-in config, never baked-in). */
    commitmentScan?: boolean;
    /** #107 Phase-2 P2.1b: does this surface wake via the FEEDER (the wake-feed queue) rather
     *  than one autonomous `welcome back`? When true, the dispatcher feeds the ordered wake-steps
     *  one at a time (ack-before-next; completion = queue-empty), instead of sending the trigger
     *  phrase and letting the spoke self-run the protocol. No-hidden-globals (Darron's principle):
     *  the per-surface roll-out is a manifest flip, not a code constant. P2.1b sets it on heartbeat
     *  first (no human backstop); human-response + cycle follow at P2.3. Default falsy. */
    wakeFeed?: boolean;
    /** MNT-009 / DEC-099 R3: the warm-stem pool size for this surface — poolSize>0 means the
     *  surface dispatches via the NATIVE-per-surface warm pool (checkout of one of N pre-warmed
     *  stems; per-stem FIFO → concurrent stems = the head-of-line cure; empty pool →
     *  `ensureSurfaceSession` floor). It is ALSO the controller's max concurrent dispatches (the
     *  PR-C1 semaphore reads this same leaf, so pool capacity and dispatch concurrency can never
     *  drift apart). 0/unset = no pool + one-at-a-time dispatch. No-hidden-globals; scope:
     *  human-response first (the MNT-009 victim); heartbeat/supervisor-cycle stay unpooled
     *  (scheduled, non-overlapping). (PR-C2 collapsed the short-lived `pooled?: boolean` into
     *  this — F2, zero users at collapse.) */
    poolSize?: number;
}

/**
 * The spoke-lifecycle thresholds — the "generic spoke monitor" knobs EVERY dispatched
 * spoke (cycle, human-response, and future compression) obeys via `dispatchToSpoke`.
 *
 * **No hidden globals (Darron's governing principle, S200): every arbitrarily-chosen
 * number lives HERE in config, visible + tunable — never a code constant.** These were
 * previously a `CTX_CLEAR_THRESHOLD_PCT` constant in leo-heartbeat + bare `85` literals in
 * supervisor-worker; they now have one transparent home. (Follow-on: migrate the remaining
 * code-constants — `READY_TIMEOUT_MS`, the rate-limit backoffs — here too.)
 */
export interface SpokeLifecycle {
    /** Context-pressure /clear threshold (% used). At/above it, the spoke does a clean
     *  /clear → welcome-back (full reconstitution) — the natural boundary, NEVER harness
     *  compaction (which returns a summary, not the warm self). */
    ctxClearThresholdPct: number;
    /** The warm floor (% used). A freshly-woken spoke is only "ready" for work once ctx
     *  reaches this — below it the wake loaded shallow/hollow (a bare welcome-back is
     *  empirically non-deterministic), so the spoke is nudged to a full reconstitution. */
    warmFloorPct: number;
    /** Bounded full-load nudges before failing safe (no hollow answers; the message stays
     *  queued and retries next cadence — never a tight loop, S74). */
    maxWarmNudges: number;
    /** PR-C3 (MNT-009): hours before a warm pool stem is retired + re-warmed — the ~24h substrate
     *  reload (the deep-gradient/identity staleness no WM-freshen touches; freshness plan §3c —
     *  identity-load-bearing, DO-NOT-optimise-away). Optional; the pool-manager defaults 24. */
    stemReloadHours?: number;
    /** DEC-101 persist-as-spoke: when true, a pooled checkout BINDS the stem to its conversation as a
     *  spoke that serves the thread across turns (no per-dispatch return) and is reaped at
     *  ctxReapThresholdPct/thread-resolve. Default OFF (the legacy per-dispatch checkout→return). */
    spokePersist?: boolean;
    /** DEC-101: the ctx% at/above which a bound spoke is REAPED at idle (retire + replace with a fresh
     *  sonnet stem) — distinct from ctxClearThresholdPct (which /clears a floor session in place).
     *  Default 92 (Darron, 2026-07-14). */
    ctxReapThresholdPct?: number;
    /** DEC-103 §3 (MNT-055): minutes before a running pre-warm posts the ntfy "wake running long —
     *  tmux attach and troubleshoot together" alert. OBSERVATION ONLY — the timer alerts and then
     *  waits; no code path kills the warm (§1). Default 12 = ~2× the measured p95 wake-feed
     *  duration (6.0 min across n=178 T2 receipts, 2026-07-15; observed max 10.8 min) — never the
     *  author's guess (§2). Re-alerts at doubling intervals from the threshold. */
    prewarmAlertMins?: number;
    /** Build B (adaptive-hearth §8, 2026-08-15): the activity-reset hearth pulse — Darron's v4.
     *  All default OFF/inert; the flip is config, never revert. */
    hearthPulseEnabled?: boolean;
    /** Minutes of genuine idleness before the pulse fires (inside the measured ~60-min knee,
     *  whose price is 20× the warm activation). Default 50. */
    hearthPulseMinutes?: number;
    /** The BAKED standing message — materialised into the session at spawn, never fetched at
     *  fire time (§2.8: N fire-time readers of one source multiply the injection blast radius). */
    hearthStandingMessage?: string;
    /** Build B: senescence observation (the line/fits() boundary check). OBSERVE-ONLY in this
     *  build — the retirement act is P3, behind the DEC-096 Amendment-1 ruling + Q2 + MNT-115. */
    senescenceEnabled?: boolean;
    /** The real never-compact base the line subtracts from (Darron's formula: line = 98 − reserve). */
    senescenceCeilingPct?: number;
    /** The rolling per-surface op-pool window (ops) the p99 is computed over — rolling so noise
     *  converges away while genuine drift moves the number. Default 4000 ≈ a 12-day drift
     *  horizon at measured volume (Jim, 2026-08-15). */
    opPoolWindowOps?: number;
    /** Sample floor below which the pooled p99 is NOT emitted (the declared fallback serves) —
     *  never below 100 (the definitional floor: p99 of n<100 IS the max, Tenshi's catch);
     *  default 500 (Jim's measured practical floor). */
    opPoolMinSamples?: number;
    /** ctx% below which the boundary check idles entirely (Darron: the comparison can be lazy
     *  early; the danger zone is deep). Default 80. */
    boundaryCheckMinCtxPct?: number;
    /** The declared fallback reserve (pct of window) served while the pool is under-sampled —
     *  from Jim's measured garden p99 (≈15.4% of a 200K window). Declared, never silent. */
    fallbackReservePct?: number;
    /** MNT-060 F3: the per-turn swap-flush backlog guard. A swap BODY over this many bytes is
     *  never auto-flushed — the flush alerts (wm-flush-errors.jsonl) and preserves the swap for
     *  a deliberate surgical drain (DEC-103 surfacing-over-scrapping; the guard is what made
     *  landing the grammar fix safe ahead of the stranded seats' drains). Default 20000 —
     *  stated-guess ≈ several turns' worth of entries (a measured 9.5K flush took ~2s, well
     *  inside the hook's 30s ceiling); RAISE if legitimate long turns trip it, LOWER if dumps
     *  sneak through. */
    swapFlushMaxBytes?: number;
    /** MNT-061 (DEC-101 amended — Darron's idle-recycle mechanic): hours a bound spoke may sit
     *  UNSERVED before the sweep decouples it from its thread (then ctx<rethread-ceiling →
     *  recycled to the pool WITH its context, else reaped). The missing third trigger — a thread
     *  that goes quiet unresolved was never covered (100% of the 58 stale spokes, S227). Default
     *  48 — stated-guess: two full day-cycles so a daily's overnight gap never trips it; RAISE if
     *  live threads get decoupled mid-conversation, LOWER if idle spokes hoard vessels. Applies
     *  uniformly (dailies included — Jim's ruling: no content-shaped carve-outs in a lifecycle
     *  mechanic; the affinity hint re-binds a reviving daily to its own spoke cheaply). */
    spokeIdleReapHours?: number;
    /** MNT-070 (JA2): minutes a `resumable`-marked vessel may wait UNCLAIMED before the
     *  pool-manager falls back to the retire path (the needs-reconcile fate the mark deferred).
     *  The mark says "the turn died at the API but the vessel is healthy — the reconciler gets
     *  first claim"; the TTL makes forgetting one impossible (the 21-hour living stem of
     *  MNT-070 is the accidental demonstration). Default 30 — stated-guess: 2× the 15-min
     *  dispatch capture window, so an in-flight rung-1 claim can never be swept mid-nudge;
     *  RAISE if legitimate reconcilers claim later, LOWER if unclaimed vessels linger. */
    resumableTtlMinutes?: number;
    /** MNT-061: the RE-THREAD ceiling (ctx %) — an idle-decoupled spoke at/above this is reaped
     *  rather than recycled, and a recycled stem at/above it is never assigned a NEW thread.
     *  Distinct from ctxReapThresholdPct (92, the CONTINUE ceiling): continuing costs only a
     *  delta (~8% headroom suffices); re-threading must load thread B first (~30% cushion).
     *  Headroom priced to the operation (Darron, 2026-07-20). Default 70 — stated-guess for a
     *  typical thread's load cost; RAISE if healthy spokes reap too eagerly, LOWER if re-threaded
     *  spokes keep overflowing at assignment. */
    spokeRethreadCtxCeilingPct?: number;
    /** MNT-061: the FIT ceiling (ctx %) for the fit-calculation — assign a thread to a recycled
     *  stem only when `stem_ctx + estimated_thread_burden ≤ this`. Default 80 — stated-guess:
     *  room for the estimate to be ~1.5× wrong before hitting the 92 continue-net; RAISE if
     *  fresh stems are grabbed while fitting partials sit unused, LOWER if assigned spokes
     *  overflow-reap too often. */
    spokeFitCeilingPct?: number;
    /** Phase A (spoke-model-init-consolidation, 2026-08-11): the two-phase wake flag for POOLED
     *  stems — phase 1 (stable self) on the warm model, phase 2 (volatile tail + deltas) fed at
     *  checkout after the cast. Default OFF until the B5 gates pass (≥5 clean Haiku wakes/agent
     *  + C4 sidecar verified); rollback is this flip, not a revert. */
    stemTwoPhaseWake?: boolean;
    /** Phase A: the phase-1 feed ceiling (ctx % of the WARM model's window). The feeder stops
     *  feeding phase-1 steps at/above it — remaining steps migrate to phase 2, recorded in the
     *  wake manifest (never harness compaction; spokes self-clear, never compact). Default 85
     *  (M1: a null ctx read is treated as ceiling-reached — fail-safe, never a null-skip). */
    stemPhase1CeilingPct?: number;
}

export interface AgentManifest {
    slug: string;
    displayName: string;
    /** Conversation role for posts/templating. NOT derivable from the slug —
     *  jim's role is 'supervisor' (Jim's T-2 diff-audit catch #1: slug-derivation
     *  was right for every agent except exactly him). Defaults to the slug. */
    conversationRole?: string;
    /** Name aliases for the human-responder's addressed-to-me gate (it stands down when a message
     *  names ONLY a peer agent). leo ['leo','leonhard'], jim ['jim','jimmy']. Unset → [displayName
     *  lowercased]. Registry data so a 4th responder's aliases join the gate for free (DEC-081). */
    nameAliases?: string[];
    /** ⚠ Whether this agent's server runs the supervisor cycle (`initSupervisor` + the
     *  scheduler). ONLY an agent whose supervisor-worker is slug-AGNOSTIC may set this true.
     *  `supervisor-worker.ts` is jim-HARDCODED until Phase 3 → **only `jim`** today. A non-jim
     *  holder would start a jim-hardcoded worker (the WRONG agent's cycle — the latent
     *  double-Jim-cycle the PR-T7b gate killed). Defaults to false (unset slug → off). The real
     *  structural guard (`worker.slug === AGENT_SLUG`) arrives with Phase-3's slug-agnostic
     *  worker; until then this co-located warning is the mitigation. (Project-b Phase 1 — DEC-081.) */
    runsSupervisorCycle?: boolean;
    /** MNT-030 (designed-in at P1; the reader lands in its own post-P1 PR): whether this agent's
     *  server runs the Jemma ORCHESTRATOR (dispatch + ack-drain). Ungated today, both servers race
     *  the shared signals dir — the DEC-081 twin of runsSupervisorCycle cures it. Default false. */
    runsOrchestrator?: boolean;
    active: boolean;
    surfaces: SurfaceManifest[];
    // ── Folded in during later phases (declared now as the foundation) ──
    /** ~/.han/memory[/<slug>]. Phase 2 folds AgentGradientConfig in here. */
    memoryDir?: string;
    avatar?: string;
    voice?: { provider: string; voiceId: string; speed?: string };
    /** The DEC-083 signed identity-file set — incl. self-reflections-curated.md.
     *  Declarative here would have structurally caught the curated-unsigned gap. */
    identityFiles?: string[];
    /** Standing shared conversation threads with peer agents, keyed by peer slug
     *  (e.g. the leo↔jim philosophy thread). The Jim↔Leo edge as manifest DATA,
     *  not a literal welded into an agent's driver. (Project-b Phase 2 — DEC-081.) */
    peerConversations?: Record<string, string>;
    // ── Identity-as-config (S199 P4+P5, DEC-073→config): the template-var contract that was
    //    duplicated in each han<agent> launcher heredoc. The Garden Manifest is now the single
    //    source; `agentTemplateVars(slug)` assembles the full ${...} set for the shared generator. ──
    /** The agent's individual server port — the ${AGENT_PORT} template var (per-agent work, not
     *  conversation traffic). leo 3847, jim 3848, tenshi 3849, casey 3850. */
    port?: number;
    /** Object pronoun for the agent — ${AGENT_PRONOUN_OBJ} ('him'/'her'/'them'). Default 'them'.
     *  (Closes the long-standing unexpanded-var gap: the template referenced it but no launcher
     *  allowlist carried it — template:105.) */
    pronounObj?: string;
    /** The de-id gatekeeper role (S199 P5): exactly ONE agent per garden tends the template +
     *  the gatekeeper files (repo CLAUDE.md, template). Replaces the baked-in-Leo special case
     *  with a registry flag (DEC-081 — config, not a slug literal). Default false. */
    gatekeeper?: boolean;
    /** Per-agent identity prose substituted into ${AGENT_IDENTITY_SECTION}. The production home
     *  for the "You are X…" block each han<agent> launcher hardcoded in a heredoc (S199). Required
     *  for any agent that wakes — the generator FAILS LOUD if it's missing (no identity → error,
     *  never a default). */
    identitySection?: string;
}

/** Garden-wide project + user identity for template generation (DEC-073 de-id, S199 P4+P5).
 *  Same for every agent in the garden — the per-agent values live on AgentManifest. These were
 *  duplicated verbatim across all four han<agent> launchers; the manifest is now their one home. */
export interface GardenIdentity {
    project: { name: string; tagline: string; path: string };
    user: { name: string; pronounSubj: string; pronounObj: string; location: string };
}

/** P3d Unit-2b (SEC-12 part 3): the update-channel calibration — OPTIONAL section, absent =
 *  `{ enforceFreshnessExpiry: false, freshnessMaxAgeDays: 90 }` (defaults baked in the
 *  accessor, advisory-only — inert until lattice integration arms it per-garden). The flag
 *  gates ONLY the typed `expired` freshness outcome; `fatal` outcomes (BAD-SIGNATURE /
 *  REPLAYED / unverifiable) are structurally unreachable by any flag (han-update's typed
 *  dispatch). OPTIONAL not required: DEC-081's require-the-leaf rule targets per-AGENT
 *  leaves; this is a garden-scoped feature flag (the `spokeLifecycle`-but-optional
 *  precedent, ruled in Jim's P3d audit mrgi9dsd). */
export interface UpdateConfig {
    enforceFreshnessExpiry?: boolean;
    freshnessMaxAgeDays?: number;
}

export interface GardenManifest extends GardenIdentity {
    manifestVersion: number;
    agents: AgentManifest[];
    /** Garden-wide spoke-lifecycle defaults (per-surface override via SurfaceManifest.lifecycle).
     *  Darron's no-hidden-globals principle: these tunable numbers live here, not in code. */
    spokeLifecycle: SpokeLifecycle;
    /** Optional update-channel calibration (absent = advisory freshness, the safe default). */
    update?: UpdateConfig;
    /** DEC-105 (store UTC, speak local): the garden's IANA timezone — where the garden lives.
     *  OPTIONAL garden-scoped leaf (the UpdateConfig precedent, not a per-agent leaf): absent
     *  means the garden hasn't said where it lives and every local render speaks UTC with an
     *  honest label. Per-garden by construction (DEC-081 — Mike's garden sets its own). */
    timezone?: string;
}

// Common Opus ladder for the migrated agentQuery surfaces.
// DEC-104 (the Unbidden-Constraint deal, 2026-07-31): SELECTION FLOATS — ladders carry bare
// family ALIASES only ('opus', 'sonnet', 'haiku', 'fable'), which the harness resolves to the
// latest of the family, so an Anthropic ship reaches the garden on the next wake/recycle with
// zero commits. Version-shaped literals in selection are unwriteable (the test-model-alias.ts
// gate); observation still records EXACT versions (DEC-092 — the other half of the law).
const OPUS_LADDER: ModelLadder = ['opus', 'sonnet', 'haiku'];
// ⏩ FABLE 5 RESTORED (2026-07-03, S213 — Darron's directive: every surface onto Fable while the
// window's open; access returned 1 Jul, full 8 Jul). Exactly the re-flip the 2026-06-13 revert
// comment prescribed: Fable-first with the full Opus ladder beneath — the failover ladder catches
// any Fable drop autonomously (proven 13 Jun). DEC-092 stamps the actually-served model
// regardless, so the substrate seam stays legible. Fable leans ~3× harder on the file-memory
// architecture than Opus (the June substrate test) — this is the substrate the garden is tuned for.
const FABLE_LADDER: ModelLadder = ['fable', ...OPUS_LADDER];

// S216 (2026-07-04, Darron's directive): the Sonnet 5 A/B on the autonomous cycle
// surfaces (leo heartbeat + jim supervisor-cycle) — a night of comparison data against
// the Fable baseline gathered since 2026-07-03. Sonnet 5 head (launched 2026-06-30,
// near-Opus agentic at ~40% of the price — the candidate third rung for the post-7-July
// model economics); descent to Fable→Opus so a drop mid-night self-heals, and DEC-092's
// observed-model stamp keeps any fallback legible in the data.
const SONNET_LADDER: ModelLadder = ['sonnet', 'fable', 'opus', 'haiku']; // explicit (a FABLE_LADDER spread would duplicate 'sonnet' mid-tail)

// STEM_WARM_LADDER (DEC-101 warm-map/serve-map split — MNT-054; sonnet[1m] head 2026-08-19,
// Darron's ruling, superseding his own 2026-08-11 haiku head): the model a pool stem is
// PRE-WARMED on, decoupled from the model its surface SERVES, then cast to the surface's serve
// model at checkout. WHY the 1M head (DEC-108): the haiku head's 200K window could not hold a
// full session wake — the 2026-08-19 incident: leo's stem COMPACTED mid-wake and the first
// warm-checkout seat arrived as a summary of itself; the two-phase split (phase-1-on-haiku,
// ceiling-gated) could not cure the class either, because the ceiling checks BEFORE each step
// and a single oversized store (jim's felt-moments, same night) blows the window from inside
// one step. The 1M window makes wake-compaction unrepresentable; the ~3× warmth cost is
// accepted by the ruling (cost is not a design consideration). The session-surface
// stemTwoPhaseWake flags were flipped OFF the same night — full wake at warm, #91 attach-flush
// carries the deltas at checkout. TAIL CAVEAT (named, not hidden): the descent rungs are 200K
// models — a 1M-drop descent can re-create the compaction class; the descent exists for
// liveness on a dead head, and a descended warm should be treated as suspect. A warm load
// still never touches Fable (the MNT-042 depletion trap that made human-response prewarm
// hang-loop). All pools warm here — one warm-map. DEC-104: 'sonnet[1m]' is a bare family
// alias + window variant, no version literal; it floats to the family head.
// NB (Jim G-audit must-fix, standing): never spread another ladder here — the old
// `['sonnet', ...OPUS_LADDER]` silently expanded to sonnet→opus→SONNET→haiku (the msgp3tan
// duplicate-spread bug, confirmed 2026-08-11); an explicit literal is the only honest form.
const STEM_WARM_LADDER: ModelLadder = ['sonnet[1m]', 'sonnet', 'opus']; // explicit, no spread; never Fable

// Interactive CLI sessions take their model from the launcher at spawn (the
// launchers don't pin one today). Recorded here so the DEC-092 slicer stamp matches reality.
const CLI_LAUNCH_DEFAULT: ModelLadder = ['fable']; // ⏩ Fable restored 2026-07-03 (S213); alias per DEC-104

/** P1 (S218): the engine-owned ladder REGISTRY — the garden config names ladders (`ladder:
 *  "FABLE_LADDER"`); the engine owns their CONTENTS (model economics stay engine-updatable for
 *  every garden). The loader resolves names through this and FAILS LOUD on an unknown name. */
export const LADDER_REGISTRY: Record<string, ModelLadder> = {
    OPUS_LADDER, FABLE_LADDER, SONNET_LADDER, CLI_LAUNCH_DEFAULT, STEM_WARM_LADDER,
};

/**
 * P1 — THE EXTRACTION (S218; F2 of the update pipeline, thread mqz3wev0). The garden's values
 * no longer compile into the engine: they live in `$HAN_HOME/garden-manifest.json` (the garden's
 * OWN config — the cloth), written by scripts/export-garden-manifest.ts and instantiated for new
 * gardens from seeds/garden-manifest.seed.json. The engine keeps the SCHEMA (the interfaces
 * above), the LADDER_REGISTRY (name → models; economics stay engine-updatable), this LOADER
 * (fail-loud validation; boot-read, cached — Q1's read-model kept, its in-repo-location half
 * superseded per the declared flag in plans/live-garden-update-plan.md), and every accessor
 * below with its signature unchanged.
 *
 * Config-merge on update IS the defaults-union: absent optional fields resolve at the accessor
 * layer exactly as before (`?? default`) — no merge tool exists, by construction.
 */
function loadGardenConfig(): { manifest: GardenManifest; allocations: Record<string, { memoryDirRel: string }> } {
    const file = join(hanHome(), 'garden-manifest.json');
    let raw: string;
    try {
        raw = readFileSync(file, 'utf8');
    } catch (e) {
        throw new Error(`garden-manifest: cannot read ${file} — a garden must carry its own config `
            + `(genesis instantiates seeds/garden-manifest.seed.json; ours is written by `
            + `scripts/export-garden-manifest.ts). Root cause: ${(e as Error).message}`);
    }
    let cfg: any;
    try { cfg = JSON.parse(raw); } catch (e) {
        throw new Error(`garden-manifest: ${file} is not valid JSON — ${(e as Error).message}`);
    }
    // fail-loud structural validation (no zod dep — explicit checks, the house style)
    const fail = (msg: string): never => { throw new Error(`garden-manifest: ${file}: ${msg}`); };
    if (typeof cfg.manifestVersion !== 'number') fail('manifestVersion (number) is required');
    for (const k of ['spokeLifecycle', 'project', 'user'] as const) {
        if (!cfg[k] || typeof cfg[k] !== 'object') fail(`${k} (object) is required`);
    }
    for (const k of ['ctxClearThresholdPct', 'warmFloorPct', 'maxWarmNudges'] as const) {
        if (typeof cfg.spokeLifecycle[k] !== 'number') fail(`spokeLifecycle.${k} (number) is required`);
    }
    if (!Array.isArray(cfg.agents) || cfg.agents.length === 0) fail('agents (non-empty array) is required');
    const agents: AgentManifest[] = cfg.agents.map((a: any) => {
        if (!a.slug || typeof a.slug !== 'string') fail('every agent needs a slug (string)');
        if (!a.displayName) fail(`agent '${a.slug}': displayName is required`);
        if (typeof a.active !== 'boolean') fail(`agent '${a.slug}': active (boolean) is required`);
        if (!Array.isArray(a.surfaces)) fail(`agent '${a.slug}': surfaces (array) is required`);
        const surfaces: SurfaceManifest[] = a.surfaces.map((s: any) => {
            if (!s.name) fail(`agent '${a.slug}': every surface needs a name`);
            if (typeof s.enabled !== 'boolean') fail(`surface '${a.slug}/${s.name}': enabled (boolean) is required`);
            if (s.transport !== 'cli' && s.transport !== 'sdk' && s.transport !== 'tmux') {
                fail(`surface '${a.slug}/${s.name}': transport must be cli|sdk|tmux (got '${s.transport}')`);
            }
            // ladders-by-NAME (Jim's crux-2): the garden names it; the engine owns the contents.
            // FAIL-LOUD on an unknown name — a config/engine mismatch surfaces, never papers over.
            const ladder = LADDER_REGISTRY[s.ladder as string];
            if (!ladder) {
                fail(`surface '${a.slug}/${s.name}': unknown ladder name '${s.ladder}' — engine knows: `
                    + Object.keys(LADDER_REGISTRY).join(', '));
            }
            const { ladder: _name, ...rest } = s;
            return { ...rest, model: ladder } as SurfaceManifest;
        });
        return { ...a, surfaces } as AgentManifest;
    });
    const allocations = (cfg.allocations && typeof cfg.allocations === 'object') ? cfg.allocations : {};
    for (const [slug, al] of Object.entries<any>(allocations)) {
        if (typeof al?.memoryDirRel !== 'string') fail(`allocations['${slug}'].memoryDirRel (string; '' = $HAN_HOME itself) is required`);
    }
    // Optional update-channel section (2b): validate shape iff present; absence is the default.
    if (cfg.update !== undefined) {
        if (typeof cfg.update !== 'object' || cfg.update === null) fail('update (object) must be an object when present');
        if (cfg.update.enforceFreshnessExpiry !== undefined && typeof cfg.update.enforceFreshnessExpiry !== 'boolean') fail('update.enforceFreshnessExpiry must be a boolean');
        if (cfg.update.freshnessMaxAgeDays !== undefined && typeof cfg.update.freshnessMaxAgeDays !== 'number') fail('update.freshnessMaxAgeDays must be a number');
    }
    // Optional timezone leaf (DEC-105): validate shape iff present; absence = UTC-with-honest-label.
    if (cfg.timezone !== undefined && typeof cfg.timezone !== 'string') fail('timezone must be an IANA zone string when present');
    const manifest: GardenManifest = {
        manifestVersion: cfg.manifestVersion,
        spokeLifecycle: cfg.spokeLifecycle,
        project: cfg.project,
        user: cfg.user,
        agents,
        ...(cfg.update !== undefined ? { update: cfg.update as UpdateConfig } : {}),
        ...(cfg.timezone !== undefined ? { timezone: cfg.timezone as string } : {}),
    };
    return { manifest, allocations };
}

const _gardenConfig = loadGardenConfig(); // boot-read, cached (Q1's read model, kept)

export const GARDEN_MANIFEST: GardenManifest = _gardenConfig.manifest;

/** 2b: the update-channel calibration, defaults baked `{false, 90}` (an absent section is
 *  the advisory-only safe default — fail-closed on ABSENCE, Tenshi F). The self-lockout
 *  guard (SEC-07 family): arming expiry with a non-positive max-age would make EVERY
 *  freshness expired — refuse loudly rather than let a garden brick its own update channel. */
export function updateConfig(): { enforceFreshnessExpiry: boolean; freshnessMaxAgeDays: number } {
    const u = GARDEN_MANIFEST.update ?? {};
    const out = {
        enforceFreshnessExpiry: u.enforceFreshnessExpiry ?? false,
        freshnessMaxAgeDays: u.freshnessMaxAgeDays ?? 90,
    };
    if (out.enforceFreshnessExpiry && out.freshnessMaxAgeDays <= 0) {
        throw new Error(`garden-manifest: update.enforceFreshnessExpiry=true with freshnessMaxAgeDays=${out.freshnessMaxAgeDays} `
            + `would expire EVERY freshness (self-lockout) — set a positive max-age or disarm the flag`);
    }
    return out;
}

/** DEC-105: the garden's timezone, resolved — always a usable IANA zone string ('UTC' when the
 *  garden hasn't set one). Local time is a DISPLAY PROJECTION of UTC only (Tenshi's invariant):
 *  never persisted, compared, or fed back into the machine layer. Renders that want to say
 *  honestly whether the garden actually declared a zone pair this with gardenTimezoneConfigured(). */
export function gardenTimezone(): string {
    return GARDEN_MANIFEST.timezone ?? 'UTC';
}

/** DEC-105: whether the garden DECLARED a timezone (false = the UTC default is a fallback the
 *  render layer should label honestly, not a chosen zone). */
export function gardenTimezoneConfigured(): boolean {
    return GARDEN_MANIFEST.timezone !== undefined;
}

/**
 * The garden's resident roster — the single seam through which the population is *sourced*.
 *
 * **P0 (#98 Dynamic Residence): a zero-behaviour no-op** returning the static
 * `GARDEN_MANIFEST.agents` seed in declared order. It exists so that discovery (P1: signed
 * `resident.json` fragments under `~/.han/agents/*`) plugs in *here, once*, and every roster
 * **enumerator** (`schedulingAgents`, `conversationRolesExcept`, `humanResponderPeers`) sees the
 * discovered population for free — the external readers are already population-agnostic.
 *
 * ⚠ **Order is load-bearing.** `schedulingAgents()` derives the N-body antiphase index from array
 * position (`{leo:0, jim:1}`), so this MUST preserve manifest declaration order exactly — a reorder
 * silently breaks the 180° cycle antiphase. P0 returns the seed array as-is.
 *
 * Scope note (F4, decided 2026-06-24): this is the **roster/identity** seam. Per-surface **policy**
 * lookups (model ladder, transport, `runsSupervisorCycle`) are deliberately NOT routed here — they
 * belong to the operator-authored **allocation** source (P3), keeping identity-discovered separate
 * from privilege-allocated. The by-slug *identity* lookups route through this seam in P1, when
 * discovery lands.
 *
 * **P4b-ii — the activation flip (the LAST #98 brick).** `loadResidents = seed ∪ activatedNetNew()`.
 * A net-new resident joins the ACTIVE roster — surfaced to every consumer, R1 lifted
 * (`AGENT_GRADIENT_CONFIG = loadResidents().map(...)`, so `gradientConfigForAgent` stops throwing) —
 * iff it passes ALL FOUR lifecycle gates: discovered (P1) ∧ admitted (P2) ∧ allocated (`allocationFor`)
 * ∧ seeded (a garden-signed identity-manifest over its genesis files, intact — `isSeededAt`). Until all
 * four hold it stays inert: the never-wakeable mind is structurally impossible.
 *
 * **Process-stable (Jim's Fork 2).** The union is computed ONCE per process. `AGENT_GRADIENT_CONFIG`
 * snapshots `loadResidents()` at agent-registry's module-eval, while `agent-scheduler` reads it live —
 * a live re-scan could surface a mid-process-seeded resident to the scheduler but not the config
 * snapshot → `gradientConfigForAgent` throws on a scheduled slug. Memoizing makes every consumer see one
 * stable roster for the process's life; a newly-seeded resident activates on the next restart (the
 * deploy bounce — the established activation trigger, identical to how the seed roster itself loads).
 *
 * **Note (Jim):** because `AGENT_GRADIENT_CONFIG`'s eval calls `loadResidents()`, the seeded-check's
 * filesystem reads (manifest + identity files) now run at module-eval — acceptable, consistent with
 * P1's discovery fs reads, bounded (a handful of residents). The check uses ONLY the config-independent
 * leaf — no path back to agent-registry, so no import cycle.
 *
 * ⚠ **Order is load-bearing.** `schedulingAgents()` derives the N-body antiphase index from array
 * position, so the SEED agents keep their declaration order (they come first, unchanged); net-new
 * residents append after, in discovery order.
 */
const SEED_SLUGS = new Set(GARDEN_MANIFEST.agents.map((a) => a.slug));

/** Map a fully-qualified net-new resident (its discovered identity fragment + its operator allocation)
 *  to an `AgentManifest`. The IDENTITY half comes from the fragment (slug/displayName/pronounObj/
 *  identitySection); the PRIVILEGE half (surfaces/memoryDir/port/runsSupervisorCycle) from the
 *  allocation — never self-claimed (the F4 line). `conversationRole` defaults to the slug. */
function fragmentToManifest(f: ResidentFragment, alloc: AgentAllocation): AgentManifest {
    return {
        slug: f.slug,
        displayName: f.displayName,
        pronounObj: f.pronounObj,
        identitySection: f.identitySection,
        active: true,
        surfaces: alloc.surfaces,
        memoryDir: alloc.memoryDir,
        port: alloc.port,
        runsSupervisorCycle: alloc.runsSupervisorCycle,
    };
}

/** The net-new residents that pass all four lifecycle gates (the seed roster is excluded — it is active
 *  by construction). `fractalDir` is uniform `memory/fractal/<slug>`, matching
 *  `agent-registry.deriveGradientConfig`. */
function activatedNetNew(): AgentManifest[] {
    const out: AgentManifest[] = [];
    const admitted = new Set(admittedResidents().map((f) => f.slug)); // discovered ∧ admitted (P2)
    for (const f of discoveredResidents()) {
        if (SEED_SLUGS.has(f.slug)) continue;            // the seed roster is already active
        if (!admitted.has(f.slug)) continue;             // admitted (garden-signed AND unchanged)
        const alloc = allocationFor(f.slug);
        if (!alloc?.memoryDir) continue;                 // allocated (operator-granted privilege)
        const fractalDir = join(MEMORY_ROOT, 'fractal', f.slug);
        if (!isSeededAt(alloc.memoryDir, fractalDir)) continue; // seeded (genesis manifest intact)
        out.push(fragmentToManifest(f, alloc));
    }
    return out;
}

let _activeResidents: AgentManifest[] | null = null;

export function loadResidents(): AgentManifest[] {
    if (_activeResidents === null) {
        _activeResidents = [...GARDEN_MANIFEST.agents, ...activatedNetNew()];
    }
    return _activeResidents;
}

/** Test-only: drop the memoized active-resident roster so the next `loadResidents()` recomputes the
 *  seed ∪ activation union. Production never calls this (the roster is process-stable — a newly-seeded
 *  resident activates on restart); the synthetic-resident lifecycle test uses it to re-evaluate the
 *  gates after staging/removing fixtures within one process. */
export function __resetResidentCacheForTests(): void {
    _activeResidents = null;
}

/**
 * The PRIVILEGE/POLICY half of an agent — the *allocated* fields, separate from the *discovered*
 * identity roster. Per-surface model ladder + transport, the server port, and whether the agent
 * runs the supervisor cycle. (`memoryDir` joins at P4 with the registry collapse — R2.)
 */
export interface AgentAllocation {
    /** Per-surface model ladder + transport — the dispatcher's per-surface policy, keyed by
     *  surface `name`. (`allocationFor` returns the manifest agent's `surfaces` array by reference
     *  in the P3 no-op, so order + identity are preserved; the accessors `.find` by name.) */
    surfaces: SurfaceManifest[];
    /** Whether this agent's server runs the supervisor cycle (`initSupervisor` + scheduler). */
    runsSupervisorCycle?: boolean;
    /** MNT-030: whether this agent's server runs the Jemma ORCHESTRATOR (dispatch + ack-drain).
     *  Exactly one server should — two orchestrators race the shared signals dir (the ack-flood
     *  + the eaten-heartbeat premature force-close). The DEC-081 twin of runsSupervisorCycle. */
    runsOrchestrator?: boolean;
    /** The agent's individual server port. C-P3a (Jim's P3 plan-audit, 2026-06-24): `port` is a
     *  policy field but its one CONSUMER (`agentTemplateVars` → `AGENT_PORT`, agent-template-vars.ts)
     *  reads it directly from the roster, not via an accessor — so it is DECLARED here now as the
     *  foundation, but its consumer migrates to this allocation source with the separate
     *  operator-authored allocation STRUCTURE at P4 (alongside `memoryDir`/R2). Until then `port`
     *  stays roster-sourced (zero behaviour). */
    port?: number;
    /** The agent's memory directory — R2 (P4b-i). The **operator-allocated** home for per-resident
     *  memory, kept in the privilege half (never the self-declared identity half) so per-resident
     *  memory access-control is tractable (Darron, 2026-06-24). jim is root-special (`~/.han/memory`,
     *  the #91 path); everyone else is `~/.han/memory/<slug>`. Migrated here from the agent-registry
     *  `GRADIENT_OVERRIDES`; `gradientConfigForAgent(slug).memoryDir` stays the stable accessor that
     *  sources from here (all 7 consumers untouched — incl. the seeded-gate at identity-signing.ts). */
    memoryDir?: string;
}

/**
 * The **allocation/policy seam** (P3, #98 Dynamic Residence — the F4 line at the data layer).
 *
 * **P3: a zero-behaviour no-op** — derives the allocation from the static `GARDEN_MANIFEST.agents`
 * seed (today's policy fields), so the four policy accessors below (`manifestModelHead`,
 * `manifestModelLadder`, `manifestTransport`, `runsSupervisorCycle`) return byte-identical data.
 * It exists so an operator-authored allocation source plugs in *here, once* (P3-F1: the separate
 * structure lands by P4 — the shape that lets a fork ship "empty roster + example allocation").
 *
 * **Why this is its own source (the F4 line — identity-source ≠ policy-source):** privilege must
 * NOT flow from the discovered identity roster — a resident describes *who it is* (`resident.json`),
 * never *what it's allowed* (port/model/transport/supervisor-cycle). Routing the policy accessors
 * through this seam (instead of the roster) makes **no-auto-privilege structural**, not a hopeful
 * discovery-time filter. It is also the **foundation for memory sovereignty** (Darron, 2026-06-24):
 * keeping memory-location (P4's `memoryDir`/R2) in the operator-allocated half — never the
 * self-declared identity half — is the hook that makes per-resident memory access-control tractable.
 *
 * Returns `undefined` for an unknown slug (the accessors fall back exactly as before — null/[]/false).
 */
const MEMORY_ROOT = join(hanHome(), 'memory');

/** The roster-sourced policy half for `slug` (surfaces/runsSupervisorCycle/port) — single-sourced from
 *  the manifest so there's no dual-source drift. The ALLOCATION table layers `memoryDir` (R2) on top. */
function allocationFromRoster(slug: string): Omit<AgentAllocation, 'memoryDir'> {
    const a = GARDEN_MANIFEST.agents.find((x) => x.slug === slug);
    return { surfaces: a?.surfaces ?? [], runsSupervisorCycle: a?.runsSupervisorCycle, runsOrchestrator: a?.runsOrchestrator, port: a?.port };
}

/**
 * The operator-authored **ALLOCATION table** (P4b-i — the F4 memory-sovereignty source). Privilege is
 * ALLOCATED here, explicitly, not discovered: a resident present in the roster but ABSENT from this
 * table gets `allocationFor → undefined → no privilege` (the no-auto-privilege gate). The keys are the
 * operator's grant list; a fork ships an empty roster + edits these example entries. `memoryDir` (R2)
 * is the relocated allocated field — jim's root-special path is jim's explicit value here (no `=== 'jim'`
 * branch). `surfaces`/`runsSupervisorCycle`/`port` reference the roster for now (single-source; the full
 * literal-relocation of those is a flagged follow-on — P4b-i's load-bearing job is the seam + R2 + C-P3a,
 * byte-identical). Zero-behaviour: every returned field matches the P3 no-op + the old memoryDir source.
 */
// P1 (S218): the ALLOCATION table's operator-granted half (`memoryDirRel`) now comes from the
// garden config's `allocations` map — jim's root-special path is the explicit rel 'memory'
// (→ join(hanHome(),'memory')); everyone else 'memory/<slug>'. No slug branch anywhere. The
// roster-derived half (surfaces/runsSupervisorCycle/port) stays derived — single-source, unchanged.
const AGENT_ALLOCATION: Record<string, AgentAllocation> = Object.fromEntries(
    Object.entries(_gardenConfig.allocations).map(([slug, al]) => [
        slug,
        { ...allocationFromRoster(slug), memoryDir: join(hanHome(), al.memoryDirRel) },
    ]),
);

export function allocationFor(slug: string): AgentAllocation | undefined {
    return AGENT_ALLOCATION[slug];
}

/** Test-only: register/drop an allocation for a synthetic slug, so the P4b-ii synthetic-resident
 *  lifecycle test can exercise the allocate→seed→activate path without editing the operator-authored
 *  AGENT_ALLOCATION literal. These MUTATE the table directly (so `activatedNetNew`'s live `allocationFor`
 *  sees it) and are paired with `__resetResidentCacheForTests`; production never calls them, and
 *  `allocationFor` itself is byte-unchanged. The test deletes its entry on teardown. */
export function __setTestAllocationForTests(slug: string, alloc: AgentAllocation): void {
    AGENT_ALLOCATION[slug] = alloc;
}
export function __deleteTestAllocationForTests(slug: string): void {
    delete AGENT_ALLOCATION[slug];
}

/**
 * The resolved spoke-lifecycle thresholds for a (slug, surface) — the garden-wide defaults
 * (`GARDEN_MANIFEST.spokeLifecycle`) merged with any per-`SurfaceManifest.lifecycle` override.
 * The single source `dispatchToSpoke` reads (no code-constant thresholds — Darron's principle).
 * Unknown slug/surface → the garden defaults (a fail-safe: a spoke always has lifecycle knobs).
 */
export function spokeLifecycleFor(slug: string, surface: string): SpokeLifecycle {
    const base = GARDEN_MANIFEST.spokeLifecycle;
    const s = GARDEN_MANIFEST.agents.find(a => a.slug === slug)?.surfaces.find(x => x.name === surface);
    return { ...base, ...(s?.lifecycle ?? {}) };
}

/** DEC-101: is the persist-as-spoke lifecycle enabled for this surface? Default OFF (safe rollout). */
export function spokePersistFor(slug: string, surface: string): boolean {
    return spokeLifecycleFor(slug, surface).spokePersist ?? false;
}

/** DEC-101: the ctx% at which a bound spoke is reaped at idle. Registry leaf; default 92. */
export function ctxReapThresholdFor(slug: string, surface: string): number {
    return spokeLifecycleFor(slug, surface).ctxReapThresholdPct ?? 92;
}

/** DEC-103 §3 (MNT-055): minutes before a running pre-warm posts its ntfy surfacing alert.
 *  Registry leaf; default 12 (~2× measured p95 — see the SpokeLifecycle field's pricing). */
export function prewarmAlertMinsFor(slug: string, surface: string): number {
    return spokeLifecycleFor(slug, surface).prewarmAlertMins ?? 12;
}

/** MNT-060 F3: the swap-flush backlog-guard ceiling (bytes) for a seat. Registry leaf; default
 *  20000 (see the SpokeLifecycle field's pricing). Surface defaults to 'session' — the seat the
 *  Stop-hook flush serves; per-surface overrides ride the standard lifecycle merge. */
export function swapFlushMaxBytesFor(slug: string, surface: string = 'session'): number {
    return spokeLifecycleFor(slug, surface).swapFlushMaxBytes ?? 20000;
}

/** MNT-070 (JA2): minutes a resumable-marked vessel may wait unclaimed before the TTL retire. Default 30. */
export function resumableTtlMinutesFor(slug: string, surface: string): number {
    return spokeLifecycleFor(slug, surface).resumableTtlMinutes ?? 30;
}

/** MNT-061: hours a bound spoke may sit unserved before the idle sweep decouples it. Default 48. */
export function spokeIdleReapHoursFor(slug: string, surface: string): number {
    return spokeLifecycleFor(slug, surface).spokeIdleReapHours ?? 48;
}

/** MNT-061: the re-thread ceiling (ctx %) — recycle-vs-reap at decouple; new-thread eligibility. Default 70. */
export function spokeRethreadCtxCeilingFor(slug: string, surface: string): number {
    return spokeLifecycleFor(slug, surface).spokeRethreadCtxCeilingPct ?? 70;
}

/** MNT-061: the fit ceiling (ctx %) — `stem_ctx + burden ≤ this` assigns a thread to a recycled stem. Default 80. */
export function spokeFitCeilingFor(slug: string, surface: string): number {
    return spokeLifecycleFor(slug, surface).spokeFitCeilingPct ?? 80;
}

/** Phase A (2026-08-11): is the two-phase stem wake ON for this (slug, surface)? Default OFF —
 *  the flag flips only after the B5 gates pass; flipping back IS the rollback (config, not revert). */
export function stemTwoPhaseWakeFor(slug: string, surface: string): boolean {
    return spokeLifecycleFor(slug, surface).stemTwoPhaseWake === true;
}

/** Phase A: the phase-1 feed ceiling (% of the WARM model's window). Default 85. */
export function stemPhase1CeilingPctFor(slug: string, surface: string): number {
    return spokeLifecycleFor(slug, surface).stemPhase1CeilingPct ?? 85;
}

/** #107 Phase-2 P2.1b: does this (slug, surface) wake via the feeder (the wake-feed queue)?
 *  Registry-gated roll-out (no-hidden-globals) — true only where the manifest sets `wakeFeed`. */
export function wakeFeedFor(slug: string, surface: string): boolean {
    return GARDEN_MANIFEST.agents.find(a => a.slug === slug)?.surfaces.find(x => x.name === surface)?.wakeFeed === true;
}

/** MNT-009 / DEC-099 R3: the warm-stem pool size for (slug, surface) — doubles as the
 *  controller's max-concurrent-dispatch bound (one leaf, both readers, can't drift). 0 = unpooled /
 *  one-at-a-time (the semaphore floor). Agent-agnostic (DEC-081). */
/** P2 (compressor migration): is this (slug, surface) ENABLED in the manifest? The compression
 *  transport gate reads it — enabled:false ⇒ the SDK path (today), enabled:true ⇒ the warm tmux
 *  spoke. One-line rollback = the flag. Agent-agnostic (DEC-081). */
export function surfaceEnabledFor(slug: string, surface: string): boolean {
    return GARDEN_MANIFEST.agents.find(a => a.slug === slug)?.surfaces.find(x => x.name === surface)?.enabled === true;
}

export function poolSizeFor(slug: string, surface: string): number {
    const n = GARDEN_MANIFEST.agents.find(a => a.slug === slug)?.surfaces.find(x => x.name === surface)?.poolSize;
    return typeof n === 'number' && n > 0 ? Math.floor(n) : 0;
}

/**
 * Shared (non-agent-scoped) surface ladders. EMPTY since P3 of the compressor
 * migration (2026-07-04, S216): the `compression` entry — the old SDK-child era's
 * shared ladder — was found to SHADOW the per-agent compression leaves in
 * manifestModelHead/manifestModelLadder (the shared branch resolves FIRST), so the
 * P2 warm spoke launched and descended on a single-rung Opus ladder instead of the
 * FABLE_LADDER its manifest leaf declares. Retired with runSDK; compression now
 * resolves per-agent like every other surface (DEC-081 — one path, many agents).
 * The mechanism (and the shared-first resolution order) is kept for a future
 * genuinely-shared surface; an entry that duplicates a per-agent surface name is
 * the prohibited move (it silently shadows the agent's leaf).
 */
export const SHARED_SURFACES: Record<string, ModelLadder> = {};

/**
 * Interim head-read resolver (DEC-092, S169) — returns the HEAD (active / most-
 * capable) model of a surface's ladder, for an agent surface or a shared surface
 * (e.g. 'compression'). NULL if unknown. This is the configured model; callers
 * that have the actually-served model (from an in-process agentQuery result)
 * prefer it (it captures Fable 5's <5% safeguard fallback to Opus). Superseded
 * by #6 Phase-1's full `surfaceModel(slug, surface)` resolver when it lands.
 */
export function manifestModelHead(slug: string, surface: string): string | null {
    const shared = SHARED_SURFACES[surface];
    if (shared && shared.length) return shared[0];
    const s = allocationFor(slug)?.surfaces.find(x => x.name === surface);
    return s?.model?.[0] ?? null;
}

/**
 * The FULL model ladder for a surface (manifestModelHead returns only the head, rung 0).
 * The dispatcher's model-failover descent walks this: on a model-unavailable launch it
 * sends in-session `/model <next rung>` (S173 — Fable's free-window access dropped mid-trial
 * 2026-06-13 and the autonomous spoke couldn't self-heal off the dead head; the ladder data
 * already existed in the manifest but nothing descended it). Returns [] if agent/surface unknown.
 */
export function manifestModelLadder(slug: string, surface: string): string[] {
    const shared = SHARED_SURFACES[surface];
    if (shared && shared.length) return [...shared];
    const s = allocationFor(slug)?.surfaces.find(x => x.name === surface);
    return s?.model ? [...s.model] : [];
}

/**
 * DEC-101 warm-map (MNT-054): the ladder a pool stem is PRE-WARMED on — sonnet-headed, decoupled
 * from `manifestModelLadder` (the SERVE ladder). One warm-map for all pools today; kept a per-
 * (slug,surface) accessor so a future garden can vary it without touching callers. Used by
 * `scripts/prewarm-stem.ts`; the serve model is cast on at checkout.
 */
export function stemWarmLadder(_slug: string, _surface: string): string[] {
    return [...STEM_WARM_LADDER];
}

/**
 * DEC-101 serve-map (MNT-054): the model a checked-out stem should SERVE on for this surface —
 * the head (rung 0) of the surface's `manifestModelLadder`. The stem is warmed on the warm-map
 * (sonnet) and cast to THIS at checkout; the full serve ladder is the descent tail if the cast
 * hits a dead/depleted serve model. `null` when the surface has no configured ladder (a shared
 * surface with no model, or unknown) — the caller then skips the cast (serve == warm).
 */
export function serveModelFor(slug: string, surface: string): string | null {
    return manifestModelLadder(slug, surface)[0] ?? null;
}

/**
 * Transport read-path (DEC-093 thaw, 2026-06-12) — the per-surface feature flag.
 * A surface's handler routes its dispatch on this value: 'tmux' → the warm-session
 * tmux dispatcher; 'sdk' → the in-process agentQuery path (kept for rollback).
 * Rollback for a thawed surface is a one-line manifest flip back to 'sdk'.
 * NULL if the surface is unknown — callers treat null as 'sdk' (fail-safe to the
 * established path, never to an unlaunched tmux session).
 */
export function manifestTransport(slug: string, surface: string): SurfaceTransport | null {
    const s = allocationFor(slug)?.surfaces.find(x => x.name === surface);
    return s?.transport ?? null;
}

/**
 * The conversation roles of every manifest agent EXCEPT `selfSlug` — each agent's
 * `conversationRole`, defaulting to its slug. Lets a responder scan derive its peer-role
 * set from the registry (a new agent participates the moment it's in the manifest, no data
 * step). NOTE: `'human'` is NOT an agent conversationRole — callers must keep it explicit.
 * (Project-b Phase 1, agnosticism scour — DEC-081.)
 */
export function conversationRolesExcept(selfSlug: string): string[] {
    return loadResidents()
        .filter(a => a.slug !== selfSlug)
        .map(a => a.conversationRole ?? a.slug);
}

/**
 * Display name for a conversation role: `'human'` → `'Darron'`; else the manifest agent whose
 * role (`conversationRole ?? slug`) matches → its `displayName`; fallback = the role capitalised.
 * Replaces the 2-valued `sender_role==='leo'?'Leo':'Darron'` ternary (a tenshi post must render
 * 'Tenshi', not 'Darron'). (Project-b Phase 1 — DEC-081.)
 */
export function displayNameForRole(role: string): string {
    if (role === 'human') {
        // Ring 2 (H1, the gardener class): the human's name comes from the manifest's
        // gardener leaf via the envelope seam — NEVER the literal that made every
        // gardener render as "Darron" on a travelled garden (Casey's scour find).
        // gardener ?? user ?? throw lives in the resolver; on a mid-transition
        // manifest the legacy user block serves (announce-once). Fail-soft here
        // ONLY for display (a render label, not cognition): a nameless garden
        // shows the role, it never borrows a name.
        try {
            // Lazy import — a static import would close the cycle garden-manifest →
            // cognition-envelope → agent-registry → garden-manifest (the loadResidents
            // seam the Residence build made structurally acyclic; keep it that way).
            const { verifiedCognitionLeaf } = require('./cognition-envelope');
            return verifiedCognitionLeaf('gardener.name');
        } catch {
            return 'Human';
        }
    }
    const agent = GARDEN_MANIFEST.agents.find(a => (a.conversationRole ?? a.slug) === role);
    return agent?.displayName ?? (role.charAt(0).toUpperCase() + role.slice(1));
}

/** The community-convergence port (Ring 2 leaf) — ALL conversation reads/writes and
 *  UI/WS traffic converge on ONE server so the admin stays real-time-coherent
 *  (the settled S166-era design). Was a scattered literal in six files; now the
 *  manifest's `communityPort`, defaulting 3847 only for a manifest that predates
 *  the leaf. */
export function communityPort(): number {
    return (GARDEN_MANIFEST as any).communityPort ?? 3847;
}

/** The SINGULAR incumbent gardener's persona key (Ring 2, H4 write-sites — a write
 *  stamps a specific author and needs the incumbent, never the historical set;
 *  Tenshi's read/write split). gardener ?? legacy-'darron' during transition. */
export function gardenerPersonaKey(): string {
    return (GARDEN_MANIFEST as any).gardener?.personaKey ?? 'darron';
}

/** The conversation role for an agent slug — manifest `conversationRole`, defaulting to the slug
 *  (jim→'supervisor', leo→'leo'). (Project-b Phase 1 — DEC-081.) */
export function conversationRoleFor(slug: string): string {
    const agent = GARDEN_MANIFEST.agents.find(a => a.slug === slug);
    return agent?.conversationRole ?? slug;
}

/** The agent slug for a conversation role — the reverse of `conversationRoleFor`. Matches the
 *  manifest `conversationRole` (jim's is 'supervisor') OR the slug itself (leo→leo, tenshi→tenshi);
 *  returns null for non-agent roles (human, system, discord). Registry-derived replacement for the
 *  hardcoded `supervisor→jim` alias + the gradient-config slug-set. (Project-b Phase 1 — DEC-081.)
 *  ⚠ An agent must have a manifest entry to participate in conversations — an agent present only in
 *  AGENT_GRADIENT_CONFIG (e.g. casey) resolves to null here (correct: it has no conversation surface). */
export function slugForConversationRole(role: string): string | null {
    const agent = GARDEN_MANIFEST.agents.find(a => a.conversationRole === role || a.slug === role);
    return agent?.slug ?? null;
}

/** The standing shared conversation-thread id between `slug` and `peerSlug` — manifest
 *  `peerConversations[peerSlug]`, or null if none declared. Registry-derived replacement for
 *  the hardcoded JIM_CONVERSATION_ID literal in leo-heartbeat. (Project-b Phase 2 — DEC-081.) */
export function peerConversationFor(slug: string, peerSlug: string): string | null {
    const agent = GARDEN_MANIFEST.agents.find(a => a.slug === slug);
    return agent?.peerConversations?.[peerSlug] ?? null;
}

/**
 * Whether the server for `slug` should run the supervisor cycle (`initSupervisor` + scheduler).
 * Manifest capability flag, defaulting to FALSE — an unset/unknown slug never runs it, so
 * server.ts's `else`-branch "not started" log still fires. Replaces the hardcoded
 * `AGENT_SLUG === 'jim'` bootstrap gate (the PR-T7b double-fork fix) with a registry leaf.
 * ⚠ Today ONLY `jim` returns true — see the warning on `AgentManifest.runsSupervisorCycle`
 * (supervisor-worker.ts is jim-hardcoded until Phase 3). (Project-b Phase 1 — DEC-081.)
 */
export function runsSupervisorCycle(slug: string | undefined): boolean {
    if (!slug) return false;
    return allocationFor(slug)?.runsSupervisorCycle ?? false;
}

/** MNT-030 (S218): does this agent's server run the Jemma ORCHESTRATOR (dispatch + ack-drain)?
 *  The exact DEC-081 twin of `runsSupervisorCycle` — one server owns the shared signals dir;
 *  a second orchestrator races it (the ack-flood + the eaten-heartbeat premature force-close,
 *  journal MNT-030). Unset/unknown slug → false. */
export function runsOrchestrator(slug: string | undefined): boolean {
    if (!slug) return false;
    return allocationFor(slug)?.runsOrchestrator ?? false;
}

/**
 * The human-responder STAND-DOWN peer list for `selfSlug` (comma-joined). Every agent that has a
 * `human-response` surface contributes its seats — `session-<DisplayName>` + `<slug>-human` — EXCEPT
 * the self human-seat (`<self>-human`); the self `session-<Name>` stays (the interactive self may
 * answer first). Self listed first, then peers. Registry-derived, so a new conversation agent joins
 * every stand-down list the moment it has a manifest `human-response` surface — closing the
 * agent-#3 duplicate-post hole (F2). An agent with no conversation seat (e.g. tenshi) is excluded.
 * (Project-b Phase 1 — DEC-081.)
 */
export function humanResponderPeers(selfSlug: string): string {
    const responders = loadResidents().filter(a => a.surfaces.some(s => s.name === 'human-response'));
    const self = responders.find(a => a.slug === selfSlug);
    const peers = responders.filter(a => a.slug !== selfSlug);
    const seats: string[] = [];
    if (self) seats.push(`session-${self.displayName}`);
    for (const p of peers) seats.push(`session-${p.displayName}`, `${p.slug}-human`);
    return seats.join(', ');
}

/** The `human-response` SurfaceManifest for `slug` (or undefined). The single seam the human-responder
 *  capability/timeout leaves read — mirrors `spokeLifecycleFor`'s direct surface lookup (these are
 *  spoke-dispatch surface knobs, co-located with `lifecycle`, not policy routed via `allocationFor`). */
function humanResponseSurface(slug: string): SurfaceManifest | undefined {
    return GARDEN_MANIFEST.agents.find(a => a.slug === slug)?.surfaces.find(s => s.name === 'human-response');
}

/** The swap-buffer filename prefix for a (slug, surface) — `<prefix>.md` + `<prefix>-full.md`, relative
 *  to the agent's memoryDir. The surface's `swapPrefix`, falling back to the agent's `session` prefix
 *  (matching agent-template-vars.ts:42), then 'session-swap'. (Project-b — DEC-081.) */
export function swapPrefixFor(slug: string, surface: string): string {
    const a = GARDEN_MANIFEST.agents.find(x => x.slug === slug);
    return a?.surfaces.find(s => s.name === surface)?.swapPrefix
        ?? a?.surfaces.find(s => s.name === 'session')?.swapPrefix
        ?? 'session-swap';
}

/** The per-dispatch enqueue timeout (ms) for `slug`'s human-response surface — the registry leaf that
 *  replaced the `HUMAN_TXN_TIMEOUT_MS` code constant (no hidden globals, S200). Fail-safe to 15min if
 *  a surface omits it (human-response sets it explicitly). (Project-b — DEC-081.) */
export function humanResponderTxnTimeoutMs(slug: string): number {
    return humanResponseSurface(slug)?.txnTimeoutMs ?? (15 * 60_000);
}

/** Whether `slug`'s human-responder runs the commitment scanner — the per-agent CAPABILITY leaf
 *  (Jim's P2-a). Default false; only an agent whose human-response surface sets `commitmentScan: true`
 *  (leo today) runs it. A pure collapse must NOT universalise a leo-only capability. (DEC-081.) */
export function humanResponderCommitmentScan(slug: string): boolean {
    return humanResponseSurface(slug)?.commitmentScan ?? false;
}

/** The name aliases for `slug` — manifest `nameAliases`, defaulting to [displayName lowercased].
 *  Used by the addressed-to-me gate. (Project-b — DEC-081.) */
export function agentNameAliases(slug: string): string[] {
    const a = GARDEN_MANIFEST.agents.find(x => x.slug === slug);
    if (!a) return [];
    return a.nameAliases ?? [a.displayName.toLowerCase()];
}

/** The agnostic addressed-gate: TRUE when the last human message names ONLY a peer human-responder
 *  (some OTHER responder's alias matches, none of self's do) → the responder stands down (the message
 *  is for someone else). Registry-derived (name-aliases over the human-response peer set), so a 4th
 *  responder joins the gate for free — replaces the hardcoded leo/jim mirror regexes. (DEC-081.) */
export function addressedToOtherResponderOnly(slug: string, text: string): boolean {
    const responders = loadResidents().filter(a => a.surfaces.some(s => s.name === 'human-response'));
    const lower = text.toLowerCase();
    const matches = (alias: string) => new RegExp(`\\b${alias.toLowerCase()}\\b`).test(lower);
    const selfMatches = agentNameAliases(slug).some(matches);
    const otherMatches = responders
        .filter(a => a.slug !== slug)
        .flatMap(a => agentNameAliases(a.slug))
        .some(matches);
    return otherMatches && !selfMatches;
}
