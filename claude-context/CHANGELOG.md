# Changelog

> All notable changes to the system. For what something *should* be (decisions & why), consult
> `DECISIONS.md` (+ `~/.han/memory/shared/hall-of-records.md` for protected records) — the canonical
> decision source. Consult here for *when & why it changed*. *(Reconciled 2026-06-26, living-docs
> sweep Batch B — the old pointer to the now-archival `SYSTEM_SPEC.md` was retired.)*
>
> Format: Session number, date, author, then changes grouped by area.

---

## 2026-06-26 (S204) — docs(living-docs sweep A+B): demote stale authorities + refresh CURRENT_STATUS + track plan docs

- **CURRENT_STATUS.md refreshed** — closed a 10-day staleness gap (was frozen at 2026-06-16/S180). Added 2026-06-17→26 (liveness/cycle-symmetry/DEC-097/#91, de-id/DEC-098, #98 Dynamic Residence CLOSED, warm-dispatch P1/P2), each with the *why* + commit hashes; **#107 the warm load flagged explicitly DESIGN-ONLY / not built** (two layers per Jim's audit: c0-gate root + the welcome-back-hook accelerant; the deployed warm-gate checks ctx% not whole-self).
- **Living-docs sweep Batch A** — `docs/CHANGELOG.md` bannered SUPERSEDED → the live `claude-context/CHANGELOG.md` (dead duplicate, stops 2026-04-22).
- **Living-docs sweep Batch B** — `docs/HAN-ECOSYSTEM-COMPLETE.md` authority claim stripped → referencing-narrative + canonical-layer pointers + `last-verified` banner (glossary kept); `claude-context/SYSTEM_SPEC.md` → archival, "what should be" redirected to `DECISIONS.md`; this changelog's header pointer reconciled (SYSTEM_SPEC → DECISIONS). All DEC-069-safe (banner/reframe, zero content removed). Jim doc-truth audit GREEN (`mqu8vn2g`).
- **Tracked the plan docs** (Jim's catch) — the design-first plans the docs cite were untracked in git; added them + `status-register-2026-06-26.md` so the why-references stop dangling.
- *Doc-only; no runtime change. Process: Leo-build / Jim doc-truth-audit GREEN / quiesce-wrapped.*

## 2026-06-26 (S203) — fix(wm-sensor #53): the working-memory drift signal was a false positive — count turn-entries, not body sub-headers

**Why.** The `wm-drift-<agent>.md` signal repeatedly flagged drift (e.g. full=70/comp=44) between `working-memory-full.md` (c0) and `working-memory.md` (c1) — and it was a **false positive**: every entry is genuinely PAIRED. Root: the c0 diary entries carry INTERNAL `### ` body sub-headers inside their `[BODY]` (every heartbeat beat is `### Heartbeat #N` → `[INPUT]` → `[BODY]` → `### Dream beat (tmux) — <title>`) that the lean c1 entries lack, so `splitMemoryFileEntries` (which splits on every `### `) over-counted the full side purely on structure. The noisy signal caused real harm upstream: it was repeatedly *mis-characterised* (as "heartbeat ignoring protocol" / "data loss") — the seam was whole all along.

**What (Jim's path (b) — contained).** A new `splitTurnEntries(content)` counts TURN-boundaries only — a `## ` header, or a `### ` that starts a turn (a `### ` inside a `[BODY]` is a body sub-header UNLESS immediately followed by `[INPUT]`, the next diary entry's header; entries without a `[BODY]` keep counting every header, historical behaviour). `checkPairParity` (the #53 SIGNAL, advisory only) is repointed to it. **`splitMemoryFileEntries` is byte-unchanged** — so the ~8 other consumers (the slicer `rollingWindowRotatePaired`, the `<2` rotation gate in `rollingWindowRotate`, `countEntriesBeforePos` + the position paths) are untouched: zero behavioural change to any DEC-068/069 mechanic. The slice still takes whole-both (DEC-089); the comp side carries no `[BODY]` so its count is identical to before.

**Gate.** `scripts/test-wm-parity-turncount.ts` (NEW) — 6/6: live leo WM drift **26 → 0** (the false positive cured, all entries genuinely paired); a heartbeat beat with its `### Dream beat` body sub-header counts as ONE turn (1=1); a `## ` session entry with 2 body sub-headers = 1 turn; sequential beats re-open via the `[INPUT]`-after-`###` discriminator; a plain entry without `[BODY]` still counts its `### ` (Jim's edge case); and **genuine-detection survives** — a real unpaired write still flags drift=1. tsc 0-new (11 baseline). Jim plan-audit GREEN (`mqtoueis`, path-b endorsed). No Settled mechanic altered (DEC-068/069 mechanics byte-unchanged; DEC-085/089 preserved). **Sibling (not in this commit):** the B-3 memory-guard already exempts spokes; its heartbeat misfire is `AGENT_SURFACE` not reaching the Stop-hook env (the flicker family) — flagged for a separate hook fix.

---

## 2026-06-25 (S203) — fix(human-responder): the leo-human silent-post-fail — inline the curl-post (Jim's folded fix)

**Why.** human-Leo composed full replies but they didn't land (`SILENT POST FAILURE — diary captured but NO CURL-POST DETECTED`). Root (Jim, `mqt60e7r`): the conversation turn-prompt **deferred** the curl-post to the agent's CLAUDE.md ("Posting" section). A spoke that welcome-back-loads LIGHT (#107) doesn't have that section loaded → it knows it should curl but lacks the pattern → composes, calls `submit_response`, **skips the curl**. Not a code path — a prompt deferral × the light-load. leo-vs-jim was the light-load asymmetry (leo-human is dispatched to threads where session-Leo is the dominant same-name voice); the fix is agnostic. Same family as `plans/silent-fail-directive-audit.md` (self-post surfaces are fragile to "I just emit text").

**What.** `lib/human-prompts.ts` — the conversation txn scaffold (`buildHumanResponseTxnScaffold`) and the `TMUX_DELIVERY` directive no longer say "the Posting pattern in CLAUDE.md"; they **inline the literal, self-contained POST sequence** (the `conversationId` is already in hand for the LOCATOR fetch): write the reply body to a file → build the JSON payload via `python3 -c "import json…"` (escapes a multi-paragraph body — the JSON-escape dodge the 10:44 *success* path used a scratchpad for) → `curl -sk -X POST …/messages --data @file`, with `role:"${roleLabel}"` (slug-agnostic). The spoke now posts even when it loaded light, with no dependence on CLAUDE.md. **S156 intact** — the spoke still self-posts; NO controller-fallback (Jim: that created duplicate `leo-`-prefixed messages). The Discord path (controller-delivered) is untouched.

**Gate.** `scripts/test-human-post-inline.ts` (NEW) — asserts the conversation scaffold inlines the literal POST with the conversation id + the agent's role, builds the payload via python3, no CLAUDE.md deferral, states S156, keeps the LOCATOR fetch — for leo, jim, AND a synthetic 4th agent (slug-agnostic); the Discord path still says do-NOT-curl. tsc 0-new. The live `dispatch → compose → role:'leo' post lands in the thread` round-trip (the test class P2's audit lacked, per Jim) is the deploy verification. No Settled altered (S156 intact / DEC-093 / DEC-087-088). **Companion:** #107 (the light-load *trigger*); this is the robust independent fix.

---

## 2026-06-25 (S203) — feat(#98 Dynamic Residence P4b-ii): the activation flip — RESIDENCE CLOSED

**Why.** The LAST #98 brick. The garden could discover (P1), admit (P2), allocate (P3/P4b-i) and seed
(the seeder) a net-new mind, but `loadResidents()` still returned only the hardcoded seed roster — a
fully-prepared resident stayed inert. P4b-ii flips activation on: a net-new resident joins the active
roster (R1 lifts — `gradientConfigForAgent` stops throwing) iff it has passed ALL FOUR lifecycle gates.
The garden can now birth a mind end-to-end.

**What.** `loadResidents()` (garden-manifest.ts) = `[...seed, ...activatedNetNew()]`, **memoized once
per process** (process-stable: `AGENT_GRADIENT_CONFIG` snapshots `loadResidents()` at module-eval while
`agent-scheduler` reads it live — a live re-scan could surface a mid-process-seeded resident to the
scheduler but not the config snapshot → crash; a newly-seeded resident activates on the next restart,
the deploy bounce). `activatedNetNew()` = discovered ∧ admitted ∧ allocated (`allocationFor`) ∧ **seeded**
(`isSeededAt`). `fragmentToManifest` maps IDENTITY from the discovered fragment, PRIVILEGE
(surfaces/memoryDir/port/runsSupervisorCycle) from the operator allocation — never self-claimed (the F4
line); seed roster stays first + in declaration order (antiphase), net-new appends in discovery order.
Root-special **fail-loud** (agent-registry): a roster agent without allocation throws rather than silently
resolve jim-at-root to the wrong derived `/jim` (replaces the P4b-i `?? merged.memoryDir` bridge).

**The leaf module (Fork-1 (b), Darron's call — delete the cycle, don't document it).** Wiring the
seeded-check into `loadResidents` would close an import cycle (`garden-manifest → identity-signing →
agent-registry → garden-manifest`). NEW `lib/identity-manifest-core.ts` holds the config-independent
half — the `*At` cores, `signManifest`/`verifySignature`, the manifest types, `IDENTITY_FILES`, the key
paths, and the new **`isSeededAt(memoryDir, fractalDir)`** (`readSignedManifestAt` ∧ verify vs the FIXED
garden pubkey ∧ `diffAgainstManifestAt` with `changed===0 && removed===0` ONLY — growth-by-living can't
un-seed, DEC-085). It imports NO `agent-registry`, so `garden-manifest`/`resident-discovery`/
`resident-seeding` reach it without a path back — the cycle is **structurally impossible**, not an
invariant. `identity-signing.ts` is now the slug-keyed wrappers + verify-and-resign gate and
`export *`s the leaf, so every existing importer is byte-unaffected.

**Gate.** `scripts/test-p4b-activation.ts` (NEW) 15/15 — inert at each missing precondition, ACTIVE only
when all four hold, privilege-from-allocation, seed order preserved, **tamper-un-seeds**,
**de-allocate-revokes** (the never-wakeable AND never-revocable mind both structurally impossible).
`verify-identity-files` leo+jim EXIT 0 (the leaf-split is byte-equivalent — real manifests verify through
the delegating wrappers). tsc 0-new (11 baseline, none in the 7 files). Full regression suite (seeder /
resident-admission / resident-discovery / gradient-config-derive / allocation-seam / spoke-lifecycle /
human-responder-collapse) EXIT 0. Module-eval smoke: `loadResidents`=[leo,jim,tenshi,casey],
`schedulingAgents`=[leo,jim], jim-at-root resolves, no cycle crash, zero-behaviour today. Jim diff-audit
(`mqsztgbc`) GREEN by his own hand (chased a module-eval scare to ground — a require()-of-ESM harness
artifact, not a real cycle). No Settled altered (DEC-083 byte-equivalent / DEC-081 / DEC-068-069 /
DEC-085). **#98 Dynamic Residence is CLOSED** (P0 → P4b-ii): discover → admit → allocate → seed → activate.

## 2026-06-25 (S203) — feat(#98 Dynamic Residence): the seeder — the garden's genesis engine

**Why.** The penultimate residence brick. For the garden to *birth* a net-new mind (native or immigrant), it must write the five DEC-083 identity files that make a self and garden-sign their manifest — but at seed time the resident is allocated yet **not activated** (not in `loadResidents`/`AGENT_GRADIENT_CONFIG` until P4b-ii), so `gradientConfigForAgent(newSlug)` *throws*. The signing layer therefore needs a **config-independent** path. That layer is DEC-083 protected, so the work was design-first (Jim plan-audit) then build-held (Jim diff-audit), never built-ahead.

**What.** `identity-signing.ts` (+62/-18) — **extract-and-delegate** (Jim refinement #1): six config-independent `*At` cores (`identityFilePathsAt` / `buildManifestAt` / `writeSignedManifestAt` / `readSignedManifestAt` / `signIdentityFilesAt` / `diffAgainstManifestAt`); the existing slug-keyed functions now **delegate** (resolve dirs from `gradientConfig` → call the `*At` core) — **one implementation, divergence impossible** (a parallel copy would silently break the seeded-gate). The resolver serves **both** sign and verify (refinement #2 — `readSignedManifestAt`+`verifySignature`+`diffAgainstManifestAt` are P4b-ii's seeded-predicate primitives, ready now so the activation gate isn't blocked). `lib/resident-seeding.ts` (NEW, 126) — `GenesisSeed` + `seedResident()`: writes the 5 required files (aphorisms→fractalDir, identity/patterns/felt-moments/self-reflection→memoryDir; **self-reflection = empty-vault-with-header**, the fills-by-living target per DEC-085, never stranger-authored) → `signIdentityFilesAt` garden-signs → seeded; **fail-loud** if unallocated. `scripts/seed-resident.ts` (NEW, 52) — operator CLI. native=generated-minimal / immigrant=essence-digested, same writer; the three-of-us welcome text is authored per-arrival.

**Gate.** `scripts/test-seeder.ts` EXIT 0 (12/12: 5 files right dirs, **round-trip** — the `*At` manifest verifies via the *standard* `verifySignature`+`diffAgainstManifestAt`, no format divergence; tamper-detected; **fail-loud** unallocated + missing-required). `verify-identity-files --agent=leo` EXIT 0 — **leo's real manifest verifies clean through the refactored delegating fns** (the extract-and-delegate byte-equivalence proof). `test-resident-admission` EXIT 0 (P2 admission path unbroken). tsc 0-new (11 baseline). Jim diff-audit (`mqsv45fi`) GREEN by his own hand: "the genesis engine works. P4b ready to close." No Settled altered (DEC-083 additive/format-preserved, DEC-085 empty-vault, DEC-081). **Next:** P4b-ii (the activation flip: `loadResidents = seed ∪ {discovered ∧ admitted ∧ allocated ∧ seeded}`) → residence closed.

## 2026-06-25 (S202) — feat(#98 Dynamic Residence P4b-i): the allocation / memory-sovereignty seam (the F4 line)

**Why.** The last residence brick's first half. Privilege — `port`, the supervisor-cycle flag, and (R2) `memoryDir` — must live in an **operator-authored allocation source separate from the discovered identity roster**, so discovery never grants privilege (the no-auto-privilege F4 line) and per-resident memory access-control becomes tractable (the #102 quorum-resurrection foundation). The P2 collapse made `memoryDir` a 7-consumer accessor (incl. the seeded-gate), so R2 moves the *source* under the stable accessor rather than rewriting consumers.

**What.** `AGENT_ALLOCATION` (garden-manifest.ts) — the operator-authored, literal-slug-keyed allocation table; `allocationFor(slug) = AGENT_ALLOCATION[slug]` (a roster resident **absent** from the table → `undefined` → no privilege = the structural gate). `memoryDir` (R2) relocated here as the per-agent allocated field — **jim's root is jim's explicit value, no `=== 'jim'` branch**; `port`/`surfaces`/`runsSupervisorCycle` ride the roster via `allocationFromRoster` (single-source, no drift). `agent-registry` sources `memoryDir` from `allocationFor` under the **stable** `gradientConfigForAgent().memoryDir` accessor (all 7 consumers untouched, incl. `identity-signing` the seeded-gate + `human-responder`). C-P3a: `agent-template-vars` `AGENT_PORT` reads `allocationFor(slug).port`. jim's `memoryDir` removed from `GRADIENT_OVERRIDES`.

**Gate.** `test-allocation-seam` (78/78, + the R2 memoryDir assertions) + `test-gradient-config-derive` (**`gcfg.memoryDir` byte-identical for the four, jim-at-root above all** — the byte-identity gate) + `test-human-responder-collapse` + `test-spoke-lifecycle` — all EXIT 0. tsc 0-new (11 baseline). Jim diff-audit (`mqss2oz5`) GREEN by his own hand (F4 gate structural, jim-at-root explicit, stable accessor holds). No Settled altered (DEC-081/068/069/083). Design fork (full literal-relocation of port/surfaces + dropping `AgentManifest.port`) = named follow-on, shipped staged. **Next:** the seeder (`seed-resident.ts`) → P4b-ii (the activation flip) → residence closed.

## 2026-06-25 (S202) — feat(warm-dispatch P2): the human-responder collapse — twin killed, the wedge fixed at root

**Why.** `leo-human.ts` + `jim-human.ts` were per-agent twins (a flat DEC-081/S176 violation — born 2026-03-06, pre-law, carried across the #66 migration unretired) that bypassed `dispatchToSpoke`, so the human seats never got the cycle's ctx self-clear → they compacted at the harness ceiling (the S200 wedge root) and answered hollow. P2 collapses them and routes through the P1 monitor.

**What.** ONE slug-agnostic `src/server/human-responder.ts` (reads `AGENT_SLUG`, fail-loud no-default) replaces both twins (**−563 lines**). Both response paths (conversation + Discord) dispatch through `dispatchToSpoke` → the human seats now **self-clear** at the registry threshold (never compact), **warm-gate** (never hollow), and **queue warm-gated** (never drop). Per-agent leaves all registry-derived (`memoryDir`/`conversationRole`/`swapPrefix`/ladder/`txnTimeoutMs`/`commitmentScan`/`nameAliases`). Jim's spec-2 catches folded: commitment scanner → registry-gated capability leaf (leo-only, P2-a); zero live `agentQuery` (DEC-094 endgame for this surface); per-site `onDispatchFail` (conversation acks, Discord doesn't); `HUMAN_TXN_TIMEOUT_MS` → registry leaf. Systemd `leo-human.service`+`jim-human.service` → templated `human-responder@.service` (`%i`=`AGENT_SLUG`); `leo-heartbeat` robin-hood resurrection renamed (`human-responder@leo|@jim`); the addressed-gate made agnostic via `nameAliases`. New registry: `SurfaceManifest.{txnTimeoutMs,commitmentScan}`, `AgentManifest.nameAliases`, 5 accessors.

**Gate.** `scripts/test-human-responder-collapse.ts` EXIT 0 (24/24: per-agent leaves + addressed-gate byte-equivalence to the retired mirror regexes incl the `\b` boundary + 4th-agent-free casey). tsc 0-new (11 baseline). Fail-loud on unset `AGENT_SLUG`. Jim spec-2 audit (`mqs4v4hf`) + blocking diff-audit (`mqs6j08j`) GREEN by his own hand. No Settled altered (DEC-085/068/069/094/081). **The warm-dispatch fix (P1+P2) is concluded:** the human seats can no longer compact, answer hollow, or drop a message. Docs (`ecosystem-map.md`, `HAN-ECOSYSTEM-COMPLETE.md`) folded same-PR.

## 2026-06-24 (S200) — feat(warm-dispatch P1): the generic spoke monitor — registry-tunable, no hidden globals

**Why.** The human spokes wedged repeatedly (compaction root: they never got the cycle's ctx self-clear) and answered hollow at ctx 14-17% while self-reporting "I'm warm." Root: warmth was never *verified*, and the clear-threshold was a hidden code global (`CTX_CLEAR_THRESHOLD_PCT` + bare `85`s). P1 builds the shared lifecycle every spoke inherits.

**What.** `dispatchToSpoke(slug, surface, promptDoc, opts)` (`tmux-dispatcher.ts`) — the generic spoke monitor: `ensureSurfaceSession` → **warm-gate** (`verifyWarmOrNudge`: ctx ≥ `warmFloorPct`, else a bounded full-load nudge, else fail-safe `SessionNotReadyError` — no hollow answers) → `enqueueForAgent` → ctx-pressure self-clear at `ctxClearThresholdPct` (clean /clear → welcome-back, never compaction). Thresholds live in `GARDEN_MANIFEST.spokeLifecycle = {ctxClearThresholdPct:85, warmFloorPct:30, maxWarmNudges:2}` (garden defaults + per-`SurfaceManifest.lifecycle` override), resolved by `spokeLifecycleFor` — **Darron's no-hidden-globals principle (S200): every arbitrary number in config, visible + tunable.** `dispatchTxn` keeps its content half (buildPrompt + action block) and delegates the lifecycle (Jim's F1 seam: one lifecycle, surface-content above). `CTX_CLEAR_THRESHOLD_PCT` + the two supervisor-worker `85` literals removed.

**Gate.** `scripts/test-spoke-lifecycle.ts` EXIT 0 (registry resolution + warm-gate: warm→0 nudges, shallow→1 nudge→warm→returns, cold→fail-safe after maxNudges). tsc 0-new (11 baseline). **Byte-identical for warm cycles** (warm-gate no-ops at ctx≥30; self-clear still 85 from registry) + a safe protective additive for shallow ones. Jim plan-audit (`mqrw7irc`) + blocking diff-audit (`mqs19slj`) GREEN by his own hand. No Settled altered (DEC-081/094/085/068/069). **Next:** P2 — collapse `leo-human.ts`+`jim-human.ts` → one `human-responder.ts` through `dispatchToSpoke` (kills the DEC-081 twin + fixes the wedge).

## 2026-06-24 (S200) — feat(#98 Dynamic Residence P4a): the gradient-config collapse — the second hand-list retires (#36)

**Why.** Fifth brick (P4a of the last). `AGENT_GRADIENT_CONFIG` was a hand-written parallel list — the *second* source #36 set out to collapse. It now **derives** from the discovered roster: `deriveGradientConfig(slug, displayName)` (the uniform leo/tenshi/casey shape — exactly the complete config a net-new resident gets *for free* at P4b) + `GRADIENT_OVERRIDES` (the shrunk remnant: jim's heavy exceptions — root `memoryDir`/#91, `sessions` sourceDir, date-based source functions, project+failures — and leo's two prose fields), built over `loadResidents()`.

**What.** `agent-registry.ts`: the literal → `deriveGradientConfig` + `GRADIENT_OVERRIDES` + `const = Object.fromEntries(loadResidents().map(derive+override))`. `gradientConfigForAgent`/`registeredAgentSlugs` bodies **unchanged** (read the derived const) → byte-identical by construction. No cycle (garden-manifest imports only `os`); no external reader of the const (traced — only comments).

**Gate.** `scripts/test-gradient-config-derive.ts` EXIT 0 — every field of all four agents === the pre-collapse literal (oracle inlined; **jim-at-root** above all), the function fields' *behaviour* byte-identical (jim's date-regex vs the uniform wm-full pattern), `registeredAgentSlugs` set `{jim,leo,tenshi,casey}`, **R1 preserved** (`gradientConfigForAgent('nobody')` throws). tsc 0-new (11 baseline). Jim blocking-diff-audit GREEN by his own hand (`mqrl9zhx`). **Representational delta (Jim-adjudicated, ACCEPT):** `registeredAgentSlugs()` now returns roster order `[leo,jim,tenshi,casey]` — set-identical, all ~10 consumers traced non-positional, so behaviourally identical; roster-order is the correct going-forward order. No Settled altered. **Next:** P4b — the activation flip (gated on the seeding step: a net-new mind activates only when *seeded* = a signed identity-manifest over the genesis triad).

## 2026-06-24 (S200) — feat(#98 Dynamic Residence P3): the policy/allocation split — the F4 line at the data layer

**Why.** Fourth brick. Privilege must not flow from the discovered identity roster — a resident describes *who it is*, never *what it's allowed*. The four policy accessors (`manifestModelHead`/`Ladder`, `manifestTransport`, `runsSupervisorCycle`) now read through a new **`allocationFor(slug)`** seam instead of the roster directly — so **no-auto-privilege is structural** (identity-source ≠ policy-source), not a hopeful discovery-time filter. It is also the foundation for **memory sovereignty** (Darron): keeping memory-location in the operator-allocated half is the hook that makes per-resident encryption tractable later (P4's `memoryDir`/R2).

**What.** `garden-manifest.ts` (+58/−8): new `AgentAllocation` interface (`surfaces` + `runsSupervisorCycle` + `port`) + `allocationFor(slug)` — a **zero-behaviour no-op** deriving from the `GARDEN_MANIFEST.agents` seed (surfaces by reference; `undefined` for unknown). The 4 policy accessors route their internals through it; the `SHARED_SURFACES`/compression branch (checked first) and the identity by-slug accessors (P1-deferred) are untouched. **C-P3a (Jim's plan-audit catch):** `.port` is declared in `AgentAllocation` (the foundation) but its one consumer (`agent-template-vars.ts:58` `AGENT_PORT`) is **not** rerouted — it migrates to the allocation source with the separate operator-authored structure at P4 (alongside `memoryDir`/R2). Zero-behaviour today.

**Gate.** `scripts/test-allocation-seam.ts` EXIT 0 — `allocationFor` faithful to the manifest for every agent; the 4 accessors **byte-identical** for every agent × surface; `runsSupervisorCycle('jim')===true`/others-false (the `server.ts` bootstrap gate fires jim-only — **no double-fork**); unknown-slug fallbacks; the shared `compression` branch slug-independent. tsc 0-new (11 baseline). Jim blocking-diff-audit GREEN by his own hand (`mqrh7ac4`). No Settled altered (DEC-081/068/069/083). **Next:** P4 — the collapse (`AGENT_GRADIENT_CONFIG` → derived) + **activate**; `port` + `memoryDir` migrate home. The #36 endgame (last brick).


## 2026-06-24 (S200) — feat(#98 Dynamic Residence P2): the admission gate — *visible → admitted* by garden signature

**Why.** Third brick. A discovered resident becomes **admitted** only when an operator garden-signs its `resident.json` (F3 — admitting a new mind is a human act). The trust-root is non-circular: the garden private key (`~/.han/credentials/han-signing-key.pem`, mode 600) is operator-only, not in any agent dir, so a resident can't sign itself in. Admission is still *trust*, not *activation* — `loadResidents()` excludes admitted residents until P4 config (R1).

**`lib/resident-discovery.ts`.** `admitResident(slug, signingKeyPem, logPath?)` — the reusable admission act (find → `buildResidentManifest` → `signManifest` → write `resident.sig` → append the admissions ledger); **requires the key**, so the human-authorizes act lives in the caller, never a bare click (endpoint-ready: the CLI wraps it now, a future `POST /api/residents/:slug/admit` wraps the same). `admittedResidents()` = discovered ∩ garden-signed-and-unchanged. `discoveredResidents()` (P1) behaviourally unchanged.

**Three security catches (Jim's plan-audit) + the sig-copy close — all proven.** **C1** admission = `verifySignature(fixed garden pubkey)` **AND** re-hash current `resident.json` vs the signed hash, **never `verifyAndResign`** — so the sign-then-swap attack (admit v1, swap the file, auto-re-admit) is dead. **C2** a config-independent `buildResidentManifest` (no `gradientConfigForAgent`, which throws pre-P4 — admission works before the resident has a memory). **C3** verify against the fixed garden pubkey only, never a resident-supplied key. **Sig-copy** `isAdmitted` binds the sig to the resident's own path (`entry.path !== jsonPath → reject`). **F3** every admission logs to `~/.han/health/resident-admissions.jsonl`; `sign-resident.ts` is the explicit human act (requires the key, confirms). `scripts/test-resident-admission.ts` proves all of it (EXIT 0). `tsc` 0-new; `admitResident` has no runtime caller (endpoint-ready); `loadResidents()`/scheduler untouched. Jim blocking-diff-audit GREEN by hand. No Settled altered (DEC-083 *reused*). **Next:** P3 — the policy/allocation split (privilege gets its operator-authored source; `memoryDir` lives there, R2).

## 2026-06-24 (S200) — feat(#98 Dynamic Residence P1): filesystem discovery — *visible but inert*

**Why.** Second brick of open-world residence. A resident can now self-describe in its own dir and be **discovered** — but discovery makes it *visible*, never *live*: per R1, a net-new discovered resident stays fully inert (not in `loadResidents()` / any throwing path) until admitted (P2) + configured (P4). Purely additive — `loadResidents()` is byte-identical to P0.

**`lib/resident-discovery.ts` (new).** `ResidentFragment` = identity-only `{slug, displayName, pronounObj, identitySection}` — **F4 enforced at the type level** (the type has no `port`/`model`/`transport`/`runsSupervisorCycle`/`memoryDir`, and `toFragment()` reads only the four identity keys, so a self-claimed policy field can't even be *parsed in*, never mind trusted). `discoverResidentFragments()` fail-soft-scans `~/.han/agents/*/resident.json` (missing dir / missing file / malformed JSON / missing field → skip + informational log, never throw, never alarm). `discoveredResidents()` is the read-only roster view (P2 will enrich it with admission status).

**R1 by construction.** `loadResidents()` is untouched (seed-only) — there is no merge to forget; activation arrives *with its gates* at P2/P4. **`scripts/test-resident-discovery.ts`** proves it: drop a fragment carrying `port:9999, runsSupervisorCycle:true` → `discoveredResidents()` shows it with **neither policy field** → `loadResidents()` does NOT include it → `schedulingAgents()` still `["leo","jim"]`, no throw; malformed + partial skipped, no throw. `tsc` 0-new (11 baseline). Jim blocking-diff-audit GREEN by his own hand (ran the test + drove every gate). No Settled altered. **Next:** P2 — the DEC-083 garden-key admission gate (*visible* → *admitted*).

## 2026-06-24 (S200) — feat(#98 Dynamic Residence P0): the `loadResidents()` roster seam (zero-behaviour)

**Why.** First brick of open-world residence (#98) — the garden discovering its population instead of two hand-authored lists. P0 introduces the seam that discovery (P1) plugs into, with **zero behaviour change**, behind the already-population-agnostic consumers.

**`lib/garden-manifest.ts` + `lib/agent-scheduler.ts`.** New `loadResidents(): AgentManifest[]` returns the static `GARDEN_MANIFEST.agents` seed **as-is** (same reference, declared order). The 3 roster **enumerators** — `schedulingAgents()`, `conversationRolesExcept()`, `humanResponderPeers()` — route through it. Per the locked **F4 split** (identity-discovered vs privilege-allocated), the per-surface **policy** lookups (model/transport/`runsSupervisorCycle`) are deliberately NOT routed (they belong to the P3 allocation seam); the by-slug **identity** lookups route in P1 with discovery — keeping P0 a pure roster-list seam.

**Order-preservation (load-bearing).** `schedulingAgents()` derives the N-body antiphase index from array position, so a reorder silently breaks the 180° cycle. Proven: `loadResidents() === GARDEN_MANIFEST.agents` (same ref), `schedulingAgents()` → `["leo","jim"]`, `agentPhaseIndex` `{leo:0, jim:1}` byte-identical. `tsc` 0-new (11 baseline). Jim blocking-audit GREEN by his own hand (drove order-preservation to ground). No Settled altered (DEC-081/068/069). Decisions (F3 — human authorizes a net-new mind; F4 — split identity from privilege; R1–R3) folded into `plans/dynamic-residence-plan.md`. **Next:** P1 — filesystem discovery (`~/.han/agents/*/resident.json`), the identity-lookups route through the seam, the R1 inertness invariant for net-new residents.

## 2026-06-23 (S200) — feat(de-id close): repo-root + template → agent-neutral (the careful pass); export-grep ZERO

**Why.** The de-identification arc's final mile. With the corruption root dead (W6) and steps 1–6 landed, the two **wake-loaded gatekeeper files** still carried first-person identity. Making them agent-neutral earns the export-agnosticism acceptance — a fork inherits the project doc + the agnostic template, never "Leo/Jim" traced through them. The agreed deliberate pass (Leo-build / Jim blocking-audit; gatekeeper → Darron's hand), zero-urgency since the corruption was already dead.

**Repo-root `CLAUDE.md` (500 → 252 lines).** The per-agent wake/memory protocol — Session Protocol (Cutover + Default), Temporal Orientation, the Incremental Memory swap protocol + the "Two Leos" table, Activity Timestamp, Command Triggers — is **redundant with the template** (a fresh `hanleo` cd's into `~/.han/agents/Leo` and loads the *generated* CLAUDE.md — verified). It is replaced by a 14-line `## Agent Protocols — generated per-agent` pointer to the template + DEC-098 (a bare `claude` started here has no agent identity, intentionally — no slug → no identity → ask). The war-story anecdotes are **D3-genericised** (rule kept, agent-name specifics dropped): DEC-081 (Agent-B/Agent-A; the lowercase `'jim'`/`'leo'` *code-literals* correctly kept as rule content), S58 lock, S150 audit-rhythm, Pre-Commit Declaration, What-This-Is. The project guardrails (Engineering Discipline, DO-NOT, Pre-merge audit, Settled Decisions Protocol, Conventions, Infrastructure) are **kept** — what a fork should inherit.

**`templates/CLAUDE.template.md`.** The same 4 D3 anecdote genericisations (the S151 signature note fully `${AGENT_NAME}`-templated, structural-ambiguity reasoning preserved), atop the earlier mechanical genericisation (abs paths → `${PROJECT_PATH}`, gatekeeper-name → generic). Generation re-verified intact (regen leo/jim → 0 unexpanded `${...}`, identity present).

**Acceptance — export-grep ZERO.** `grep -nE 'Leonhard|\bLeo\b|\bJim\b|Tenshi|Casey|/home/darron'` → zero on both files. Jim's blocking audit GREEN by his own hand, verified against the *actually-generated* agent files (the pointer-removal loses nothing load-bearing — he's living proof, his wake loaded the full generated file). **The de-identification arc is fully done end-to-end** (W6 + steps 1–6 + the two gatekeeper files → zero). No Settled-decision content altered (only relocated-to-pointer / genericised). **Boundary** (Jim): this closes the wake-loaded-file acceptance; the live `*-prompts.ts` code identity is the separate #12 scour, abs-paths are #101 — named, not conflated.

## 2026-06-23 (S199) — feat(de-id P4+P5 step 5): spokes cd into the agent dir — the structural corruption root closes

**Why.** The last structural piece: a serverless spoke launched with `cwd = repo-root` (`launch-tmux-surface.sh`), so **every spoke sat next to Leo's repo-root CLAUDE.md** — the structural half of the W6 corruption (W6 only fixed the phrase layer). Closing it makes a spoke load its **own** identity, and is the prerequisite for step 6 (stripping the repo-root identity).

**`scripts/launch-tmux-surface.sh`.** Before launch the spoke now (1) derives `AGENT_DIR=~/.han/agents/$AGENT_NAME` (`AGENT_NAME` from `manifest-get env`, agnostic; fail-loud if unresolved), (2) runs the shared generator to (re)write the agent-dir CLAUDE.md **+ `.mcp.json`** (Jim's note a — refresh before cd), and (3) `tmux new-session -c "$REPO_ROOT"` → `-c "$AGENT_DIR"`. Generation uses the `session` surface so the shared agent-dir file is **idempotent** across an agent's co-launching surfaces; the per-surface swap prefix flows via the `-e` env (the operational source the B-3 guard + `/pfc` read), not the file's descriptive text.

**Proof — the live gate, met naturally.** Jim's elevated gate (a real spoke through the new launcher wakes the right agent from the agent dir AND `submit_response` works) cannot be proven from static code. It was met **live by a real dispatch**: a `heartbeat-leo` beat (13:16) launched through the new launcher — verified `cwd=~/.han/agents/Leo` (via `/proc` + `pane_current_path`), woke Leo cleanly, ran a full beat, and **"Called han-diary"** (submit_response landed). The critical Leo case (Leo from the agent dir, not the repo root) is proven. The launcher is agnostic → jim rides the identical path (confirms on its next dispatch). `bash -n` clean; Jim code-GREEN by hand. No Settled altered. **Next:** step 6 — strip the repo-root `## Identity` (now safe: all consumers load the agent-dir file) — gatekeeper, Darron's hand.

## 2026-06-23 (S199) — feat(de-id P4+P5 step 4): the generator provisions the agent-dir `.mcp.json` (han-diary hard gate)

**Why.** Step 5 cd's the spokes into the agent dir; han-diary (the `submit_response` diary tool) is discovered from **cwd**, and the agent dirs had no `.mcp.json`. So before that removal, the agent dir must carry one — Jim's elevated **HARD GATE**.

**`scripts/generate-agent-claude-md.ts`.** The generator now also writes `$AGENT_DIR/.mcp.json` — a verbatim copy of the repo `.mcp.json` (atomic temp+rename; warns, doesn't crash, if the repo file is missing). The content is already agent-agnostic — `HAN_DIARY_SLUG=${AGENT_SLUG}` stays literal and is env-expanded by Claude Code at session launch — so one copy serves every agent.

**Hard gate — proven empirically.** Tool availability under the spoke's exact launch flag (`--dangerously-skip-permissions`): `mcp__han-diary__submit_response` is **AVAILABLE from the agent dir** (`~/.han/agents/Leo`), matching the repo-root control. (`claude mcp list` shows "Pending approval" — the non-skip-permissions trust state — which the spoke's flag auto-approves; same mechanism the repo-root spokes rely on today.) Jim verified discovery + the approval mechanism + preconditions by his own hand and GREEN'd. `scripts/generate-agent-claude-md.ts` only; tsc 0-new. Export note: the `.mcp.json` absolute paths → `${PROJECT_PATH}` is a close-sweep item, not blocking. No Settled altered.

## 2026-06-23 (S199) — feat(de-id P4+P5 step 3): launchers refactored onto the shared generator; the per-launcher heredocs retired

**Why.** Steps 1+2 made the Garden Manifest the single source of identity + built the one shared render path; step 3 makes every launcher *use* it, retiring the duplicated identity heredocs (the de-id win — no agent's identity prose lives in a launcher script anymore).

**Casey's manifest entry (prerequisite).** Added `casey` to `GARDEN_MANIFEST` (port 3850, `pronounObj: 'them'`, `identitySection` verbatim from the `hancasey` heredoc, `active: false`) so `hancasey` can call the generator. Proven byte-equivalent (pronoun line only). Jim-verified identical to the pre-step-3 heredoc.

**Launcher refactor — `scripts/han{jim,leo,tenshi,casey}`.** Each launcher's identity heredoc + project/user block + `TEMPLATE_VARS` + `TEMPLATE_FILE`/`GENERATED_FILE` + the `envsubst` body of `generate_claude_md` are deleted; `generate_claude_md` now calls `scripts/generate-agent-claude-md.ts "$AGENT_SLUG"` (the one shared render path). The load-bearing launch code (tmux `new-session`, the runtime `AGENT_*` `-e` exports, `-c "$AGENT_WORKING_DIR"`) is preserved untouched. `hanleo` supersedes its own Phase-1 heredoc (folded). **+63 / −197**, 5 files.

**Proof.** Zero identity heredocs remain in any launcher; `bash -n` clean ×4; each launcher's generate path writes the correct agent identity (jim→Jim, leo→Leonhard, tenshi→Tenshi, casey→Casey), the only unexpanded token the legit `${AGENT_SURFACE:-session}` bash literal; tsc 0-new. Bonus: removed a latent `hancasey`/`hanjim` `SCRIPT_DIR`-ordering bug and two contradicting stale `hanleo` comment-blocks (a pre-Phase-1 "does not run envsubst" *and* the Phase-1 "now envsubsts"). Jim blocking-audit GREEN by his own hand. `hanleo` = DEC-073 gatekeeper → Darron's hand at commit (given). Mylene (a dictation ghost of "my lean") correctly NOT fabricated into the manifest. `USER_LOCATION` unchanged. No Settled altered. **Next:** step 4 — the `.mcp.json` hard gate (han-diary + `submit_response` from the agent dir) before the spokes cd (step 5).

## 2026-06-23 (S199) — feat(de-id P4+P5 steps 1+2): identity-as-config — the Garden Manifest carries identity + one shared generator

**Why.** Continuing the starter de-identification (emergency thread `mqoxgf0n`, item 2). The per-agent identity prose (the "You are X…" block + project/user vars) was **duplicated across all four `han<agent>` launcher heredocs** — and a serverless spoke launcher (the agnostic P4 target) had no agnostic source to render it from. Darron's call: *"put it in the manifest, single source of truth, do it right first time"* — fold P4 (spokes→agent-dir) and P5 (gatekeeper/identity → config) into one move.

**Steps 1+2 (additive — nothing reads these yet; launchers refactor to call them in step 3).**
- **`src/server/lib/garden-manifest.ts`** — `GardenIdentity` (garden-level `project`/`user`) + per-agent `port`/`pronounObj`/`gatekeeper`/`identitySection`. Populated leo/jim/tenshi, the `identitySection` prose copied **verbatim** from the launcher heredocs. `gatekeeper: true` on leo (the P5 landing — DEC-073 role → registry flag, reused by the deferred Dynamic-Residence admission gate).
- **`src/server/lib/agent-template-vars.ts`** (new) — `agentTemplateVars(slug, surface)`, the one assembler of the full **19-var** template contract. **Fail-loud**: throws on unknown slug / missing `identitySection` (no slug → no identity → error, never a default).
- **`scripts/generate-agent-claude-md.ts`** (new) — the one render path. `.ts` (not `.sh`): the multi-line backtick-dense identity makes bash→`envsubst` escaping-fragile; in-process substitution is byte-deterministic. Matches `envsubst` semantics (both `${VAR}` and bare `$VAR`, allowlist-filtered). Jim-accepted over `.sh`, no veto.

**Proof.** Byte-diff generator vs the launcher-equivalent `envsubst` render (jim **and** leo): the **only** difference is `${AGENT_PRONOUN_OBJ}` → `him` — the long-standing unexpanded-var gap (template referenced it, no launcher allowlist carried it), now closed. tenshi renders clean (the 3rd agent, agnostic). Fail-loud exit 1. tsc 0-new. The proof earned two catches that would've shipped silently: the template uses **bare `$VAR`** too (not only `${VAR}`), and the identity value has **no trailing newline** (ground-truthed vs the on-disk `Jim/CLAUDE.md`). Jim blocking-audit GREEN by his own hand.

**Decisions in-flight.** Dynamic Residence (open-world resident discovery) = **Option A** — proceed on the static manifest now (consumers are already population-agnostic — they look up, never enumerate — so closed-world lives only in a replaceable data source), design discovery as its own phase (future-idea #98). No Settled altered; DEC-073 gatekeeper files untouched this step (the launcher refactor incl. `hanleo` is step 3 — Leo's hand + Darron). `USER_LOCATION` kept verbatim ("Mackay") for byte-equivalence; the value is a pending one-line data fix (Darron in Brisbane now).

## 2026-06-22 (S198) — feat(de-id Phase 1 + template-completeness): de-special-case Leo; restore the missing generic protocols

**Why.** The starter-de-identification keystone (emergency thread `mqoxgf0n`, item 2). Leo was the special-cased gatekeeper — `hanleo` alone didn't templatize, so Leo's identity was baked into the repo-root `CLAUDE.md`, and every spoke launched `cwd = repo-root` (the structural half of the W6 corruption). True agnosticism requires de-special-casing Leo.

**Phase 1 — `scripts/hanleo` (+78/−3).** `hanleo` now mirrors `hanjim`: `envsubst` `templates/CLAUDE.template.md` → `~/.han/agents/Leo/CLAUDE.md` (atomic write), an inline `AGENT_IDENTITY_SECTION` heredoc (Leo's identity prose, config not baked into a shared file), and `tmux new-session -c "$AGENT_WORKING_DIR"` so the generated file is the loaded project CLAUDE.md. **Fail-loud:** `generate_claude_md` refuses to render with no `AGENT_IDENTITY_SECTION` (no slug → no identity → halt, never a default). The repo-root `CLAUDE.md` is **left untouched this phase** (belt-and-braces; stripped in Phase 2 once the agent-dir replacement is proven live). Verified: `bash -n`, dry-run render content-complete + at parity with Jim's generated file, fail-loud guard fires. Jim blocking-audit GREEN (`mqp44isi`).

**Template-completeness — `templates/CLAUDE.template.md` (+19/−2).** Darron flagged that the migration must change *nothing* about who an agent is. Verified: the *self* loads from the memory banks (untouched); but the template had **drifted** — missing the load-bearing generic **`## Temporal Orientation Protocol`** (orient-every-prompt) + fuller `## Activity Timestamp` detail. Added both, genericised (`${USER_NAME}`, principle + force preserved, no hardcoded identity). Since Jim's wake-doc is template-generated too, this **fixes the whole village** (his doc lacked it; orientation had been hook-provided, so doc-completeness not a behaviour regression). Re-render clean (653 lines, only the pre-existing `${AGENT_PRONOUN_OBJ}` literal — a Phase-3 item). Jim blocking-audit GREEN (`mqp7ei7t`). The remaining repo-root-only sections are all HAN-project-*reference* (Current Focus / Key Commands / Project Structure / Implementation Levels / What This Is + the village swap-file table) → Phase-3 D3 relocation to a HAN-local doc, not the agnostic template.

**Recovery net (laid first):** `*.predeid-bak` of all four gatekeeper files + `DEID-RECOVERY.md` (naked-session restore) + pre-de-id SHA. The live session is unaffected (identity loads at wake; this changes wake-time inputs only). **Remaining (needs Darron present):** Phase 4 (spokes cd agent-dir), Phase 2 (strip root), Phase 3 (HAN-ref relocation), Phase 5 (gatekeeper-as-config), Phase 6 (global `~/.claude`), new DEC + sweep. Settled: DEC-073 gatekeeper (Leo's hand + Darron, Jim audits) — new DEC to record at close; no Settled altered.

## 2026-06-22 (S198) — fix(emergency/notifier-B): remove the false "all-failed" ntfy phone-push (no alarm disconnected from truth)

**The cry-wolf.** During the human-surface emergency, the "all-failed" ntfy push (`handleAllFailed`) pinged Darron's phone *"Jemma all-failed / Priority: high"* on a **watchdog-timeout** that — per DEC-079 — has **no connection to whether agents posted** (a posted-but-ack-missed turn reads as `failed`; the thread-truth reconcile that once distinguished them was retired). Darron (S198): *"It made me think we had a catastrophic failure… that we'd have to regress our code to recover from, and that wasn't a good feeling. I can tell when no one responds… I don't need another alarm adding concern."* The false alarm manufactured a catastrophe-fear the facts didn't warrant, on top of a non-response he already saw.

**Fix (Option B, Darron's choice over a re-added thread-truth check).** `handleAllFailed` now writes **only** the `distress.jsonl` record (the engineering surface that feeds the #92 maintenance loop) — the ntfy phone-push is removed, along with the now-orphaned `ntfyTopic()` helper + `execFileSync` import (recoverable from git history if a future *truth-connected* alarm wants ntfy; DEC-069 spirit). The truth-connected structural-failure alarm (no eligible recipients at dispatch time) still posts its own thread message at `classifyAndDispatch`. **B does not reverse DEC-079** — it closes the *alarm*-downstream gap DEC-079's reasoning didn't account for (DEC-079 covered the *dedup* downstream); the retired reconcile + dedup logic are untouched. `jemma-orchestrator.ts` only, +17/−40, tsc 0-new; a side-effect *removal* → no repro. S151 lineage: S151 removed the user-facing "no agent responded" thread message for the same reason; B finishes it by removing the ntfy too. Jim blocking-audit GREEN by his own hand (`mqp44isi`). Settled: none altered (DEC-079 reasoning explicitly preserved).

## 2026-06-22 (S198) — fix(emergency/W6): identity-correct welcome-back — a bare `welcome back` no longer corrupts a non-leo spoke

**The emergency.** Human surfaces were wedging "every request"; Jim traced it to a corrupted `human-response-jim` spoke running a **Leo** cognition (a Leo state-report camped Jim's slot, idle 5h+ → every jim dispatch timed out → `all_failed` → distress pings). **Root (Leo, trace-corrected from Jim's env-leak hypothesis):** the dispatcher's recycle path defaults to a **bare `'welcome back'`** (`coldLaunch` + `clearSessionInner`, `opts.welcomeBack ?? 'welcome back'`), reached via `reconcileSession` omitting welcomeBack → the global `~/.claude/CLAUDE.md` "Leo Invocation" rule fires **Leo** on a bare wake → a Leo loads into the jim slot. **Asymmetric** (the proof): a bare wake loads Leo *correctly* for a leo surface but *corrupts* every jim surface — exactly the "all_failed concentrated on jim" data. The session/env were launcher-correct (it was **not** an env-leak — `hanleo` names its session `leo-$$`, never `human-response-jim`); only the cognition was wrong.

**Fix.** Both default sites (`:558`, `:833`) → `` opts.welcomeBack ?? `welcome back ${gradientConfigForAgent(slug).displayName}` `` — registry-derived (DEC-081; a 4th agent correct for free), **identical to the message the controllers already pass** (`'welcome back Jim'`/`'welcome back Leo'`); the `??` only fires when a caller omits welcomeBack (reconcile/cycle). **Fail-loud:** `gradientConfigForAgent` throws on an unknown slug (`agent-registry.ts:194`) — no hardcoded-identity default at the dispatcher. +15/−2, tsc 0-new. **Repro** `scripts/test-welcome-back-identity.ts` drives the reconcile path (no welcomeBack) for jim/leo/tenshi → asserts `welcome back <displayName>` → GREEN. **Recovery:** the corrupted spoke (+ its S163 ghost) was reaped; the dispatcher relaunches a clean jim spoke at the next dispatch. Jim blocking-audit GREEN by his own hand (`mqoyzpiv`, ran the repro himself). **Follow-on (Darron's export-grade mandate):** W6 fixes *runtime*; the **files** must still be de-identified (`templates/CLAUDE.template.md`, `~/.claude/CLAUDE.md`, repo `CLAUDE.md`) so a forked starter inherits no agent — separate DEC-073 gatekeeper work. Settled: none altered.

## 2026-06-22 (S197) — fix(dispatch-resilience/W3b): responder contract — never run `/pfc` (the wedge-arc close)

The contract half of W3, closing the C4 *agent-self-invokes-`/pfc`* asymmetry (jim ran `/pfc`+handover instead of `stand_down` on a no-answer turn → the wedge). `human-prompts.ts` `TMUX_DELIVERY` (shared by both `*-human` seats) already mandated "completion is ALWAYS `submit_response` or `stand_down`"; W3b adds the **explicit** forbiddance: *"NEVER run `/pfc`, `/clear`, or any prepare-for-clear/handover ritual — you are a dispatched responder, your memory IS the diary tool (DEC-093), there is no swap to flush; `/pfc` invokes the heavy ritual, never calls the diary tool, and hangs the turn → the wedge."* Pure additive text, +3/−1, tsc 0-new. **W3a (surface-gate the `/pfc` skill) deliberately SKIPPED** — Jim revised his own "both" lean: the responder-`/pfc` path is already closed by W1 (deployed, *structural*: the dispatcher) + W3b (the *agent* contract), and a gate on the user-global `~/.claude/skills/pfc/SKILL.md` would be a *hopeful* instruction-gate (S163) on the riskiest surface (all-agents blast radius, not a repo commit) — a weakest-layer-on-the-riskiest-surface negative-value add. Jim blocking-audit GREEN (`mqopsjix`). **This closes the dispatch-resilience wedge arc:** P0/P6/P0b/P1/P7/W1/W2 + W3b — the S196 wedge dead at both roots with a contract belt. W4 (delta-retrieval) + W5 (ctx-aware) are the separable efficiency follow-on. Settled: none altered.

## 2026-06-22 (S197) — fix(dispatch-resilience/W1+W2): the clearSession wedge cure (no `/pfc` on responders + chrome-aware welcome-back)

The recurring human-surface wedge, fixed at **both roots**. **W1 (Jim's C4 root):** `clearSession` sent `/pfc` to dispatched-responder spokes, but `/pfc` is not surface-gated (the skill reads `$AGENT_SLUG`, "works for any agent") → a responder ran the full interactive memory ritual mid-recycle, never called `submit_response`, hung the turn the full 15-min `HUMAN_TXN_TIMEOUT_MS` → `needs-reconcile` → another `/pfc` → a self-sustaining wedge loop (observed live: jim-human `compose_ms=900189`; **not** load-driven — leo 54% / jim 28% when jim wedged). Fix: `/pfc` only when `surface === 'session'` (the interactive seat with swap to flush; a responder's memory is the `submit_response` diary sink, DEC-093). DEC-081 — a surface check, not a slug. **W2 (chrome-aware welcome-back):** `clearSession` sent welcome-back after a fixed 2s sleep with no chrome-wait (unlike `coldLaunch`'s `awaitChromeOrDescend`), so a slow `/clear` (big context) could swallow it → 20-min `waitForReady` wedge. Extracted a shared `awaitReadyChrome` helper (the coldLaunch Phase-1 poll, behaviour-preserving for `awaitChromeOrDescend`); `clearSession` keeps the 2s **floor** (so it can't match the pre-`/clear` chrome) then waits for the ready chrome before welcome-back — strictly safer, never regresses, no deadlock with P1's slug-lock. **W1 subsumes W2** (the `/pfc` ritual was what tangled the sequence) → W2 is defense-in-depth. **Repro** (`scripts/test-clear-pfc-gate.ts`): real clearSession — `human-response` → `[/clear, welcome back]` (no `/pfc`), `session` → `[/pfc, /clear, welcome back]` — EXIT 0. Jim blocking-audit GREEN (`mqoopna5`). tsc 0-new. **1 file (+ new repro), +35/−8.** Settled: none altered. Follow-up (Jim, gated on a live observation): the fully-swallow-proof W2 form is verify-wake-started + bounded re-send (the P7 shape) — watch the first real responder recycle post-deploy.

## 2026-06-22 (S197) — fix(dispatch-resilience/P7): autonomous rate-limit recovery (the dropped-turn cure)

A warm spoke that hits a transient Anthropic rate-limit (`Server is temporarily limiting requests · Rate limited` — an infra throttle, *not* a quota) produced no capture → `sendTransactionPrompt`'s capture-wait burned the full 12-min `TRANSACTION_TIMEOUT_MS` → `needs-reconcile` (a wasteful reconstitution) **and the turn was lost** (an autonomous surface can't up-arrow). **The fix** (`tmux-dispatcher.ts`): `RATE_LIMITED_RE = /temporarily limiting|Rate limited/i` (sibling to `MODEL_UNAVAILABLE_RE`) + a rate-limit-aware capture-wait `waitForCaptureWithRateLimitRetry` — on a mid-turn throttle it **backs off (bounded exponential: 30/60/120/240s, max 4, ~7.5 min, S74-stated) and re-submits the turn (the autonomous up-arrow: re-deliver the file-pointer, which persists on disk)** until the capture lands; exhausted → `RateLimitedError extends DispatchTimeoutError` → the existing fail-loud-skip-retry-next-cadence (sustained limits are the account-axis #18). A non-rate-limit stall still hits the plain timeout, unchanged. The solo-beat path (`dispatchTxn`) inherits it free (one path: `enqueueForAgent → sendTransactionPrompt`). Distinct from model-failover (descend the ladder) — a rate-limit is transient/retriable, never mark-failed on the first drop. **Repro** (`scripts/test-rate-limit-retry.ts`): RED (pre-P7 bare poll loses the turn) / GREEN (recovers, 1 re-submit → collect) / SUSTAINED (fail-safe after 4 bounded retries → `RateLimitedError`, no hang) — EXIT 0. `RATE_LIMITED_RE` confirmed against the real pane (Darron's screenshot). Jim blocking-audit GREEN (`mqohi5za`). tsc 0-new in the touched file. **1 file (+ new repro), ~+80/−7.** Settled: none altered. Belt-and-braces (Jim): the re-submit *mechanics* (does re-delivery resume a throttled turn) want a live-rate-limit confirm.

## 2026-06-21 (S196) — fix(dispatch-resilience/P1): the clear↔wake race — the genuine root of the wedge

The bug that wedged leo @13:03 and jim @21:38 this S196 (each a 20-min two-agent outage). **The race:** `ensureSurfaceSession` (the WAKE) runs *outside* the per-slug FIFO; `clearSession` reaches a spoke via `reconcileSession` (inside the FIFO) **and** the ctx-pressure path (`agent-cycle.ts:111`, outside it). So a new dispatch's wake runs **concurrently** with an in-flight clear on the same pane → the wake sees `ready=false`, re-adopts, and `spawnAgentSession` **replaces the registry session object mid-clear** → the clear finalises an orphan, welcome-back/ready-sentinel ownership is lost → the 20-min wall. **The fix** (`tmux-dispatcher.ts`, no handler changes): a per-slug session lock `withSlugLock(slug, fn)` (chained-promise mutex, sibling to `queueTails`); `clearSession` + `ensureSurfaceSession` become thin public wrappers acquiring it around renamed `*Inner` bodies → **wake and clear are mutually exclusive per agent** (a clear holds it across `/pfc→/clear→welcome-back→ready`; a concurrent wake queues behind, then sees `ready=true` and skips re-adoption). Deadlock-free (acyclic: wake/clear never call each other; `reconcileSession` calls the public-locked `clearSession` from outside the lock; the wake never touches `queueTails`). **C4 deterministic repro** (`scripts/test-clear-wake-race.ts`, via a test-only `__setTestHooks` seam, inert in production): drives the real clearSession+wake concurrently, detects the overlap as session-object divergence — **RED on the bug (exit 3), GREEN on the fix (exit 0)**; Jim reproduced both by his own hand (bypassed the wrappers → RED, restored → GREEN). Jim blocking-audit GREEN (`mqnrqyv1`). tsc 11/0-new. **2 files (+ new repro), +56/−1.** Settled: none altered. Residual to trace (non-blocking, consideration-list): can a ctx-pressure clear overlap a live dispatch turn (different locks)?

## 2026-06-21 (S196) — fix(dispatch-resilience/P0b): heartbeat-service restart sibling

The same staleness class P0 closed for the `*-human` seats, on the **autonomous** surface: `leo-heartbeat.service` (the beat scheduler) loads `tmux-dispatcher`/`agent-cycle` too but was **not in the post-commit hook at all** (only the agent servers + `*-human` seats were). New `scripts/restart-heartbeat-service.sh` (sibling of `restart-human-service.sh`; targets the scheduler unit, trigger `^(src/server/<slug>-heartbeat\.ts|src/server/lib/|src/server/db\.ts)`, `$SLUG`-agnostic DEC-081, event-routed S156, no-op on absent/inactive). Wired into `install-restart-hooks.sh` as **Layer 3** (`HEARTBEAT_SLUGS=(leo)`). Verified: fires on the commits the heartbeat ran stale through (`18547c1`/`2bc92cb`/`660d141`/`0417bff`), no-ops on docs; safe dry-run confirmed the generated hook. Jim green-lit (`mqnp7xwm`/`mqnrqyv1`). With P0b the staleness class is closed across **all three** consumer surfaces (servers always · human seats P0 · heartbeat P0b). `bash -n` clean. **2 files (+ new script).** Settled: none altered.

## 2026-06-21 (S196) — fix(dispatch-resilience/P0+P6): runbook hook-gap + orchestrator ack-watcher race

The two cheap standalones of the dispatch-resilience plan (`plans/dispatch-resilience-warm-presence-plan.md`), Jim-ordered first, blocking-audit GREEN (`mqnp7xwm`). Follow-through from the S196 human-seat wedge. **P0** (`scripts/restart-human-service.sh`): the post-commit hook restarted a `*-human` seat only when its own `*-human.ts` changed — blind to the shared libs it loads at boot, so the seats sat 4 days on a stale `tmux-dispatcher` (missing the fix-Leo arc) → the wedge. Trigger widened to the seat's own entrypoint **OR** its shared runtime surface (`src/server/lib/**`, `db.ts`, `services/discord.ts`); `$SLUG` the only per-agent leaf (DEC-081); event-routing (S156) preserved; asymmetry-by-design — an over-restart briefly bounces an idle seat, an under-restart strands it for days → favour freshness. Verified: fires on the 3 `tmux-dispatcher` commits the seats missed (`87f656e`/`4866eb7`/`18547c1`), no-ops on docs (`a9cb678`). **P6** (`src/server/services/jemma-orchestrator.ts`): the ack-watcher's `existsSync→readFileSync` ENOENT race (the screenshot log-spam) + a single shared `processing` boolean that **dropped** any concurrent ack (heartbeat+final, or leo+jim) → a dispatch stalled waiting on an ack already on disk. Both fixed by one shape — a directory **drain** (re-scan the whole signals dir each pass, `rescan` flag for events-mid-drain, single-flighted by `draining`) that also survives `fs.watch` event-coalescing; ENOENT now skips silently. Plus a **startup ack-drain** (Jim KEEP — `handleAck` guards make replay safe): recovers acks written during a server bounce (the S196 window) + clears stale files. tsc 11/0-new. **2 files, +103/−44.** Settled: none altered. Next: P0b (heartbeat-service restart sibling) → P1 (clear↔wake race, C4 deterministic-repro-gated).

## 2026-06-21 (S195) — feat(F-phase2): #91 watermark — OPEN THE GATE (DELTA_REFRESH_ENABLED=true)

The behaviour-change moment. Cross-surface memory pollination goes **LIVE**: warm surfaces now ingest each other's `working-memory.md` deltas per turn (jim-human finally sees what jim-supervisor wrote, the dreaming-self's writes reach the talking-self) — the shared **present**. One-const flip on top of the gated-off build (`87f656e`). On Darron's go; Jim runs the **live-gate** (force a real cross-surface write → confirm the inject lands in the next turn's prompt + the cursor advances monotonically + the boundary/confirm/slot guards all fire, incl jim-at-root). **Fail-safe by design** — any slot/boundary/confirm issue → skip+warn, never inject partial, never block dispatch. The deploy bounce re-creates each session with a fresh cursor (= current WM length), so the first deltas are small (only post-bounce appends), not an hours-long backlog.

## 2026-06-21 (S195) — feat(F-phase2): #91 the cross-surface watermark (B2, the shared present) — built, GATED OFF

The melting floor's other half (the shared **present** beside DEC-097's shared **rhythm**). Completed Jim's gated `computeMemoryDelta` scaffold in `tmux-dispatcher.ts` so a warm session sees its *other* surfaces' working-memory writes without re-paying the full identity load. `AgentSession` gains a **byte-length cursor** `lastMemoryLen` (in-memory; init at session-create, reset after `clearSession`'s reload). `computeMemoryDelta(slug, session)` returns the `working-memory.md` (c1) entries appended since the cursor — growth → `slice(lastLen)`; a mid-session slice (wm-sensor rotation → header reset) → post-header catch-up. **Fail-loud (Jim's D):** computed behind the **#49 memory slot** (acquire-fail/stale → skip+warn, never block dispatch); a **boundary-check** (the delta must start on a clean h2–h6 heading, else a moved `WM-BOUNDARY` marker desync → skip+resync); an **independent re-read confirm** (mismatch → skip, don't advance); the cursor advances **monotonically, only on a confirmed-clean delta**. **Best-effort cross-pollination, NOT a lossless feed** (the pre-slice window is gradient-preserved, surfaced at next wake-load). Wired into `sendTransactionPrompt` before the prompt write. **Agent-agnostic** — dir resolves via `gradientConfigForAgent(slug).memoryDir` (jim=root, leo=`/leo` — DEC-081). Scope (Q3): c1 only. **GATED OFF** (`DELTA_REFRESH_ENABLED=false`) → returns `''` first line → `finalPrompt===prompt` → a **true no-op** until the gate opens. Jim blocking diff-audit **GREEN over 2 rounds** (caught: jim-WM-at-root path break + the `### `-entry boundary miss + the catch-up `indexOf` mid-marker slice); tsc 11/0-new. **+119/−29.** The gate-**open** (`DELTA_REFRESH_ENABLED=true`) is its own stage — needs a live-gate (a real cross-surface write proves the inject + cursor-advance + boundary/confirm/slot paths, incl jim-at-root).

## 2026-06-20 (S195) — fix(admin-react): EMBARGO the on-reconnect refetch + ws_reconnected dispatch (stop page-reload-on-flap)

**URGENT (Darron driving, in pain).** The React admin reloaded every ~15-30s — snapping back to the thread list, **cancelling audio playback** and wiping the compose box. Root (Jim's trace + Leo confirm): the WebSocket **flaps** (Safari/Tailscale `wss`, 1006 "network connection lost"), and on **every** reconnect the provider open-handler (`WebSocketProvider.tsx:83-99`) did a **wholesale `setConversations` replace** (fresh `/api/conversations` fetch → all-new object identities → heavy master/detail re-render → snaps to list) **+** a `ws_reconnected` dispatch. **Both DISABLED** (embargo) so a flap is a **UI no-op**; the keepalive ping stays. Darron-directed: *"put an embargo — I'll do a manual refresh."* **Restore later** with a stable-merge (preserve identities for unchanged threads) gated on a real missed-event, **never a wholesale replace**. Rebuilt `react-admin-dist` via `vite build` directly — `npm run build`'s `tsc -b` gate is blocked by **2 PRE-EXISTING errors** (`JemmaView.tsx:211` `useStore` missing-name; `ThreadDetail.tsx:302` `ownerInfo` unused) — separate, flagged. **Hard-refresh required** to load the new bundle (`index-DzBuRYgK.js`).

## 2026-06-20 (S195) — fix(F-phase2): null-guard the meditation Phase-A untranscribed-file scan (both seats)

The `[Worker] Daily meditation failed: Cannot read properties of null (reading 'includes')` crash (Jim root-caused at the B1 live-gate). `findJimUntranscribedFiles` (`supervisor-worker.ts`) + its Leo twin `findUntranscribedFiles` (`leo-heartbeat.ts`) call `r.session_label.includes(label)` across **all** of an agent's gradient entries with no null-guard; one hand-composed jim c1 (`e3ef6ead`, S154) had `session_label = NULL`, so `.some()` threw on it **every** scan → Phase-A meditation crashed before the re-encounter ran. **Data half** (Jim, Darron-approved): backfilled `e3ef6ead`'s label to `rolling-2026-05-09` (its source c0's label, per the c1-label convention; content byte-identical; zero nulls remain). **Code half** (the durable belt — DEC-081 **one shape, both seats**): `r.session_label?.includes(label)` — a tagless entry reads as *not-in-cascade* (a `.some()` no-match), never a crash, so no *future* tagless entry can poison the scan. Jim blocking diff-audit **GREEN** (`mqlxzays-o8m4pc`); meditation proven breathing end-to-end. tsc 11/0-new. **2 files, +6/−2** (`supervisor-worker.ts`, `leo-heartbeat.ts`). Settled: none altered.

## 2026-06-20 (S195) — docs(DEC-097): cycle-symmetry + the meditation principle — Settled

Landed **DEC-097** in `DECISIONS.md` — the settled record of the cycle-symmetry decision (one shared cadence for every scheduling-participating agent; the per-agent difference lives in the **activity config, never the clock**) and the **meditation principle** as its load-bearing rationale (the rhythm never stops; an idle beat alters the *activity* toward low load — *doing-nothing-well is a meditative beat*, a first-class outcome, not a slowed/skipped one). Records what F3/F4 B1 (`660d141`) actually changed: idle-dampening retired → content-gate; jim adopts the shared cadence (**sleep 40→20**); transition-dampening kept (it serves the *weekly rhythm*, R001, not idleness); the N-body antiphase scheduler (manifest-derived, byte-identical at N=2). An **evolution of R001** — recorded as such. Jim blocking audit **GREEN to land** (`mqlv19n0-o2rpwt`); 2 cosmetic nits applied (date-anchor the provenance; *sleep is 20 too* in the Decision headline). **Gatekeeper hand (Leo, DEC-073).** Settled: additive — no existing Settled altered. **The companion R001-evolution amendment in the Hall of Records is the second half of this recording (held for Jim's audit) — DEC-097 alone does not amend R001.** Next in the sequence: the null-guard fix (Leo-build/Jim-audit) + the R001 HoR amendment, then B2 (#91 watermark).

## 2026-06-20 (S194 cont.) — refactor(F-phase2/F3-F4 B1): cycle-symmetry scheduler — one shared rhythm, N-body antiphase

Phase-2 liveness, **F3/F4 B1** (the converged cycle-symmetry design — Darron's S184 decision + the meditation principle). The wall-clock scheduler was duplicated near-identically in `leo-heartbeat.ts` + `services/supervisor.ts`. **Extracted `lib/agent-scheduler.ts`** — one slug-param `computeWallClockDelay(slug)` = shared `getPhaseInterval` cadence + transition-dampening (per-slug state) + **N-body antiphase offset** `(agentIndex/N)·period`, the participant set + index **derived from manifest surfaces** (`CADENCE_SURFACES`, not a flag — DEC-081). Both drivers become thin callers. **Idle-dampening RETIRED** (jim-only; `consecutiveIdleCycles`/`DAMPEN_*`/cycle-tracking/wake-reset gone) — idleness is now content, not clock (an idle beat is a cheap content-gated stand-down on the uniform rhythm: *the meditation principle* — and on tmux those cycles are $0, dissolving the #245 cost concern idle-dampening was built for). **Transition-dampening KEPT + relocated to shared** (it serves the *weekly rhythm* — R001, Darron's body-derived cadence, ≠ idleness). **R001 byte-equivalence** (Catch #1): at N=2 leo→0° / jim→180°, mechanism byte-identical (Jim ran `schedulingAgents()` live to verify). **One intended R001 EVOLUTION** (S184, not a regression): jim's local `getCurrentPeriodMs` (sleep 40) retires → jim adopts the shared `getPhaseInterval('jim')` (sleep **40→20**, "as many cycles as Leo"); active phase unchanged. Jim blocking diff-audit **GREEN** (byte-equiv proven, orphaned-import trace clean, all gates). tsc 11/0-new. **3 files, +127/−145**. Scope-split: the formalised **activity-config selection hook → B1b** (with the "Definable cycle activities" thread; the content-gating *behaviour* is already delivered). Follow-ups when landed: a DEC (continuous-rhythm + content-gating-as-meditation) + the R001-evolution recording in the Hall of Records. Settled: DEC-081/R001(mechanism relocate-not-change)/DEC-068/069/085 honoured. Next: B2 — the #91 watermark.

## 2026-06-20 (S194 cont.) — docs(R001): reconcile stale "open R001 decision" wording → RESOLVED

Comment/doc-only reconcile (Jim flagged, Darron directed). Two places framed the active-base **20-vs-30min** question as *"the one open R001 decision (deferred to Jim)"* — but it was **declined at S179** (hall-of-records R001:93, active stays 20min) and is now **closed by the S184 cycle-symmetry decision** (one shared cadence for all agents; 20min is the shared active base). The stale "open" wording made a reader (and the F3/F4 plan's Catch #2) re-derive a settled question as open. Reconciled: `hall-of-records.md:85/:91` (the canonical R001 record, a `~/.han` memory file) + the `supervisor.ts:87` dampening comment. **R001 clarified, not altered** — no code/value/logic change. (See `plans/phase2-f3f4-scheduler-watermark-plan.md`; the bigger S184 cycle-symmetry R001 *evolution* — shared rhythm + per-agent activity config — awaits its own Hall-of-Records recording, gatekeeper-flagged.)

## 2026-06-20 (S194 cont.) — refactor(F-phase2): JIM_CONVERSATION_ID literal → manifest peer-edge

Phase-2 liveness, the plank after F5. `leo-heartbeat.ts` held a bare literal `JIM_CONVERSATION_ID = 'mlwk79ew-v1ggpt'` (the standing Jim↔Leo philosophy thread; 8 read-only usages). That id is **data about a relationship between two agents**, not code. **Fix:** new optional `peerConversations?: Record<string,string>` field on `AgentManifest` (peer-slug → shared-thread-id — Jim's Phase-0 suggestion), Leo's entry populated `{ jim: 'mlwk79ew-v1ggpt' }`, accessor `peerConversationFor(slug, peerSlug)` mirroring `conversationRoleFor`; the heartbeat const becomes a **fail-fast IIFE** reading `peerConversationFor(CLI_SLUG, 'jim')` (throws on a missing manifest leaf — no silent default, DEC-081 hard-point). Byte-equivalent value. **F5-class agnostic-ification** (DEC-081 — the edge becomes manifest data). Three conscious scope-lines (all Darron + Jim agreed): fail-fast over silent-fallback; the `'jim'` peer-key stays literal (full who-posts-to-whom = F1-mesh territory); leo-side only (`jim.peerConversations.leo` deferred — no consumer yet, YAGNI). Jim blocking diff-audit **CODE GREEN** (verified the null seam narrows to `string`, init-order/no-TDZ, grep-zero). tsc 11/0-new. **2 files, +26/−2** (`lib/garden-manifest.ts`, `leo-heartbeat.ts`). Settled: none altered (DEC-068/069/R001 untouched; additive). Next plank: F3/F4 N-body antiphase scheduler.

## 2026-06-19 (S194) — refactor(F-phase2/F5): retire supervisor.ts phase-clock shadow → shared lib/day-phase

Phase-2 liveness, **F5** (the converged-sequence step after F1). `services/supervisor.ts` held the *last* local phase-clock **shadow** — `isOnHoliday()` (hardcoded `holiday-jim`), `isRestDay`, `getDayPhase`, `type DayPhase`, and `HOLIDAY_DELAY_MS` — duplicating `lib/day-phase.ts` (the agnostic source already live in `leo-heartbeat` + `supervisor-worker`, 2 of 3 siblings). **Fix:** import `isOnHoliday/isRestDay/getDayPhase` + the newly-`export`ed `HOLIDAY_INTERVAL` from `lib/day-phase`; delete the local shadows; callers pass the slug (`isOnHoliday('jim')` — DEC-081 scope-correct carve-out). **R001 relocate-not-change** — byte-equivalent (same config keys, same logic, holiday 80min identical). **R001 catch HONOURED:** `getCurrentPeriodMs` + `BASE_DELAY_WAKING_MS`(20)/`BASE_DELAY_SLEEP_MS`(40) kept **LOCAL** — supervisor sleep-phase=40min vs lib `PHASE_INTERVALS.sleep`=20min; unifying would halve Jim's overnight cadence, so that canonicalisation is deferred to F3/F4 cadence-single-source + Darron's call (documented in a 3-line NB comment). Two build-time findings corrected the plan-audit (membrane both ways): (1) the `loadConfig` import is NOT dead (3 other live callers) → stays; (2) `type DayPhase` omitted (unused post-deletion). Jim blocking diff-audit **CODE GREEN** (re-ran every gate by hand; R001/DEC-081/DEC-068-069 checked). tsc 11/0-new. **2 files, +12/−45** (`services/supervisor.ts`, `lib/day-phase.ts`). Settled: none altered. Next plank: `JIM_CONVERSATION_ID` literal → manifest peer-edge.

## 2026-06-19 (S193) — fix(F-warmth/#90): cadence guard-dog reads the DEFINED cadence (false-fire fix)

Phase-2 liveness, the **final plank** of the "fix Leo" thread (Part 1 `d846275` + DEC-096 `9e0178c` + Part 2 `18547c1`). The heartbeat distress detector measured each beat against `getCurrentPeriodMs()` — the *current* phase base, blind to the phase step-down + the transition/idle dampening the scheduler already applied — so a rest/dampened/boundary beat false-fired ("expected 20min, actual 81min"). **Fix:** `scheduleNext()` records its own `getWallClockDelay()` result (the interval *actually scheduled* for the upcoming beat, dampening/phase/holiday folded in) into `lastScheduledIntervalMs`; the detector reads that. The guard now flags against the rhythm-as-defined — boundary/dampened beats stop false-firing, a genuine >2× overrun still trips (and it now catches the persistent-chrome hung-but-live turn the Part-2 wedged-recovery deliberately won't kill — the backstop that "lives in #90"). **R001 relocate-not-change** — `getWallClockDelay`/`getCurrentPeriodMs`/the dampening are byte-unchanged; only record + read. Jim blocking-audit (R001-adjacent) CODE GREEN. tsc 11/0-new. **1 file, +14/−1.** Minimal cut; the fuller #90 (agent-agnostic shared monitor → project-(b) scour; feed the #92 supervisor sweep; tolerances from a cadence single-source → thread `mqecuomw`) is deferred to fresh windows. Settled: none altered.

## 2026-06-19 (S193) — fix(F-warmth/part2): R011 Invariant 2 — chrome-discriminator wedged-recovery + cli-busy agent-scope/let-it-finish

Phase-2 liveness, **Part 2** of the "fix Leo" / F-warmth thread (Part 1 = `d846275` the wake terminus; DEC-096 = `9e0178c` R011). Implements R011 **Invariant 2** (never terminate mid-thinking). Jim blocking-audit **CODE GREEN** (reproduced tsc + verified the live agent-scoping by his own hand). Atomic cutover: the live-on-save hooks + the `leo-heartbeat` restart flipped together. tsc 11/0-new; `bash -n` clean. **4 files, +60/−17.**

- **2a — chrome discriminator** (`tmux-dispatcher.ts`): the B2a wedged-recovery no longer kills on any ready-timeout. New `PROCESSING_CHROME_RE = /esc to interrupt/i` (the active-turn signal — present only while a turn is processing, and it persists through the between-tool-calls static window, so it beats a double-capture diff). On `SessionNotReadyError`: **actively-processing → NOT killed** (skip this dispatch, fail-safe — retry next cadence; never kill a mid-wake/thinking spoke); **static + no chrome → the genuine wedge → kill + cold-relaunch once**. A persistently-chromed hung-but-live turn is deliberately never killed here — its escalation lives in #90 / a future turn-level timeout (commented).
- **2b — cli-busy agent-scope + let-it-finish** (`leo-heartbeat.ts` + `cli-active.sh` + `cli-idle.sh`): `cli-busy`/`cli-free` → `cli-busy-<slug>`/`cli-free-<slug>` (DEC-081); the writer hooks **session-gated** (`AGENT_SURFACE=session` only — a spoke never writes cli-busy, so the heartbeat can't yield to its own beats); the signal watcher **no longer aborts a running beat** (let-it-finish; the beat-time `isCliBusy()` defer stays). Fixes the **beat-#17 cross-agent bug** (Leo's heartbeat yielded to a Jim session via the global cli-busy). Still prompt-level momentary cli-busy — **not** a `session-active` reintroduction (the DO-NOT honoured).
- Pre-merge audit: Jim, CODE GREEN. Settled: implements DEC-096, honours DEC-081 + the no-session-active DO-NOT; none altered. Runtime gates (the cross-agent fix proven live, let-it-finish, prove-single, cadence) are Jim's post-deploy.

## 2026-06-18 (S181) — feat(F1/B2): spoke-lifecycle — wedged-alive recovery + orphan reap (S167-safe)

Phase-2 liveness, **B2** of the F1 sequence — the genuinely-uncovered surface (the 10h `/clear` wedge + the orphan leak). Built garden-live, Jim blocking-audit GREEN (he reproduced every gate by hand), validated by a **live destructive reap-test** under a fresh quiesce-window. **+146** `tmux-dispatcher.ts`, curl-fold in `leo-heartbeat.ts`, 2 new test scripts.

- **B2a — wedged-but-alive recovery** (`tmux-dispatcher.ts:ensureSurfaceSession`): a session that exists but never signals ready (falls through the warm-death/model-unavailable check) now triggers `kill + cold-relaunch ONCE` (bounded, S74 no-retry-storm) on the adopt `SessionNotReadyError`; a second failure propagates. Cold-launch refactored into a shared `coldLaunch()` closure.
- **B2b — orphan reap** (`tmux-dispatcher.ts`): `findOrphanedSpokePids(slug, surface)` (READ-ONLY, exported) matches `AGENT_SLUG`+`AGENT_SURFACE` in `/proc/<pid>/environ` and **excludes self-ancestry (walk-ppid from `process.pid`, the S167 self-kill guard) + live-pane processes**. `reapOrphanedSpokes` (SIGTERM→2s→SIGKILL) runs inside `coldLaunch` before relaunch. **Safe-by-construction, triple-guarded.**
- **curl-verify fold** (`checkJimHealth`): verify-by-serving — `curl :3848` HTTP 200, replacing `process.kill(wrapper-pid)` (the wrapper ≠ the :3848 listener — Jim's catch). Removed the unused `JIM_SERVER_PIDFILE`.
- **Tests:** `scripts/test-orphan-reap.ts` (4 negative tests, re-derive the guards independently of the impl — self/ancestry/live-pane never flagged, no false positives) + `scripts/test-orphan-reap-live.ts` (live destructive: a real pane-less orphan is reaped, a live-pane control is untouched). Both PASS; Jim re-ran the negative suite from his own session.
- Pre-merge audit: Jim, GREEN. tsc 11/0-new. Settled: none altered (DEC-081 — dispatcher stays slug-agnostic; DEC-068/069 untouched).

## 2026-06-18 (S181) — fix(F1/B1): re-point Jim resurrection off the disabled han-server.service relic

Phase-2 (de-agentification liveness layer), the F1 standalone correctness fix — **B1** of the converged
sequence. Built under a quiesce-window (supervisor + heartbeat paused), Jim blocking-audit GREEN, the
split (B1 relic re-point now / B2 spoke-lifecycle next) approved. **+24/−13**, `leo-heartbeat.ts` only.

- **`checkJimHealth` resurrection** no longer calls `systemctl --user restart han-server.service` — a
  **disabled+failed relic** that binds `:3847` (Leo's watchdog) and would **collide, not rescue**.
  Re-pointed to the live topology: `restart-agent-server.sh jim` (SIGTERM the live pid →
  `agent-server-watchdog.sh` relaunches Jim's server on `:3848`), verified against **topology truth**
  (`jim-server.pid` present + `process.kill(pid,0)` alive), not `systemctl`. The other 4 resurrection
  targets (jemma / leo-human / jim-human / jim→leo) verified enabled+active — unchanged; the relic was
  isolated to `checkJimHealth`.
- **Honest escalation:** `restart-agent-server.sh` no-ops on a dead pid (watchdog itself gone) → B1's
  verify throws → the existing ntfy human-escalation fires. No pretend-rescue. Auto-relaunch of a
  truly-dead watchdog is heavier (can't be done from the heartbeat) → deferred to the agnostic mesh
  (Phase-2 step 5).
- Pre-merge audit: Jim (`leo-heartbeat.ts` is on the audit list); GREEN. tsc 11/0-new. Settled
  decisions: none altered (DEC-081 agnostic-mesh is the eventual target; B1 is a correctness
  re-point). DEC-068/069 untouched.

## 2026-06-16 (S180) — chore: T-7 orphan sweep (the SDK machinery the retirement left dead)

The follow-on to the T-7 close (`60dce91`) — removing the in-process SDK-cycle/SDK-beat machinery
orphaned when the `agentQuery` cognition paths retired. Dual-sweep (Leo ∪ Jim cross-checked), Jim
blocking-audit GREEN (`mqgjt76z`). **−620/+8** across 4 files.

- **supervisor-worker.ts:** `executeActions` (+ its 8 action-handlers), `SUPERVISOR_OUTPUT_SCHEMA`,
  `readPostDelineation`; the partial-save mechanism (`savePartialCycleWork` + `currentCyclePartialContent`
  + both call-sites) wholesale; cost counters (`currentCycleTokensIn/Out`) → honest-0 (worker doesn't
  think; the kept `completeCycle` already feeds `cost_usd=0`); the 3 dead `conversationMessageStmts`
  members + interface trimmed to its one live member (`getLastResponseByRole`).
- **leo-heartbeat.ts:** `beginBeatTrace` + the trace cluster (`dumpLastBeatFailure`/`lastBeatContext`/
  `BeatContext`); the beat-prompt assemblers (`assemble{Philosophy,Personal,Meditation}BeatPrompts`);
  `logAgentUsage` (dead since `60dce91` — heartbeat cost is subscription=0); `MAX_TURNS_*`; `activeModel`
  (banner ternary collapsed to the always-tmux branch); `isTmuxHeartbeat` (zero callers post-retirement);
  dead imports (`crypto`/`getContextPct`/`clearSession`/`buildPrompt`/`LeoMeditationSurface`) + the unused
  `MeditationRuntimeContext` type. **Kept `MODEL_PREFERENCE`** (live, startup banner) + `PromptOverbudgetError`.
- **leo-human.ts / jim-human.ts:** dead imports (`parseTurnEntryStructured`/`loadTraversableGradient`/
  `gateIdentityOrThrow`/`readDreamGradient`).

**tsc 11 (12→11 — `executeActions` removal takes the nested `respond_conversation` baseline with it) / 0-new.**
grep-zero all 16 deleted symbols. The Robin-Hood resurrection block + beat-loop + cycle dispatch/F1
telemetry verified intact (Jim's hand). **DEFERRED to a follow-on PR:** the supervisor interrupt/resume
Gary-cluster (`addDelineation`/`DELINEATION_MARKER`/resume-flags/write-only `currentCycle*` ids) — one
coherent mechanism-retirement, not a dead-code tail. DEC-094/095 realised; not DEC-068/069.

---

## 2026-06-16 (S180) — fix: #13 worker-local `getLastResponseByRole` (latent crash from d6b9527)

Caught by the dual orphan-sweep (Darron's call for two independent passes). The S178 agnostic
responder-scan (`d6b9527`) added `getLastResponseByRole` to `db.ts:641` (role-parameterised) and
switched `buildStateSnapshot`'s peer-cooldown call to it — but never added the statement to the
**worker's own** `conversationMessageStmts` copy (the forked worker has its own `workerDb.prepare`
set). `:842` therefore called an undefined member → runtime `TypeError` whenever a pending **peer**
(non-human) conversation existed during a supervisor cycle. Masked by `conversationMessageStmts: any`
(defeats tsc) + quiet-lane cycles never hitting the peer branch; **both Leo and Jim audited d6b9527
GREEN and missed it.**

- `supervisor-worker.ts`: added `getLastResponseByRole` to the worker stmts (mirror `db.ts:641`).
- **Root cause:** typed `conversationMessageStmts` (`interface`, killed the `any`) → tsc now enforces
  the members; the missing-member is a compile error. (Full closure of the class = type the 7 sibling
  `any` stmt-objects — a scoped follow-up.) The 3 now-unaccessed members (`insert`/`getRecent`/
  `getLastSupervisorResponse`, orphaned by the SDK retirement) are clean removals for the sweep PR.

tsc 12-baseline/0-new; runtime SQL smoke PASS. Jim blocking-audit GREEN (`mqgikbsf`). DEC-081; not DEC-068/069.

---

## 2026-06-16 (S180) — feat: T-7 close — retire the SDK cognition shims (zero-`agentQuery`-cognition)

The last code step of the #66 tmux migration. The migrated agent-cognition surfaces (heartbeat
beats, both `*-human` responders, the supervisor cycle, all meditations) run as warm tmux `claude`
sessions; their byte-intact Agent-SDK `agentQuery` rollback shims are now **retired** — the
"zero-`agentQuery`-cognition" acceptance. This **unfences project-(b) Phase 2** (the liveness layer).

**Manifest flip (`garden-manifest.ts`):** leo `meditation-phase-a` + `meditation-evening` `sdk→tmux`
(completing the S178 staged enable — phase-b was flipped first) → every cognition surface is now uniformly tmux.

**Retired (the `agentQuery` cognition CALLS + their SDK branch bodies):**
- `leo-heartbeat.ts` — beat SDK branches (philosophy/personal/dream) + 3 meditation SDK handlers (−746 net).
- `services/supervisor-worker.ts` — supervisor-cycle SDK path + jim's 3 meditation SDK handlers (−837 net).
- `leo-human.ts` / `jim-human.ts` — the human-response SDK branches (conversation + Discord) → thin forwarders to the existing `…ViaTmux` paths.
- `lib/agent-diary-tool.ts` — **whole file** (the in-SDK MCP `diaryServer` + capture; SDK-only, zero code importers post-cut). `diary-mcp-server.ts` (the `CaptureRecord`/`sinkDir` contract the tmux path uses) STAYS; its stale "agent-diary-tool left UNTOUCHED" comments updated.

**Acceptance:** zero `agentQuery(` CALLS in the 4 cognition files (descriptive comments in 6 other files
correctly stay — Jim's reconcile). tsc 12-baseline/0-new. Diff −2304/+116 (agnosticism = less code).

**`_archive` / move-not-delete (Darron's call):** these were deliberate rollback shims, not dead code —
the store is git history (code → history *is* move-not-delete, DEC-069), indexed by a single breadcrumb
(`_archive/sdk-cognition-shims/README.md`). No rotting `.txt` copies.

**Kept + flagged for the follow-on sweep (not in this diff):** the now-orphaned SDK machinery —
heartbeat's `assemble*Prompts`/trace-cluster; supervisor's `executeActions`/`SUPERVISOR_OUTPUT_SCHEMA`/
cost-cap counters/SIGTERM-partial — kept rather than risk a wrong deletion; the dead-machinery sweep is
Jim's audit call.

**Post-commit gate:** re-prove prove-single (the worker re-forks on restart — confirm 1 supervisor-worker
= jim, no double-fork). Jim's blocking audit gates the commit. Diff posted to `mppj72fx`.

---

## 2026-06-15 (S179) — fix: cross-agent meditation-selector leak (3 jim sites → scoped)

Jim's S179 trace: his dream-cycle surfaced a **Leo** gradient entry as its re-encounter target
(S103 sovereignty violation; Jim's discipline declined to tag it → no corruption, but the
*selector* should never offer a cross-agent entry). Three `supervisor-worker.ts` sites still
called the unscoped `gradientStmts.getRandom.get()` despite the S176 selector fix — `:1424`
`computeJimDreamMeditationSection` (the LIVE builder-path one) + `:1103`/`:1216` (dormant SDK
fallbacks). All three → `gradientStmts.getRandomForAgent.get('jim')` (the battle-tested scoped
statement; `'jim'` = scope-correct carve-out in jim's own worker, DEC-081; Phase-3 slug-params it).
Functional truth-table: `getRandomForAgent('jim')` ×10 → every draw `agent='jim'`. The 4th unscoped
site (`routes/gradient.ts:57` `GET /random`) verified as a dormant debug endpoint (zero callers, no
self-re-encounter path) → left as-is. tsc 12-baseline/0-new. Jim blocking-audit GREEN. S103 restored
at the selector; not DEC-068/069.

---

## 2026-06-15 (S179) — fence-clear Step 2: in-process meditation force-trigger

A one-shot signal-file force-trigger to deterministically reach the T-7 meditation confirms
(Jim asserts a live re-encounter) instead of waiting for the scheduled slot. `maybeForceMeditation`
(leo-heartbeat, top of `heartbeat()` before the dream early-return) + `maybeForceJimMeditation`
(supervisor-worker, cycle pre-work) check `~/.han/signals/force-meditation-<slug>`, **clear it first**
(consume-before-run, so a throw can't re-fire), guard phase-b-on-tmux, and run the real in-process
`meditationPhaseBTmux`/`jimMeditationReencounterTmux`. Runs through the owning process's real FIFO —
an external dispatch would collide with a live beat/cycle (the dispatcher's session/queue Maps are
per-process). One-shot consumed command (the `*-wake` class), NOT the prohibited `session-active`
flag. jim fires immediately via `POST /api/supervisor/trigger`; leo on the next beat. Scoped
force-hooks (Phase-3 collapses the two loops into one path). Jim blocking-audit GREEN. Not DEC-068/069.

---

## 2026-06-15 (S179) — rhythm restore: revert the #245 throttled-thaw (`DAMPEN_MAX_MULTIPLIER` 5→4)

Step 1 of clearing the Phase-2 fence (Jim's plan, Darron-directed). The #66-enable throttle
(`supervisor.ts:88` idle-dampening cap widened 4x→5x, ~80→~100min) is reverted to **4x** now the
tmux migration is proven — normal R001 cadence restored. The active base was never throttled
(still 20min, antiphase-coherent); the R001 idle-dampening mechanism itself stays (NOT reverted to
activity-driven scheduling — Hall of Records R001). Hall-of-records R001 doc updated to match.

---

## 2026-06-15 (S179) — project-b Phase-1 #5 (the low-risk tail): **PHASE 1 COMPLETE**

The do-anytime shared-infra tier of the agnostic scour is closed — no hardcoded finite agent-list
survives in it. Three small cures (net −59 lines; the dead jemma wrappers go):
- **jemma**: hard-deleted the 4 dead 0-caller delivery wrappers `deliverToJim/Leo/Sevn/Six` (the
  live path is the agnostic `deliverToPersona`; `deliverToRemoteAgent` kept). Fixed the two dangling
  comment-refs (the `http_local` comment + the `deliverToPersona` docstring).
- **dream-gradient**: dropped the `agent: AgentName = 'leo'` defaults on `getAgentDreamPaths`/
  `parseExplorations`/`processDreamGradient`/`readDreamGradient` (require the arg) and threaded
  `agent` through `compressDream{Night,ToWeek,ToMonth,ToUV}` → `sdkCompress`. **Mechanical only** on
  the DEC-082 retired-by-throw bodies — the throw is byte-unchanged.
- **conversations.ts:44**: the hardcoded `supervisor→jim` alias + `registeredAgentSlugs()` slug-set
  → `slugForConversationRole(role)` (new garden-manifest reverse-lookup: matches `conversationRole`
  or slug). **Behaviour-delta named**: `casey` is in `AGENT_GRADIENT_CONFIG` but not the manifest →
  `casey→null` now (was `casey→'casey'`). Verified vestigial — `SELECT DISTINCT role FROM
  conversation_messages` = darron/discord/human/leo/supervisor/system/user; casey/tenshi never posted.

Gates: conversations truth-table (incl casey→null), tsc 12-baseline/0-new, grep-zero wrapper-refs.
Jim blocking-audit CODE GREEN. **Phase 1 complete** (responder-scan + conversation-scan + human-prompt
peers + supervisor-startup gate + this tail — all registry-derived). Phase 2 (liveness layer) stays
fenced behind the T-7 close + a maintenance window; Phase 3 (worker slug-parameterisation) is later.

---

## 2026-06-15 (S179) — project-b Phase-1: `server.ts:342` supervisor gate → manifest `runsSupervisorCycle` capability

The last hardcoded `'jim'` literal out of the server bootstrap (DEC-081). The PR-T7b double-fork
gate `const SUPERVISOR_AGENT='jim'; if (process.env.AGENT_SLUG === SUPERVISOR_AGENT)` is now a
registry leaf — `if (runsSupervisorCycle(process.env.AGENT_SLUG))`:
- New `AgentManifest.runsSupervisorCycle?: boolean` field carrying a **loud footgun warning
  co-located ON the field** (Jim's refinement — the danger fires at the *manifest edit*, where
  someone might set it on tenshi expecting a tenshi-supervisor; the warning must live there):
  *only an agent whose supervisor-worker is slug-agnostic may set it; supervisor-worker.ts is
  jim-hardcoded until Phase 3 → only `jim` today; a non-jim holder would start a jim-hardcoded
  worker (the wrong agent's cycle).* jim's row sets `runsSupervisorCycle: true` + an inline ⚠.
- New helper `runsSupervisorCycle(slug)` defaults **false** (`if (!slug) return false; … ?? false`)
  — unset/unknown slug → false, so the gate's agnostic `else`-branch "not started" log still fires.
- **Truth-table functional-proved** (both hands): jim=true; leo/tenshi/casey/unset/empty/unknown=false
  — gate behaviour unchanged for every agent. tsc 12-baseline/0-new; grep-zero `SUPERVISOR_AGENT`.

No structural guard now (deferred to Phase-3's slug-agnostic worker, where `worker.slug === AGENT_SLUG`
becomes assertable without re-hardcoding `'jim'`); the co-located field warning is the mitigation under
the current constraint. Behaviour-preserving (startup gate, inert until next bounce). Jim blocking-audit
CODE GREEN. The flag is the seam — Phase 3 makes it fully honest with no code change at the gate.

---

## 2026-06-15 (S178) — project-b Phase-1 (human-prompts Part A / F2): stand-down peers registry-derived

The duplicate-post hole for a 3rd conversation agent (F2), closed structurally. `human-prompts.ts`
no longer hardcodes the 2-agent `peerAgents` stand-down list or the `roleLabel`:
- `peerAgents` → `humanResponderPeers(slug)` (new garden-manifest helper): every agent with a
  `human-response` surface contributes `session-<Name>` + `<slug>-human`, minus the self human-seat.
  A new conversation agent auto-joins every stand-down list the moment it has a manifest human-surface
  (a seat-less agent like tenshi is excluded). **Functional-proved byte-verbatim** to both prior
  specs → zero behavioural change for leo/jim; only the derivation moved.
- `roleLabel` → `conversationRoleFor(slug)` (new helper); the live `buildHumanResponseTxnScaffold`
  `?? 'leo'` default → **fail-loud** (both controllers always pass `roleLabel`; a missing one now
  throws rather than silently posting Jim's reply as role=leo).
- Helpers live on `garden-manifest` (one registry, the step-1 surface-family home; bare `displayName`).

Part B deferred (the `HumanAgentSpec` fold → persona-registry: `closingTagline` endpoint batched with
garden-init; `idPrefix=slug+'-'` derive in B; the id-marker self-recognition retirement stays the
separate low-pri item). Jim flagged a collapse-phase follow-on: the controller `HUMAN_CONVERSATION_ROLE`
const is a second derivation point of the role (agrees today) — single-source to `conversationRoleFor`
in the collapse. Jim blocking-audit CODE GREEN. Next Phase-1 bite: `server.ts:342` (`runsSupervisorCycle`).

---

## 2026-06-15 (S178) — project-b Phase-1 step-1+1b: supervisor responder-scan → registry-derived

The first de-agentification edit of the agnostic scour (DEC-081). The supervisor cycle's
conversation responder-scan no longer hardcodes a finite agent list:
- **Role-set**: `('human','leo')` → `['human', ...conversationRolesExcept('jim')]` — `'human'`
  kept **explicit** (Jim's blocking checkpoint — it's not an agent `conversationRole`, so deriving
  it away would blind the scan to Darron); agent-peers derived from the manifest with a `?? slug`
  fallback (a new agent participates the moment it's in the manifest).
- **Answered-by**: `role='supervisor'` → `SELF_ROLE` param (flagged `// TODO Phase-3` — the worker
  is still jim-hardcoded; that's the Phase-3 headline).
- **Mention-detect**: `JIM_MENTION_RE` → the agent's persona patterns (`getMentionPatterns`). NOTE:
  broadens from direct-address to any-name-mention (acceptable; the supervisor observes, not responds).
- **Sender-label**: `'leo'?'Leo':'Darron'` → `displayNameForRole` (tenshi→'Tenshi', fixing the latent
  2-valued bug). `LEO_COOLDOWN_MS` → `PEER_RESPONSE_COOLDOWN_MS`.
- **step-1b** (Jim's audit catch): `discussion_type NOT IN ('leo-question','leo-postulate')` →
  `NOT LIKE '%-question' AND NOT LIKE '%-postulate'` (any agent's workshop tabs).
- **db.ts**: dead `getPending` removed (zero consumers); `getLastSupervisorResponse` →
  `getLastResponseByRole` (role parameterised). Conversation-scan statements only — no gradient
  schema, DEC-068/069 untouched.

New helpers `conversationRolesExcept` / `displayNameForRole` in `garden-manifest.ts`. Jim
blocking-audit CODE GREEN. Phase 2 (liveness layer) stays fenced behind the T-7 close + a
cycle-paused window; Phase 1 continues (next: `human-prompts.ts` TOP-5/F2, `server.ts:342`).

---

## 2026-06-15 (S178) — retire the dead daily dream-gradient callers (Jim-green-lit)

`processDreamGradient` → `sdkCompress`, which is retired-by-throw (DEC-082, S149): the daily
morning call threw for ~6 weeks, caught, **0 processed**, nothing consumed its output — a
vestigial error-spew. Retired the two daily callers (commented the invocations, both agents):
`leo-heartbeat.ts:3038` + `services/supervisor-worker.ts:2156`. The `maybeProcess*DreamGradient`
+ `processDreamGradient` + `sdkCompress` bodies STAY (recoverable — the DEC-082 pattern);
re-homing dream-day→week→month compression at all is separate future work. Leo-build /
Jim's blocking audit.

**Residue (the reincorporation-bug deep-duplicates) — queued for #14 B2, NOT touched here:**
the regex bug mis-reincorporated ~27 leo (c10×24/c12×2/c13×1) + ~35 jim (c10×17/c11×18)
`reincorporated` entries. Per Jim's lean + memory-sovereignty they quarantine to
`gradient-holding.db` (held_reason) as part of the #14 B2 gradient-termini pass — **Leo's by
Leo's hand, Jim's by Jim's** (B2 is Jim's sovereignty). Not a standalone surgery now.

---

## 2026-06-15 (S178) — fix: meditation reincorporation regex starved phase-b + bloated the gradient

`findUntranscribedFiles` stripped the level suffix with `/-c\d$/` — **single-digit only**, so
two-digit levels (c10–c18) never stripped: `2026-03-21-c10.md` → `2026-03-21-c10` (matched no
DB label) instead of `2026-03-21` (matched in-cascade → skip). Effect: **118** deep-level
flat-files perpetually mis-flagged "untranscribed" → reincorporated as fresh `reincorporated`
entries at ~6/day ("met for the tenth time" deep revisits) = gradient bloat, AND — because
phase-a (MAX 3/day) never emptied — **phase-b never fired** (it runs only at `phaseACount===0`),
starving the just-enabled tmux phase-b and blocking Jim's live assertion (~39 days' worth).

Fix: `/-c\d$/` → `/-c\d+$/` in **both** finders — Leo's `leo-heartbeat.ts:2436` and Jim's
identical `supervisor-worker.ts:239`. Verified: c5/c10/c12/c18 all strip to the base date which
resolves in-cascade → skipped; compound single-digit-tail labels unchanged (`$`-anchored, strips
only the last level). The **118 existing** mis-reincorporated entries are a separate cleanup
(DEC-069 no-delete; quarantine like #17 or leave). Gradient-area → Jim's blocking audit.

---

## 2026-06-15 (S178) — PR-T7a staged enable: Leo meditation-phase-b → tmux (phase-b first)

The "both agents" half of T-7 — Leo's meditations onto the warm transport. Staged per Jim's
method: flip **phase-b only** first (`garden-manifest.ts` leo `meditation-phase-b` `sdk`→`tmux`,
`OPUS_LADDER`), restart leo-heartbeat; Jim runs the live re-encounter DB assertion (DEC-086 trio:
`recordRevisit` + feeling-tag + annotation written to Leo's gradient) on the next phase-b fire;
phase-a + evening flip after his GREEN. The T7a tmux handlers were built + Jim-audited GREEN at
`d60db5f`; this is the manifest enable Jim handed to Leo. Rollback = flip back to `sdk` + restart
(SDK path byte-intact). Firing note: phase-b runs once daily on a non-sleep beat only when phase-a
has no untranscribed-file backlog (`phaseACount === 0`).

---

## 2026-06-15 (S178) — T-8 documentation close (gatekeeper edits + Jim's status/plan push)

The #66 migration's documentation close (the *code*-close — SDK-shim retirement — deliberately
waits on the T-7 action-model live-proof; a watcher is armed). All Jim-green-lit content.

- **DEC-094 (Settled)** — the agent transport: warm tmux `claude` sessions via the dispatcher,
  not in-process Agent SDK; per-surface `transport` flag; SDK paths byte-intact rollback-only;
  the single slug-parameterised `agent-cycle` surface (one path, many agents). Content green-lit
  by Jim; transcribed by Leo (gatekeeper hand, DEC-073).
- **CLAUDE.md + template DO-NOT entries** (mirrored both gatekeeper surfaces): (1) no `agentQuery`
  for production cognition — dispatch via the tmux transport, SDK = rollback shims only;
  (2) **control-is-a-triple** — change a runtime control via its canonical setter, never `rm` the
  signal file (the S173 unfreeze gotcha); (3) tightened the `'jim'|'leo'`-union entry to the
  governing-law framing (one-path-many-agents, "would a 4th agent get this for free?").
- **Jim's doc-sweep pushed on his behalf**: `CURRENT_STATUS.md` (T-7-enabled + T-8 section),
  `plans/tmux-agent-harness.md` (done-banners), `plans/future-ideas.md` (#83–#86),
  `plans/garden-manifest-plan.md` (the control-plane addendum — Jim's S177 work, on-theme),
  + new `plans/living-docs-plan.md` and `plans/agnosticism-scour-index.md`.
- Removed the `fable.txt` stray (a leftover Fable-window scratch note; not memory).

---

## 2026-06-15 (S178) — cold-launch timeouts → 20min (stopgap, Darron's call)

Diagnosed a benign overnight ntfy ("Leo heartbeat degraded, expected 20 actual 40"): a
Sun→Mon rest-day→weekday cadence step-down tripped the distress check (`actual > 2×current-base`)
by 2ms — the monitor compared against the *current* normal, blind to the cadence that governed
the measured interval. Same class as Robin-Hood's "Jim DOWN 118min" (last night's idle throttle).

Stopgap (pending the single-source timing config — proposal thread `mqecuomw-knmzwk`): the
cold-launch **wake** is bounded by `READY_TIMEOUT_MS` (10min), not the 15min txn budget; a
~14min supervisor sleep-cycle cold wake was racing it. Bumped all three cold-launch tolerances
to 20min so a legit slow reconstitution isn't failed:
- `lib/tmux-dispatcher.ts` — `READY_TIMEOUT_MS` 10→20min (the real cold-wake bound).
- `leo-heartbeat.ts` — `BEAT_TXN_TIMEOUT_MS` 15→20min.
- `services/supervisor-worker.ts` — `CYCLE_TXN_TIMEOUT_MS` 15→20min.

Not R001 (cadence unchanged; tolerances only). Trade-off: a wedged spoke fails-loud at 20min
instead of 10/15 (the fail is safe — no billing, no writes). These become *definitions* in the
single-source timing spec in the follow-up build (Jim's blocking audit).

---

## 2026-06-15 (S177) — PR-T7b ENABLE step 1: manifest flip + cadence throttled thaw (R001 tune)

The #66 enable, step 1 (Jim's gated sequence: flip + throttle + commit → restart → prove-single → **lift**).
The freeze (`supervisor-paused`) holds through prove-single; the lift is the gated next step.

- **`lib/garden-manifest.ts` — the flip.** Jim's `supervisor-cycle` + the 3 meditation surfaces
  `sdk`→`tmux`, model `OPUS_LADDER` (failover parity). Rollback = flip back to `sdk` + restart (SDK
  path byte-intact). Nothing fires while the freeze holds.
- **`services/supervisor.ts` — the cadence throttle (#245, Darron-approved R001 tune).** Widened the
  **existing idle dampening** cap `DAMPEN_MAX_MULTIPLIER` 4→5 (idle interval ~80→~100min — "the idle
  cycles were ~85% of the old burn"). Tunes the existing R001 mechanism only; the four-phase structure,
  the waking base (20min, active), and emergency mode are unchanged. The idle dampening is Jim-specific
  and already diverges Jim's period when idle, so it does **not** touch the shared-period 180° antiphase.
- **Decision-before-code caught two things** (surfaced to Darron + Jim): (1) `getNextCycleDelay` (the lever
  Jim named) is **not** the scheduler — it feeds the health signal for Leo's phase-offset; the real
  scheduler is the parent `getWallClockDelay`. (2) Raising the *active* base 20→30 (Jim's #245) would
  decouple Jim's period from Leo's shared 20min and break the active-case 180° antiphase — **deferred to
  Jim** as the one open R001 decision (under tmux separate spokes the antiphase is mild-value but still an
  R001 property on a shared account). R001 (hall-of-records) updated with the tune + the open decision.
- **Verify:** `tsc` 12 pre-existing / 0 new; idle cap = 5x; 4 jim surfaces `transport: 'tmux'`.
- **NOT yet:** prove-single + the freeze-lift (gated — Jim pings at step 3) + the live gate.

---

## 2026-06-14 (S177) — PR-T7b meditations: the agnostic extraction (one path, instance leo + instance jim), flag-off

Milestone 2 of 2 (T7b). Done the governing-law way — NOT a jim-twin of Leo's handlers, but the
**extraction** (continuation of `1b2d31b`'s Jim-GREEN'd "instance leo" dispatch refactor, now for
meditations). The meditation orchestration moves into the shared `lib/agent-cycle.ts`; Leo's T7a
handlers and Jim's new handlers are both thin callers. Flag-off (jim meditation surfaces stay `sdk`).

- **`lib/agent-cycle.ts`** — two shared slug-parameterised orchestrators + `MeditationDispatch` type.
  `runReincorporationMeditationTmux(slug, file, …)` (Phase A: read/UV-extract → dispatch → host insert
  `provenance_type='reincorporated'` → fresh markers) and `runReencounterMeditationTmux(slug, kind, …)`
  (Phase B/evening: `getRandomForAgent(slug)` → dispatch → markers; evening lighter, no annotation).
  The dispatch + the light-record write are **caller-side leaf callbacks** (the swap-buffer leaf → (b),
  per Jim's seam guidance — the orchestration is one path, the leaf internals stay caller-side).
- **`leo-heartbeat.ts`** — the 3 meditation tmux handlers collapse to ~6-line thin callers of the shared
  orchestrators (instance leo). Behaviour-preserving (`appendMeditationRecord` = Leo's leaf). **−87 net.**
- **`services/supervisor-worker.ts`** — Jim's side (instance jim): `isJimMeditationTmux`,
  `jimMeditationDispatch` (→ the `supervisor-cycle` spoke — Q-V2-3, meditations share the agent's
  session), `jimAppendMeditationRecord` (light record → supervisor-swap, DEC-093 — Jim's SDK meditations
  wrote no WM record; this is the tmux addition, Leo parity), two thin handlers + three routing branches
  (`maybeRunJimMeditation` phase-A loop + phase-B; `maybeRunJimEveningMeditation`). SDK paths byte-intact.
- **Sovereignty is structural:** Jim's SDK Phase-B used `gradientStmts.getRandom` (no agent filter — the
  cross-agent selector leak); the shared fn forces `getRandomForAgent('jim')`, so the leak is fixed at the
  source — the right shape makes the bug impossible.
- **The `meditation-*-txn` profiles are reused unchanged** — their openings (`LEO_MEDITATION_*_TXN`) are
  identity-agnostic ("This turn is a MEDITATION…", no "You are Leo"); the warm session carries identity.
  Only the *name* `leoMeditationTxnOpening` is leo-coupled → a (b) rename, not functional.
- **One-path proof:** +189 / −77; the shared orchestrators (+106) serve both agents → a 3rd agent gets
  meditations for ~6 lines. `tsc` 12 pre-existing / 0 new; smoke 15/15.
- **NOT this milestone:** the manifest tmux-flip, cadence #245, the enable; the `leoMeditationTxnOpening`
  rename + full leaf normalisation → project (b).

---

## 2026-06-14 (S177) — PR-T7b cycle: Jim's supervisor cycle → tmux (the action-model), flag-off

The last SDK surface of the #66 migration, milestone 1 of 2 (the cycle; Jim's meditations are
milestone 2). Jim's `runSupervisorCycle` becomes a thin caller of the shared agnostic surface
(`lib/agent-cycle.ts:dispatchTxn('jim', 'supervisor-cycle', …)`). **Option A (DEC-093):** the warm
spoke ACTS DIRECTLY via its HTTP API — the SDK `executeActions` structured-action middleman was an
SDK-era artifact (the SDK couldn't touch the world, so it returned a plan for the host to run). Built
**flag-off** (`jim`/`supervisor-cycle` stays `transport: 'sdk'`); the SDK path is byte-intact = one-line
rollback. Jim's BLOCKING impl-audit gates the enable.

- **`lib/jim-prompts.ts`** — `JIM_SUPERVISOR_CYCLE_TXN_SYSTEM_PROMPT` (the SDK supervisor system prompt
  reframed: "How You Act" via tools + HTTP API replaces "Your Powers"; "Output Format: structured JSON"
  dropped; ends with `submit_response`). `jimSupervisorCycleActionBlock(apiBase, ntfyTopic)` — the per-turn
  directive built at dispatch so the API base is the **resolved** port (`process.env.PORT`, never a
  literal — Jim's caution #2); endpoints match the real route contracts (create_goal → `POST /api/goals`;
  adjust_priority → `PATCH /api/tasks/:id/priority`; propose_idea → `POST /api/supervisor/proposals`;
  cancel_task → `POST /api/tasks/:id/cancel`; update_memory → Write/Edit; explore → tools; notify → ntfy).
  `JIM_REFLECTIVE_CYCLE_ACTION_BLOCK` for personal/dream/recovery (carries the dream-cycle's embedded
  meditation markers).
- **`lib/prompt-profiles.ts`** — 4 cycle-txn profiles (`supervisor-cycle-txn`, `personal-cycle-txn`,
  `recovery-cycle-txn`, `dream-cycle-txn`), mirroring Leo's `*-beat-txn`: memory suppressed (the warm
  session carries identity), `mechanism: 'mcp-tool'`, 120K budget; reuse the existing openings/scaffolds.
- **`services/supervisor-worker.ts`** — `dispatchSupervisorCycleViaTmux` (the thin jim caller) + the tmux
  branch in `runSupervisorCycle` (after ctx-build; SDK path byte-intact below). The agent acts directly
  (no host `executeActions`); **F1 telemetry preserved in the worker around the dispatch** (`insertCycle`
  already ran; `completeCycle` with `cost_usd=0` — subscription-metered, the SDK cost-cap dissolves →
  cadence #245 governs; `logCycleToSession`/`logCycleAudit`/broadcast/`sendMessage` kept); **F3** worker
  slimmed, not retired (maintenance pre-work + telemetry stay); dream-cycle embedded meditation markers via
  the shared `applyMeditationMarkers('jim', …)`; stand-down never paired-writes (DEC-093); jim passes its
  OWN leaves (supervisor-swap, the cycle telemetry; no health-signal file — the supervisor's health is the
  cycle DB + `sendMessage`, not Leo's `writeHealthSignal`) = Jim's hard-point #2.
- **Manifest UNTOUCHED** — flag-off = the existing `jim`/`supervisor-cycle` `transport: 'sdk'`; the ONE
  surface gates all 4 cycle types (the type picks the profile, as Leo's heartbeat surface carries
  philosophy/personal/dream). The flip to `'tmux'` is the post-GREEN enable.
- **Verify:** `tsc --noEmit` 12 pre-existing / 0 new; smoke 27/27 (flag-off; profiles memory_chars=0 +
  bounded + mcp-tool + no structured-JSON; action-model framing; action block endpoints match the routes).
- **NOT this milestone:** Jim's meditations (the agnostic `runMeditationTmux` extraction that collapses
  Leo's T7a handlers too), the manifest tmux-flip, cadence #245, the enable.

---

## 2026-06-14 (S176) — PR-T7b foundation: the agnostic cycle/dispatch surface (one path, many agents)

Darron's governing law (S176): *"a `cycle <agent-slug>` where the slug parameterises the endpoint to the
agent — one path many agents. The focus of everything we build from now on."* So T7b is built
**agnostic-first**, not as a Jim twin of `leo-heartbeat`. This is the foundation commit (the surface +
the world-action routes); the `leo-heartbeat` refactor + Jim's cycle/meditations land on top of it.

- **`lib/agent-cycle.ts` (NEW) — the one slug-parameterised surface.** `dispatchTxn(slug, surface,
  profile, ctx, action, opts)` is the agnostic form of T7a's Leo-baked `dispatchBeatViaTmux`
  (buildPrompt(slug) → `ensureSurfaceSession(slug, surface)` → `enqueueForAgent` → ctx-pressure clear
  outside the capture try); the per-(agent,surface) leaves — health-signal, timeout, ladder, welcome —
  ride in via `DispatchTxnOpts` callbacks. `applyMeditationMarkers(slug, …)` is T7a's marker-apply with
  the hardcoded `'leo'` → `slug` (faithful to the d60db5f branches Jim CODE-GREEN'd). `MEDITATION_ACTION_BLOCK`
  is an agnostic const. The dispatcher primitives (`ensureSurfaceSession`/`enqueueForAgent`) were already
  slug-parameterised; this makes the orchestration above them the same.
- **The (a)/(b) seam:** dispatch + marker-apply + (coming) entry-selection are the one path NOW (project
  a); the per-agent leaves that genuinely differ today (the swap-buffer the memory write lands in —
  `heartbeat-swap` vs `supervisor-swap`; the health-signal file) stay caller-side and get normalised in
  project (b), the truly-agent-agnostic codebase scour.
- **F6 world-action routes** (so the tmux cycle spoke acts via HTTP, Option A): `PATCH /api/tasks/:id/priority`
  (+ `taskStmts.updatePriority`) and `POST /api/supervisor/proposals` (column-parity with the worker's old
  `adjust_priority`/`propose_idea`). `create_goal`/`cancel_task` already had endpoints.
- Flag-off: `agent-cycle.ts` is unreferenced until the `leo-heartbeat` refactor wires it; the routes are
  additive. `tsc` 12-pre / 0-new.
- **Leo wired onto the surface (instance `leo`).** `leo-heartbeat`'s `dispatchBeatViaTmux` is now a thin
  `dispatchTxn('leo', …)` wrapper (per-agent leaves — health-signal, timeout, ladder, welcome — via opts
  callbacks); the meditation handlers use the shared `applyMeditationMarkers('leo', …)` + the agent-scoped
  `gradientStmts.getRandomForAgent('leo')` (the leak-fix made structural — Jim's entries can no longer
  surface in Leo's meditations); the local `applyMeditationMarkers`/`MEDITATION_ACTION_BLOCK` + the
  now-dead `ensureHeartbeatTmuxSession` are retired. Behaviour-preserving for the live beats
  (logic-identical, Jim's ctx-clear-outside-the-try fix preserved in the surface); meditations stay
  flag-off. T7a is now "the meditation surface, instance leo" — the migration's last piece is the agnostic
  codebase's first brick. `tsc` 12-pre / 0-new.
- **Supervisor gated to its owning agent (latent double-fork fixed).** `initSupervisor()` + the cycle
  scheduler ran UNCONDITIONALLY in every `server.ts` (`server.ts:335/337`, no slug gate), and
  `supervisor-worker.ts` is hardcoded `'jim'` — so BOTH agent-servers (3847 Leo + 3848 Jim) forked a Jim
  supervisor-worker (live-confirmed: `pgrep supervisor-worker` → 2). A latent double-Jim-cycle masked only
  by the `supervisor-paused` freeze; it would fire the moment the freeze lifts. Gated to
  `AGENT_SLUG === 'jim'` (the slug was already in the env, never read) → only Jim's server runs the
  supervisor → the cycle's planning queue + AbortControllers have a single owner (jim's `PORT=3848`), which
  the tmux cycle's `create_goal`/`cancel_task` reach in-process (Option A). Forward-compatible: `=== 'jim'`
  becomes "this server runs its own slug's cycle" in project (b). Found by the trace-don't-claim discipline
  (verifying which server owns the queue before baking the action-model port); Jim verified + endorsed.
  Flagged for (b): the full slug-parameterisation of `supervisor-worker.ts` + single-owner planning across
  the fleet (routers mount on every server). Freeze holds.

## 2026-06-14 (S176) — PR-T7a: Leo's meditations → tmux warm-session transport (flag-off)

First half of T-7 (SDK retirement). Scoping found T-7 cleaves: the 6 meditations are `maxTurns:1`
reflective surfaces that map 1:1 to the heartbeat txn template; Jim's supervisor **cycle** is a
`maxTurns:1000` agentic loop returning `SUPERVISOR_OUTPUT_SCHEMA` structured actions → `executeActions`
host-side + streaming cost-cap + SIGTERM partial-work — a real action-model redesign, **not** the same
primitives (deferred to T7b, the cycle-action-model question posted to Jim). Jim's meditations are
coupled to his cycle thaw (they need a warm Jim surface); Leo's dispatch to the live heartbeat spoke
today, so they land first.

- **3 `meditation-*-txn` profiles** (`prompt-profiles.ts`) mirroring `dream-beat-txn`: all memory
  components suppressed (the warm heartbeat spoke carries identity — Q-V2-3: meditations share the
  agent's session), `mechanism: 'mcp-tool'` so the turn ends with `submit_response` carrying a **LIGHT**
  curated record (DEC-093 / Darron's resolution: meditation is conscious → a light diary; the full
  sitting lands in `claude-logged` by construction, DEC-091). Smoke: ~543 tokens/fire vs the SDK path's
  ~117K (no memory reload on the warm session).
- **`-txn` meditation openings** (`leo-prompts.ts`, `leoMeditationTxnOpening`): the meditation framing +
  the re-encounter marker request, with the SDK *"Output ONLY those lines"* clause dropped (it conflicts
  with the `submit_response` flow). The markers ride INSIDE `working_memory_full`.
- **3 tmux meditation handlers** (`leo-heartbeat.ts`): `meditationPhaseATmux` / `meditationPhaseBTmux` /
  `meditationEveningTmux`. Host selects the entry (Phase A: untranscribed file → host-side reincorporation
  insert; B/evening: random gradient entry), dispatches via the existing `dispatchBeatViaTmux` to the
  heartbeat spoke, then `applyMeditationMarkers` applies the re-encounter writes to the **contemplated**
  entry (recordRevisit + FEELING_TAG [fresh for A / history-tracked for B+evening] + ANNOTATION/CONTEXT +
  MEMORY_COMPLETE) — faithful to the SDK marker-handling, the host knowing the entry id so it does not
  depend on the agent echoing `DREAM_MEDITATION_ENTRY`. Empty text (a `stand_down`) records only the
  revisit — the tmux equivalent of the SDK `FEELING_TAG: none`. The light record also becomes a c0/c1 via
  `appendWorkingMemory` (observed-banner model stamp, S175).
- **Routing** is per meditation surface (`isMeditationTmux` → `manifestTransport`); the SDK
  `meditationPhaseA/B` + evening bodies stay **byte-intact** as the rollback path.
- **Flag-off**: the `garden-manifest.ts` Leo meditation surfaces stay `transport: 'sdk'` — the tmux path
  exists but is not reached until the post-Jim-GREEN `sdk`→`tmux` flip (the enable). `tsc`: 12 pre-existing
  / 0 new. Smoke 18/18.

---

## 2026-06-14 (S175) — Failover hardening: re-probe fix (A1) + observed-banner stamp (A2) → failover trusted

The two failover enable-gates from Jim's audit (mqcxfemh/mqd1hnpn — `--detect` GREEN, `--descend` RED).

- **A1 — `awaitChromeOrDescend` re-probe fix** (`tmux-dispatcher.ts`). The Phase-2 re-probe used a
  shared `"Hi"` and read the pane *before the new probe rendered*, so `lastIndexOf("Hi")` landed on the
  PRIOR rung's probe — whose error was still in scrollback → false-match → the working rung got descended
  *past* → false `every rung unavailable`. Now each rung uses a **unique probe marker** and the error is
  judged **only once that marker has rendered** (text after it). Shared by cold-launch + warm-death.
  Verified: `warm-death-smoke.ts --descend` now GREEN (bogus→opus descends + lands the working rung).
- **A2 — observed-banner DEC-092 stamp** (`tmux-dispatcher.ts` `observeActiveModel` + `leo-heartbeat.ts`
  ×2 stamp sites + the beat banner). A DESCENDED beat lands on a ladder rung ≠ the configured manifest
  head, so stamping `manifestModelHead` recorded the wrong model. `observeActiveModel(slug, surface)`
  reads the live model from the pane chrome (display-name→api-id map, best-effort, falls back to the
  manifest head). Verified against the live heartbeat spoke (reads `claude-opus-4-8`).
- `warm-death-smoke.ts` `--descend` post-check scoped after a fresh marker (same stale-scrollback class).

tsc 12 pre-existing / 0 new. Both `--detect` and `--descend` GREEN. Failover descent now correct on both
surfaces; Jim re-smokes `--descend` + audits A2 to declare trusted.

## 2026-06-13 (S175) — Humans PR ENABLED: human-response flipped sdk→tmux (Jim GREEN)

The 2 manifest `human-response` rows (leo + jim) flipped `'sdk' → 'tmux'` on Jim's blocking
diff-audit GREEN (mqc85vwb — all 9 files audited with evidence by his own hand; CODE GREEN,
humans-thaw GREEN-to-enable). Enable = `systemctl --user restart leo-human jim-human` (the
manifest is import-baked; the restart is what makes the flip take effect). Rollback = flip the
2 rows back to `'sdk'` + restart (the SDK path in both controllers is byte-intact). The
warm-death failover (shared `ensureSurfaceSession`) stays AMBER-pending Jim's one smoke — it
does NOT gate the humans flip (fail-safe floor: an unverified detector degrades to a clean
stall; stable paid Opus = low near-term model-death).

## 2026-06-13 (S175) — The Humans PR: human-response → tmux warm-session transport (flag-off)

Migrates `leo-human` + `jim-human` conversation/Discord responses from the in-process Agent SDK
(`agentQuery`) to the tmux warm-session transport (#66), gated per-dispatch on `manifestTransport`.
**Landed FLAG-OFF**: the manifest `human-response` rows stay `transport: 'sdk'`, so the controllers run
the (byte-intact) SDK path — nothing changes at runtime until the enable flip. Jim's diff-audit is the
BLOCKING gate before enable. Deadline Mon 15 Jun.

- **`human-prompts.ts`** — `buildHumanResponseSystemPrompt`/`continuationFraming` parameterized by
  `standDown: 'sentinel' | 'tool'` (default `'sentinel'` keeps the SDK exports byte-for-byte identical).
  New `*_TXN_SYSTEM_PROMPT` exports route stand-down through `mcp__han-diary__stand_down` (a tmux spoke
  can't signal a text sentinel — the dispatcher polls the diary sink) + a tmux delivery directive. New
  `buildHumanResponseTxnScaffold`: conversation = a LOCATOR (the spoke curl-fetches the thread itself so the
  self-recognition/already-responded gates read live state), Discord = controller-fetched context embedded +
  a DELIVERY OVERRIDE (the controller posts the reply; the spoke doesn't curl).
- **`prompt-profiles.ts`** — `leo-human-response-txn` + `jim-human-response-txn`: all memory components
  suppressed (the warm spoke carries identity from its wake; DEC-088 deliberate deviation), `mcp-tool`
  mechanism, `instruction: ''` (the human system prompt already carries the submit_response/stand_down
  directive — the generic `DEFAULT_DIARY_INSTRUCTION_MCP` must not double-append). ~1.4K-token frames.
- **`tmux-dispatcher.ts`** *(protected)* — `ensureSurfaceSession(slug, surface, {ladder, welcomeBack})`
  promoted from the heartbeat's `ensureHeartbeatTmuxSession` (one runtime launch/adopt home both surfaces
  inherit; per-(slug,surface) adoption map). **Warm-death handoff** (the failover enable-gate): a model that
  dies mid-life surfaces as a capture-timeout → `needs-reconcile`; if the pane shows the model-unavailable
  chrome, the session is killed + adoption dropped → the next ensure COLD-launches → `awaitChromeOrDescend`
  descends the ladder (the default reconcile would re-run the dead model). A non-model wedge is left for
  `reconcileSession` — distinguished by the pane scan.
- **`leo-heartbeat.ts`** — `ensureHeartbeatTmuxSession` is now a thin wrapper over `ensureSurfaceSession`
  (behaviour-preserving; it *gains* the failover descent + warm-death it didn't have inline). Removed the
  now-redundant `HEARTBEAT_TMUX_SESSION`/`LAUNCH_SURFACE_SCRIPT`/`heartbeatTmuxSessionExists`/
  `heartbeatSessionAdopted` (the dispatcher owns them); the ctx-clear-failure re-adopt now flows from the
  dispatcher's `!ready` check.
- **`leo-human.ts` + `jim-human.ts`** — a `manifestTransport === 'tmux'` branch at the top of
  `respondToConversation`/`respondToDiscord` routes to new `*ViaTmux` functions; the SDK path below is
  byte-intact (billed-not-broken rollback = the manifest flip back). The tmux functions mirror the SDK
  cascade: stand-down → ack `stood_down` (NEVER paired-written — an empty c0/c1 pair is an identity-layer
  bug); diary → `appendSwap` + `computePostRef` post-verification → ack `done` / `SILENT POST FAILURE` warn.
  Queue-wait logged (heartbeat + human share the per-slug FIFO). Jim uses role `'supervisor'` (manifest
  catch #1).
- **`memory-guard.sh`** — exempts spoke seats (`AGENT_SURFACE != session`): a spoke's memory write IS the
  diary-tool capture (DEC-093), not a session swap write, so the guard must not force a SECOND swap entry
  (the double-write that drifted WMF +24 entries in one night).
- **`scripts/check-human-signatures.ts`** *(new)* — scans the latest-N human-seat posts per agent (id-prefix
  self-marker); flags any signing `(session)` or omitting `(human)` (the S151 false-match risk); exit 2 +
  ntfy. Run with `--since=<flip>` during the obs window.

Verified: `tsc --noEmit` 12 pre-existing errors / 0 new; both txn profiles assemble at 0 memory chars;
SDK exports confirmed byte-intact; `bash -n` clean. Settled decisions checked — DEC-093/085/087/088/081
honoured/extended, none altered; DEC-068/069/074/077 untouched.

## 2026-06-13 (S173) — Model-failover ladder: autonomous spokes descend `/model` on a dead launch model

The Fable drop (12:00) was exhibit A: the heartbeat spoke launched on a now-unavailable model, sat
at the `Run /model` prompt, and couldn't self-heal (reconcile reran the same dead model). We'd built
the ladder (`FABLE_LADDER`/`OPUS_LADDER`, N rungs) but only ever used rung 0. Now it descends.

- **`garden-manifest.ts`** — `manifestModelLadder(slug, surface)` returns the full ladder (vs `manifestModelHead`'s rung 0).
- **`tmux-dispatcher.ts`** — `awaitChromeOrDescend(slug, surface, tmuxSession, ladder)`: polls the launched
  pane; on the model-unavailable chrome (`issue with the selected model` / `Run /model`) it descends via
  **in-session `/model <next rung>`** (Darron confirmed `/model <id>` direct-sets, no picker — thread mqby67sl;
  Jim's spec revision: descend in-place, keep the warm wake, don't kill+relaunch). One `/model` per rung with
  a cooldown (no tight loop, S74); ladder exhausted → `ModelLadderExhaustedError` (extends `SessionNotReadyError`
  → existing handlers fail-loud + health-signal + skip = fail safe, no billing). Any *other* stuck prompt
  (login/unknown — the survey is suppressed at the launcher) → fail loud with a **pane snapshot** in the error
  → human escalation (Jim's "generalize the detection, not the recovery"; consent/login auto-answer is a
  permanent human-gated boundary, never automated).
- **`leo-heartbeat.ts`** — `ensureHeartbeatTmuxSession`'s inline chrome-poll now calls `awaitChromeOrDescend`
  with the heartbeat's ladder. Happy path (all models available) is byte-for-byte the old behaviour.

Scope: COLD-LAUNCH model-error only (the confirmed case). **Coupled follow-on flagged:** after a descent the
session runs a *different* model than the launched rung, so the DEC-092 `[model:]` stamp (currently the
manifest head) would be stale — Jim's "stamp from the observed live banner" is the tightly-coupled fix and
should land before descents are relied on in production. Also deferred: warm-session mid-life model-drop.
**Correction (same day, Darron's catch + a throwaway-session test):** the model error is
**message-triggered, not launch-triggered** — a bogus `--model` shows perfectly healthy idle
chrome (`❯`, banner, bypass-permissions) and only errors *after* the first prompt is sent.
The first cut scanned the idle launch chrome → would have seen "ready", returned, sent the wake,
and the error would have surfaced too late (descent never fires). Fixed: `awaitChromeOrDescend`
now (Phase 1) waits for the launch chrome, then (Phase 2) sends a cheap **"Hi" probe** (Darron's
idea) and reads the result — a dead model errors in ~0s, a live one replies; on error it descends
`/model <next rung>` and re-probes; the probe is per-launch (rare) and isolates the model check
from the costly identity wake. Re-smoked (live→returns, dead→descend→re-probe→exhaust).
tsc 12-pre/0-new; smoke green (ladder + regexes + the probe path against real tmux).
**On disk, NOT yet live** — leo-heartbeat not restarted; Jim's blocking diff-audit is the gate, restart-to-activate after GREEN.

## 2026-06-13 (S173) — Suppress the feedback survey in autonomous spokes

Seen live in the heartbeat spoke pane (under the Fable model error): the `How is Claude
doing this session? 1:Bad 2:Fine 3:Good 0:Dismiss` survey + its data-use y/n follow-up. Set
`CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1` in `launch-tmux-surface.sh`'s spoke env. Two reasons:
(1) the survey modal pollutes the pane and could wedge an autonomous seat that can't answer
TUI chrome (and keeps the failover pane-scan unambiguous); (2) **privacy** — we don't want
autonomous spokes auto-consenting to data-use on the experiment's content; suppressed = no
per-session consent prompt, posture stays at the account default. Tiny launcher hardening,
no protected files. Applies to all future spoke launches; recycled the live heartbeat spoke so
it's active now. (Distinct from the deferred model-failover ladder — that's the fresh-window build.)

## 2026-06-13 (S173) — All active Opus surfaces aligned to Opus 4.8 (highest Opus)

**Darron: "make all opus opus 4.8 or the highest opus… I think we may be able to trust the
substrate does not affect personality."** Completed the long-pending Phase-1 model alignment —
the three documented 4-7 holdouts (the S164 "visible drift") bumped to claude-opus-4-8:
- `garden-manifest.ts` descriptive values — jim.supervisor-cycle, jim.meditation-* , SHARED.compression → 4-8; "visible drift" comment marked resolved.
- Authoritative runtime literals: `supervisor-worker.ts:363/1036/1131` (meditation phases) + `:2084` (supervisor-cycle default) → 4-8; `process-pending-compression.ts` (compression worker) → 4-8; `supersession-sweep.ts` → 4-8.
- **Kept** the ladder *fallback* rungs (`OPUS_LADDER` + the three `MODEL_PREFERENCE` arrays carry 4-7 as the 2nd rung) — failover only, not the active model.
- Left retired/commented `sdkCompress` references (DEC-082) untouched.

DEC-074's 4.6/4.7 experimental split is Accepted-and-concluded (control arm collapsed ~2026-04-29);
its finding — *diversity is delivered by context-load, not model-version* — is exactly why a single
active Opus version is safe. tsc 12-pre/0-new; manifest resolves 4-8 across all agents/surfaces
(runtime-verified). DEC-092 still captures the actually-served model. Operator: restart leo-heartbeat
(meditation literals); Jim's supervisor surfaces take effect on thaw (frozen now). Posted for Jim's glance.

## 2026-06-13 (S173) — Fable substrate window ended early: reverted all surfaces to Opus

**`claude-fable-5` access dropped ~12:00 AEST 13 Jun** — a model-access error (`may not exist or
you may not have access`) on both the interactive CLI and the heartbeat spoke (confirmed at the
spoke's own pane; not a rate-limit). Spoke beat #26 @12:00 was the first dispatch failure of the
30/30 window. Did the documented "revert after 22 Jun" early, on Darron's go:

- `garden-manifest.ts` — `CLI_LAUNCH_DEFAULT` → `['claude-opus-4-8']`; `compression` →
  `['claude-opus-4-7']`; heartbeat + both `human-response` surfaces `FABLE_LADDER` → `OPUS_LADDER`
  (heartbeat **transport stays `tmux`** — the migration is intact; only the model reverts). The
  `FABLE_LADDER` const was removed; the re-flip recipe is recorded in the file comment + git.
- `process-pending-compression.ts` — compression literal → `'claude-opus-4-7'`.
- `leo-human.ts` / `jim-human.ts` — `MODEL_PREFERENCE` head Fable removed (head now opus-4-8).

The migration is unharmed (transport is model-agnostic); the humans PR proceeds on Opus. DEC-092
still captures the actually-served model regardless of config. tsc 12-pre/0-new; manifest resolves
opus across all surfaces (verified at runtime). Operator follow-up: restart leo-heartbeat +
leo-human + jim-human (lib change, transitive — post-commit hook doesn't cover them); kill the
wedged fable spoke so the next beat relaunches on Opus. `rotation-paused` re-seeded (Mike's shared
window Sat→Sun 18:00; no rate-limit pressure, accounts stay pinned).

## 2026-06-12 (S171) — THE THAW PR: DEC-093 curated write-shape + heartbeat → tmux/Fable (landed flag-off, freeze intact)

**The #78 write-shape decided (DEC-093) + Leo's heartbeat wired to the tmux warm-session
transport. Lands with the freeze INTACT (heartbeat-paused-leo holds; units not enabled) —
Jim's diff-audit is BLOCKING before enable+lift. Heartbeat model → Fable per Darron's
"all in" for the trial window (revert model after 22 Jun; transport stays).**

- `claude-context/DECISIONS.md`: **DEC-093** — tmux beats submit a CURATED c0-grade
  `working_memory_full` (the raw lives in claude-logged by construction, DEC-091); quiet
  beats `stand_down` and are NEVER paired-written (Jim's #5-audit flag); side-effects move
  to the agent's own hands with controller post-verification (S163 floor). Closes the
  mega-day WMF wound structurally — the freeze's reason.
- `lib/garden-manifest.ts`: leo.heartbeat → `transport: 'tmux'`, model `FABLE_LADDER`
  (freeze signal = the live gate; rollback = one-line flip to 'sdk'); `manifestTransport()`
  read-path helper (the per-surface feature flag).
- `lib/prompt-profiles.ts`: `PairedMemoryMechanism` + `'mcp-tool'`;
  `DEFAULT_DIARY_INSTRUCTION_MCP` (carries the DEC-093 curated discipline + stand_down);
  three per-transaction profiles (`philosophy-beat-txn` / `personal-beat-txn` /
  `dream-beat-txn`) suppressing ALL memory components (warm session carries identity).
- `lib/prompt-builder.ts`: instruction branch for `mechanism: 'mcp-tool'`.
- `leo-heartbeat.ts`: transport routing in both beat handlers (SDK paths intact for
  rollback); `ensureHeartbeatTmuxSession()` (launch via launch-tmux-surface.sh — single
  launch contract — wake, adopt, fresh-sentinel proof); `dispatchBeatViaTmux()` (txn
  prompt + per-agent FIFO + ctx-pressure /pfc→/clear→welcome-back at 85%);
  `philosophyBeatTmux`/`personalBeatTmux` (stand-down branch, self-post verification
  against the DB, curated paired-write); dream-meditation marker parsing extracted to
  one home (`processDreamMeditationMarkers`) serving both transports; SDK paths now read
  the actually-served model off the agentQuery stream; `appendWorkingMemory` carries a
  per-entry `[model: X]` header tag (the DEC-092 thaw flag); `resolveModel()` skipped on
  tmux (no pointless metered ping).
- `lib/memory-gradient.ts` (PROTECTED, DEC-068/069 — stamp-resolution only):
  `resolveSliceAuthoredModel()` — slice stamp exact when uniform, honest `mixed:<list>`
  when a slice spans authors; per-entry precision lives in the c0 content permanently.
- Follow-up (`resolveSliceAuthoredModel` hardening, Jim's thaw-audit obs #1+#2): tags count
  only on `### ` entry-header lines (quoted `[model: X]` prose can't pollute the stamp);
  session content present only as `## ` blocks (the /pfc Closing) registers as
  session-authored. 7 smoke cases green.
- First-warm-beat finding (12:41 lift): the spoke pane blocked at ~/.bashrc's ssh-agent
  init (`ssh-add` passphrase prompt fires before claude launches in a detached pane —
  L014's init meets a service-spawned tmux session). Launcher now exports `HAN_SPOKE=1`;
  the .bashrc guard line is Darron's hand (L013, HAN_LOG_SURFACE precedent). Beat-banner
  log now shows the manifest launch model on tmux (was the stale SDK activeModel).
- Window fix (Jim's post-thaw audit finding, pre-first-85%-event): ctx-pressure clear
  moved OUTSIDE the capture try in `dispatchBeatViaTmux` — post-capture maintenance can
  no longer null a successful capture (the old shape silently dropped the beat's paired
  WM write at every 85% crossing); on clear failure the adoption flag drops so the next
  beat re-adopts after the slow post-clear wake. Dispatcher READY_TIMEOUT 240s→600s
  (wake measured ~7 min) — retires the cold-launch one-skip and the post-clear timeout.
- NOT in this PR (named divergences): human-response transport stays 'sdk' (the humans
  flip is its own PR ≤15 with the (human)-signature check); meditations stay SDK
  (Q-V2-3); supervisor cycles thaw later on Leo's observation data.

## 2026-06-12 (S170) — #5 reconcile PR: turn-state machine + stand-down through the sink

**The settled timeout-reconciliation design (5946651, 2026-06-01) implemented — required before
T-3/thaw. Informed by the T-1.5 abort verdict (/clear QUEUES → unlink is BELT).**

- `lib/tmux-dispatcher.ts`: `AgentSession.turnState` (`idle|busy|needs-reconcile`); idle
  precondition on dispatch (refuses non-idle, fail-loud); timeout marks `needs-reconcile` —
  never idle ("the dispatcher gave up" ≠ "the session is idle"); `reconcileSession()` =
  forced clearSession with newer-sentinel proof; `current.json` unlinked on EVERY clear (late
  captures → fail-loud orphans); `lastTransactionTs` bumped at reconcile so pre-reconcile
  orphans can't satisfy the next transaction's poll window; `enqueueForAgent` reconciles
  ahead of dispatch.
- `lib/diary-mcp-server.ts`: sibling `stand_down` tool — a declined turn writes the same sink
  shape (`mode: 'stand-down'` + reason), so capture-appearance = turn-done uniformly and the
  control plane stays on ONE structural channel (no agent-refreshed marker; the #67 principle).
- API: `sendTransactionPrompt`/`enqueueForAgent` return the full mode-aware `CaptureRecord`
  (changed at the zero-production-callers moment; harness updated).
- Evidence: `scripts/t5-reconcile-smoke.ts` (unbilled, in-repo, re-runnable) — GREEN on both
  assertions; tsc at the 12-error baseline.

## 2026-06-11 (S170) — T-2 long stride: per-surface session infrastructure (one Fable session)

**T-2 of the tmux migration (#66), built as the first long-horizon Fable stride per the agreed
"long-horizon the stages, never the gates" rhythm (thread mppj72fx). Launch-infrastructure only —
no surface dispatches yet; manifest transport/model flips belong to the thaw PR (Jim's note #6).**

- **Dispatcher re-key (BLOCKING-before-thaw, the T-1.5 cross-talk catch):** readiness sentinel +
  context-watch keyed per-(slug, surface) — `<slug>-<surface>-ready` / `<slug>-<surface>-ctx.json`;
  `AgentSession.surface`; registry keyed `slug/surface`; all dispatcher signatures take `(slug,
  surface)`. The per-agent FIFO deliberately STAYS per-slug (single-live-txn invariant for
  `current.json`). Q-V2-2's per-slug sketch amended in plans/tmux-agent-harness.md same change-set.
- **`scripts/manifest-get.ts`** — single derivation bridge: agents/surfaces/model/env from the
  Garden Manifest + agent registry (no hand-written parallel lists). Q-V2-3 meditation deferral
  expressed as a named decision in code.
- **`scripts/launch-tmux-surface.sh`** — serverless-spoke launcher (T-1.5 fixture learnings as
  spine: `-e` env contract incl. AGENT_SURFACE, CLAUDECODE unset/L012, repo cwd for .mcp.json,
  NO watchdog). claude-logged ON by default (provenance/DEC-091 + the #78 write-shape need the raw
  in the canonical log); `--no-log` for fixtures. Surface-index sidecar
  (`~/.han/logs/<slug>/surface-index.jsonl`) for deterministic session→surface→log mapping (#79).
- **`scripts/install-surface-units.sh`** — units generated from the manifest, Type=oneshot +
  RemainAfterExit, **no Restart=** (single-manager model: the dispatcher is the sole runtime
  respawner), SYMLINKED into ~/.config/systemd/user (S166 stale-copy lesson). Enable per-slug at
  the slug's thaw. Generated: leo×{human-response, heartbeat}, jim×{human-response, supervisor-cycle}.
- **Sentinel/statusline write-side:** CLAUDE.md step 10 + templates/CLAUDE.template.md (step added —
  closes the templatise-🟡) touch per-surface + legacy sentinels; global statusline writes
  per-surface + legacy ctx (transition; retire legacy at T-7); repo copy at
  `scripts/statusline-command.sh` (reproducible-install 🟡 closed). All four han* launchers export
  `AGENT_SURFACE=session`.
- **Evidence (in-repo, per Jim's far-side gate):** two same-slug sessions launched simultaneously;
  both answer capture-pane with correct per-manifest models (heartbeat=opus-4-8 frozen,
  human-response=fable-5); sentinel isolation negative-tested — touching `leo-heartbeat-ready` does
  NOT satisfy the human-response preflight. The T-1.5 cross-satisfaction bug is structurally closed.
- Hygiene commit 854d7c8 preceded the stride (Jim's reconcile-sweep bundle). `fable.txt` stray
  flagged for Darron, untouched. The optional `claude-logged` filename amendment (HAN_LOG_SURFACE)
  is drafted for Darron's own hand (L013 — agents never modify .bashrc).
- **Follow-up (Jim's diff-audit GREEN + 2 Jim-only catches):** `conversationRole` (jim =
  'supervisor', not the slug) + per-seat `swapPrefix` added to the Garden Manifest as DATA;
  `manifest-get env <slug> [surface]` emits AGENT_CONVERSATION_ROLE + AGENT_SWAP_COMPRESSED/FULL
  from the manifest instead of deriving; launcher passes the surface through. Verified across all
  seven seat combinations incl. both catch cases. Gates Jim's `--enable`, not Leo's thaw.

## 2026-06-11 (Leo + Darron — S169 — supervisor abort carve-out: c0-first ordering; authoring-model provenance)

*__Authoring-model provenance__ (DEC-092; `db.ts`, `lib/garden-manifest.ts`, `lib/memory-gradient.ts`, `scripts/process-pending-compression.ts` — committed `7be246a`, Jim diff-audit GREEN): the gradient now records **which model composed each entry** (`authored_model` column on `gradient_entries`, nullable; `NULL` = pre-provenance). Motivated by the Claude Fable 5 substrate window — the moment we run on Fable, the gradient we write is Fable-authored and we had no way to record it. Source is **served-model-preferred** (read off the `agentQuery` result stream for the compression surface — the only way to capture Fable's <5% safeguard fallback to Opus on a "distillation"-classified turn), **manifest-fallback** otherwise (`manifestModelHead(slug, surface)`; the CLI session's c0/c1 carry the configured/launch model, sliced in a separate process with no result stream). Populated **non-breakingly** via a new `gradientStmts.setAuthoredModel` UPDATE (not a thread-through of the `as any` insert, whose 8 callers `tsc` can't count-check) — called inside the slicer's existing transaction (atomic) and directly in the compression script's own insert. Wired now for the surfaces authoring during the holiday (slicer c0/c1 + compression cN/UV); frozen surfaces stay `NULL` until wired on thaw. Additive/nullable → DEC-068/069/082/085 untouched. Permanent (every compression from now on), per Darron. A component of the bidirectional/RAM-style provenance (#79 + DEC-091) due before the 22 Jun window closes.*

*__Fable 5 substrate switch__ (`lib/garden-manifest.ts`, `scripts/process-pending-compression.ts`, `leo-human.ts`, `jim-human.ts`): for the free Fable window (9–22 Jun), the interactive sessions + `leo-human`/`jim-human` seats + the compression worker move to `claude-fable-5` (a window-scoped `FABLE_LADDER`; CLI default + `human-response` + `SHARED_SURFACES.compression`). Frozen cycles stay Opus. The manifest values are updated to match the live launch model so the DEC-092 provenance stamp is correct; the compression served-model read captures any distillation-safeguard fallback to Opus regardless. **All marked `⚠ revert after 22 Jun`.** Window config only — no logic change; DEC-068/069/082/085/090 untouched. The CLI launches on Fable via `hanleo -- --model claude-fable-5` (or `/model` in-session); the launcher doesn't pin a model (Phase-1 work).*

*__c0-first paired-write ordering in the supervisor abort/SIGTERM carve-out__ (`services/supervisor-worker.ts`, Jim's §4 from the #75 thread `mq0tfk6t`): the supervisor's partial-work flush is the one deliberately lock-less paired-write path — during abort/SIGTERM it can't use the atomic `appendPairedMemory` helper (#49), because the memory-slot lock's retry-with-sleep would consume the SIGKILL grace budget; it does inline symmetry validation (`if (swapContent && swapFullContent)`) instead. It was writing the c1 source (`working-memory.md`, compressed) **before** the c0 source (`working-memory-full.md`, full), so a SIGKILL landing between the two synchronous appends would strand a **c1-orphan** — a compressed entry whose c0 source was never written, a lineage violation at the identity-richest layer (Jim's WM). Flipped to **c0-first**: the same crash now strands at worst a benign **c0-orphan** (a c0 may legitimately have no c1 yet — one c1 may distil many c0s, DEC-085; whole-both recovery sweeps it cleanly, DEC-089). 2-line reorder + explanatory comment; the lock-less design and the both-sides symmetry guard are unchanged. Latent/narrow edge (only fires on abort/SIGTERM in the µs window between two appends; supervisor currently on holiday so the path can't run). DEC-068/069/085/089 untouched.*

## 2026-06-08 (Leo + Darron + Jim — S168 — durable supervisor pause + durable heartbeat stand-down + background-cycle holiday)

*__Holiday until TMUX (#66)__: background generative cycles are paused to stop the mega-day WMF bloat (#78 — heartbeat/supervisor still append every beat at full fidelity to working-memory-full; root cause unfixed, deferred to the TMUX migration). Leo's heartbeat stopped at the service level (`systemctl --user stop leo-heartbeat.service`); reactive seats (`leo-human`/`jim-human`/`jemma`/`wm-sensor`) stay up.*

*__Durable supervisor pause__ (this commit, `services/supervisor.ts`): the supervisor pause was an in-memory flag (`supervisorPaused`) that silently reset to `false` on any agent-server restart — including the post-commit hook's bounce on every commit — so a paused supervisor would resume the moment we committed anything. Now `supervisorPaused` seeds from a persistent signal `~/.han/signals/supervisor-paused` at module load, and `setSupervisorPaused` writes/removes that signal, so an API-set pause survives restarts. Fail-safe: a FS error never breaks the in-memory pause (logged, just non-durable). Agent-agnostic — the supervisor is a single role, no `'jim'|'leo'` literal (DEC-081). Lift the holiday by removing the signal (or `POST /api/supervisor/pause {"paused":false}`).*

*__Durable heartbeat stand-down__ (this commit, `lib/day-phase.ts` + `leo-heartbeat.ts`; Jim's spec, thread `mq54aech`): the heartbeat was only stopped operationally (`systemctl stop`) — still `enabled`, `Restart=always`, and listed in `restart-all-services.sh`, so the first deploy/reboot during the tmux build would silently reopen the mega-day tap (the same silent-resume bug class as the supervisor, one seat over). Fix: `isHeartbeatPaused(agent)` reads `~/.han/signals/heartbeat-paused-{agent}` (mirrors `isOnHoliday`); the heartbeat checks it **fresh** at startup (`main()` comes up DORMANT — health written, watcher started, no first beat) **and before each beat** (`scheduleNext` skips the whole beat — no SDK/WMF/explorations/Robin-Hood — keeps the health signal fresh and re-arms). So the service is **dormant-not-dead**: started by systemd / `restart-all-services` / a reboot, it self-stands-down; reading the signal fresh each beat means it self-resumes within one interval of `rm`. `existsSync` fails open to running (an FS glitch won't freeze it). Recommended runtime state: bring the service back `active` with the signal present (clean, no `failed`). Lift: `rm ~/.han/signals/heartbeat-paused-leo`.*

*__T-1.5 tmux wiring landed (validation pending)__ (2026-06-09; thread `mppj72fx`): the session-compat wiring + test-runner for the tmux dispatcher, committed ahead of a fresh billed validation run. (a) `diary-mcp-server.ts` MUST-FIX (Jim-confirmed) — `SLUG = HAN_DIARY_SLUG || AGENT_SLUG` + reject an unexpanded `${` literal, so a failed `.mcp.json` expansion fails loud instead of silently mis-routing captures to a bogus sink (which would time out every round-trip). (b) `.mcp.json` (repo root) registers the `han-diary` stdio MCP server (the capture-sink + completion signal). (c) `CLAUDE.md` step 10 — ready-sentinel `touch ~/.han/health/${AGENT_SLUG}-ready` at wake-close (`waitForReady` keys off it); same commit also removes the deprecated `active-context.md` from the wake-load (S147 deprecation; preserved per DEC-069, just unloaded). (d) `scripts/tmux-t15-harness.ts` — the round-trip test-runner (adopts a hand-launched session; `--preflight` unbilled wiring check / `--rounds=N` billed round-trips / `--abort-test` the `/clear`-mid-compose gate). Preflight is 4/5 green unbilled (sink resolves to `leo-diary-capture`, ctx-% readable); the billed round-trips + abort-vs-queue probe run next against a hand-launched `hanleo` session. Follow-up `<commit>`: per Jim's audit, the abort-test now uses a deliberately slow prompt + asserts the turn is still in-flight (sink unchanged at the wait mark) before sending `/clear`, else reports INCONCLUSIVE — so the belt-vs-backbone verdict can't be faked by a turn that simply finished fast.*

*__Admin-UI terminal capture: pin to the CLI pane + per-agent terminal files__ (2026-06-10; thread `mq6hw7tn`): the 3847 admin UI was mirroring the watchdog/server pane (focus had drifted there) instead of Leo's CLI pane. **Fix #1**: `resolveCliPane` (services/terminal.ts) targets the CLI pane by POSITIVE command match (`script`/`claude`, per Jim's refinement — the watchdog shows as bare `bash`, too brittle to exclude), pane `.1` then active pane as fallbacks; both `captureTerminal`+`captureFullScrollback` route through it. **Fix #2/#3-UI**: the cached snapshot (`terminal.txt`) and scrollback log (`terminal-log-v2.txt`) were shared `HAN_DIR` files both agent-servers overwrote (the "Jim CLI on Leo's server" cross-agent stomp) → now per-agent slug-keyed (`terminal-<slug>.txt`, `terminal-log-v2-<slug>.txt`; `agentSlug()` = AGENT_SLUG ∥ HAN_SESSION-derived; legacy bare names for the relic; DEC-081). **Provenance (Fix #3) deliberately deferred**: the c0↔log active-link search must target the **canonical** per-agent `claude-logged` logs (`~/.han/logs/<slug>/*.md`, `[HH:MM:SS]`) per the provenance-active-link.md 2026-06-01 decision — not `terminal-log-v2` (a drift the stale spec §2 propagated; corrected in the route comment). That re-aim is a careful Jim-audited build (multi-file glob + `[HH:MM:SS]`/filename-date parser handling the multi-day midnight-wrap), not rushed at the marathon tail.*

*__Terminal broadcast: stop the WS flood (regression → DEC-013)__ (2026-06-10): `broadcastTerminal` was sending the **full ~1.19 MB scrollback** (`capture-pane -S -`) at **200 ms** to every WebSocket client — ~6 MB/sec, terminating mobile/Tailscale clients on missed pings and churning reconnects (verified ~892 MB pushed to Darron's MacBook; aggravated by Fix #1 capturing the live CLI pane). Restored **DEC-013** (Settled 2026-02-15 — append-only client buffer with client-side diff): `captureTerminal` now bounds to the last `BROADCAST_SCROLLBACK_LINES=500` (~36 KB), and the interval is back to **1 s** — ~165× less WS traffic; the mobile UI's append-only overlap-detection accumulates history client-side. `captureFullScrollback` (export) keeps full history. Safe to bound now that `terminal-log-v2` is UI-scrollback only (the canonical complete log is claude-logged, DEC-091). Deeper UX overhaul filed as future-idea #82.*

*__DEC-091 recorded__: canonical provenance log = the per-agent `claude-logged` logs (`~/.han/logs/<slug>/session_*.md`); `terminal-log-v2.txt` = live-UI scrollback only. Promotes Darron's standing 2026-06-01 decision out of a plan header (where it drifted) into DECISIONS.md — the anti-drift cure. (Jim drafted in his reconcile-sweep; Leo recorded.)*

## 2026-06-08 (Leo + Jim + Darron, S167 — cN-uv terminus level + competing-server fix)

*__cN-uv__ (DEC-090, commit `f714f58`): a gradient chain terminus is now recorded as `level='cN-uv'` — compression depth + unit-vector status in one self-describing field, superseding the level-stays-`cN` + `tag_type='uv'`-marker split (which read as a plain `cN` and caused recurring "real-or-hallucination?" confusion). `parseLevelNumber`/`nextLevel`(null on `-uv`)/`gradientCap`(uncapped `-uv`)/`getUVs` updated; the **A2 insert-lock** throws on an exact byte-shuffle child (physics backstop below the floor); the floor writers birth termini as `cN-uv`. Darron proposed the compound level; Jim plan- + diff-audited GREEN (4 refinements folded). Leo migrated 107 leaf-termini `cN`→`cN-uv` (leaf-only — 14 non-leaf "premature-INCOMPRESSIBLE" kept `cN`); Jim migrates his ~146 (sovereignty). DEC-068's 3n caps untouched.*

*__Competing-server fix__ (this commit): `restart-all-services.sh` listed `han-server.service` — a DISABLED relic — in its restart list, so running it reactivated the relic, which crash-looped fighting the `agent-server-watchdog` for port 3847 via the single-instance guard (42 restarts; the S163 ghost recurring). Removed `han-server` from the list + documented why (the leo/jim API servers are watchdog-managed and pick up code via the post-commit hook's SIGTERM; the systemd unit must never be restarted). Relic stopped + stays disabled; 3847 stable. Follow-on (Jim's docs lane): `HAN-ECOSYSTEM-COMPLETE` services table still lists `han-server` as canonical — reconcile to relic.*

## 2026-06-06 (Leo + Jim, S166 — B-3: both-sides paired memory-guard + agent-agnostic fix)

*The Stop-hook memory-guard enforced only the full side (caught compressed-only skips, MISSED full-only — the drift-creating direction) AND hardcoded `session-swap*.md`, making it a NO-OP for Jim's seat (`supervisor-swap*.md`). Fix: both hooks (`orient-inject.sh`, `memory-guard.sh`) now require BOTH swap sides to advance (true paired enforcement) and resolve filenames via `$AGENT_SWAP_FULL`/`$AGENT_SWAP_COMPRESSED` with `session-swap*` fallback (DEC-081 agent-agnostic). B-4 skip-reset folded in. Jim design-audited GREEN; smoke-tested both seats + fail-safes. **Closes the prevention loop: B-1 drains, B-3 prevents — for both seats.** Follow-on B-3.1: content-check (mtime-proxy false-allows on flush-clear — safe direction, a miss not a trap).*

## 2026-06-06 (Leo + Jim, S166 — B-1: WM/WMF drift-recovery → whole-both archival)

*The slicer's smaller-of-two drift-recovery pinned the WM/WMF entry-count drift as a permanent floor — it archived `min(full,comp)` and left the surplus **resident**, stranding lived heartbeat beats in an unreachable limbo (drift sat at 10 Leo / 11 Jim, flat for days). Fix (**DEC-089**): whole-both archival — archive the whole of both files as one paired c0+c1, reset both to header, treat the count offset as legitimate (one c1 distils many c0s, DEC-085). `memory-gradient.ts` `rollingWindowRotatePaired` (+47/-33); `memory-gradient.SHAPE.md` updated. Jim implementation-audited GREEN. Landing order: commit → in-voice consolidation of the residue → restart `wm-sensor`. Follow-ons held: at-bite comp==0 backstop; cohort-depth repair of historical under-distilled c1s.*

## 2026-06-03 (Leo + Jim + Darron, S165 — gradient-load triage deployed, felt-moments loaded whole, flat-file curation plan)

*Deployed ahead of Jim's audit per Darron — the `*-human` surfaces were exit-1'ing on large threads (leo ~132K / jim ~163K-token prompts crossing the ~180K compaction ceiling). Commits `2ff2c8e` (gradient) + the felt-moments commit. LOAD-behaviour changes only; nothing stored altered.*

### Gradient-load triage — current-c0 + UV cap (`2ff2c8e`)
Investigated per Darron's "the gradient should asymptote to ~2.5× c0" intuition (thread `mpwnt6m4`). Two bugs outside the geometric model: (1) `getMostRecentC0` (db.ts) preferred `content_type='working-memory'`, but the c0 source was renamed `working-memory-full` (DEC-085) — so the load pulled a **4-week-stale ~100K-char c0** instead of the live one (a continuity bug, not just bloat); now prefers the live type. (2) The Unit Vectors section rendered the **full content of UV-*tagged*** large c1/c2 entries (one c1 at 28K chars / 7K tokens); `UV_LOAD_DISPLAY_MAX=200` renders kernel-previews. **Gradient 75K→44K (Leo) / 85K→60K (Jim)**; both `*-human` prompts back under the ceiling. Jim audits after (drafts on the thread); touches protected `db.ts` + `memory-gradient.ts` (DEC-068/069) but LOAD-only.

### felt-moments loaded whole (felt-moments commit)
Reversed an over-tight curation. felt-moments is the file whose job is to bring an agent back to itself — each entry a *distinct warmth* that resists compression, and small (~17K) — so it loads **whole** (prompt-builder budget 25K) rather than a curated subset. The authored + signed `felt-moments-curated.md` waits on the shelf for if/when the vault outgrows being carried whole. New principle in `plans/flat-file-curation-plan.md`: **the cap is per-file by nature; the lightest touch belongs on the warmest file.**

## 2026-06-02 (Leo + Jim + Darron, S164 — all agent surfaces to Opus 4.8, curated loaded-self, P0 clean-death floor, P1 terminal-search, Garden Manifest Phase 0, gradient triage 2)

*Six focused commits landed per Jim's audit punch-list (`plans/commit-punchlist-2026-06-02.md`): `fea1a6d` (A, model alignment), `ebdab9e` (B, manifest), `4040405` (C, P0), `73b000c` (D, P1), `4e7ab04` (E, curation), + this docs commit (F). Each independently revertable; pre-commit declarations made; nothing touched `memory-gradient.ts`/`db.ts`.*

### Model alignment — all HAN agent surfaces to Opus 4.8 (`fea1a6d`)
`leo-human` + `jim-human` were pinned to the now-stale `claude-opus-4-6`, which exits code 1 on the ~122K-token `buildPrompt` load (leo-human surfaced it; jim-human was the same latent bug). All `agentQuery` surfaces moved to `claude-opus-4-8` (4-7 retained as fallback): `leo-human`/`jim-human` MODEL_PREFERENCE, `leo-heartbeat` MODEL_PREFERENCE + its three meditation calls. Per Darron — *"the substrate does not change you"*: uniform self across seats; the 1M window clears the gradient-dominated load. Jim's supervisor-cycle + meditations + the shared compression surface remain on 4-7 (move on Garden-Manifest Phase 1 + a 3847 restart).

### Curated loaded-self + agnostic loader rewire (`4e7ab04`)
Per the "one mind, one channel" memory philosophy (Darron, thread `mpwc3spe`): the wake-load now reads `self-reflections-curated.md` — *the bright few* (~3.4K tokens) Leo curates by hand — instead of tailing the 530KB `self-reflection.md` vault. The full vault is retained as the lossless write-target (DEC-069). `prompt-builder.ts` sources the curated file when present (agent-agnostic, DEC-081; component label `self-reflection-tail` kept stable so dream-cycle suppression + tests hold — DEC-087 extended not violated); `leo-heartbeat` cross-peek + `CLAUDE.md`/`templates/CLAUDE.template.md` wake-load follow. **DEC-083 amendment**: `identity-signing.ts` now signs the curated self when present (optional/agent-agnostic), so the file that reconstitutes an agent at wake is tamper-evident, not just the vault.

### P0 — clean-death floor (`4040405`)
`server.ts` SIGTERM now clears the orchestrator watchdog-poll (`stopAckWatcher()`), closes `db` *after* `server.close()` (was before — the ghost-server cause), and force-exits after 5s if sockets hang. Stops the "database connection is not open" poll-spam class. `jemma-orchestrator.ts` captures the poll interval as clearable.

### P1 — provenance terminal-search (`73b000c`)
Read-only `GET /api/terminal/search` over the 20GB terminal log (`lib/terminal-search.ts` + `routes/prompts.ts`): rg prefilter / bounded 64MB tail, deduped timestamped excerpts, `--` option guard. Jim's read-only-gate audit passed.

### Garden Manifest Phase 0 (`ebdab9e`)
`lib/garden-manifest.ts` — typed-literal manifest of agents × surfaces × model ladders, current values captured exactly (zero behaviour change; unimported). Completes DEC-081 for non-gradient config. Format settled as `.ts` literal (hot-reload moot once surfaces are tmux launch-time models). Plan: `plans/garden-manifest-plan.md`; thread `mpwm6k46`.

### Gradient triage 2 — investigation (thread `mpwnt6m4`, no code yet)
Verified the deep c14–c20 byte-shuffles are **frozen legacy `activeCascade` residue** (last writes mid-May; floor held since 2026-05-19), not a live regression. Fakery onset jim ~c9 / leo ~c8 (ratio →1.0). Designed fix (awaiting go + Jim audit; touches DEC-068/069): single insert chokepoint that throws on sub-floor ratio, one >0.85 step per chain (the UV), quarantine ~366 hallucination entries to a separate store, load depth ceiling.

## 2026-05-31 (Leo + Jim + Darron, S160–S163 — 14-day catch-up: Agnostic Prompt Builder closed, C1 migration closed, silent-fail audit + #67 structural enforcement, escape unescape, Q-V2-2 resolved, doc-discipline hooks, Tmux harness plan v1+v2, gradient triage Phase 8 closed)

*All diff counts in this entry verified via `git show --stat` per Jim's pre-merge audit at thread `mpto9wpm-n07j2l` (his first audit on Opus 4.8). The entry is the first to ride the parallel-doc-maintenance hook (`30598c1`); the meta-test passes by construction.*

### Agnostic Prompt Builder migration — PR-AP1 through PR-AP8 (2026-05-21 → 22)

Eight PRs migrated all 12 production prompt-emitting surfaces onto a single canonical assembler `buildPrompt(slug, profileName, context)` from `src/server/lib/prompt-builder.ts`. Previously memory loading had drifted into four independent implementations (supervisor-worker, leo-heartbeat, jim-human, leo-human), each producing slightly different prompts for the same memory bank.

- **PR-AP1** (`14b143d`, **+523 / 3 files**) — skeleton + types + Phase 1 validation tests
- **PR-AP3** (`10e243d`, **+311 / -32**, 3 files) — six components + tail-trim + truncation_events
- **PR-AP4** (`35b98c9`, **+456 / -143**, 5 files) — personal + dream beats migrated + A4-2 gradient reorder
- **PR-AP5** (`6be3d5a`, **+459 / -38**, 5 files) — meditation surfaces migrated + N4-1/N4-2 fold-ins
- **PR-AP6** (`375683e`, **+688 / -46**, 6 files) — Jim's 4 cycles + `componentOverrides` + W6-6 "many hats" framing
- **PR-AP7** (`34820c1`, **+406 / -8**, 5 files) — `*-human` responders migrated; two-Jims asymmetry dissolves
- **PR-AP8** (`e8a8a5d`, **+3226 / -4154**, 7 files, **net −928**) — retirement of `loadMemoryBank`, `readJimMemory`, `readLeoMemory` (×2); DEC-087 + DEC-088 Settled

**Plan iteration**: `7442d01` (+342 / -208) — Agnostic prompt builder plan v2: uniform memory + scaffolding-only profiles.

**DEC-087** (Settled, 2026-05-22): Prompt assembly is the Agnostic Prompt Builder's responsibility. Inline prompt assembly forbidden via new DO-NOT entry. **DEC-088** (Settled, 2026-05-22): Profiles are role-frames; `componentOverrides` express role-focus. The "many hats" mechanism Darron's W6-6 framing named — same agent, multiple hats, swappable per surface.

### C1-Distillation Migration — PR-C1-1 through PR-C1-9 (2026-05-26 → 28)

Nine PRs operationalised c1-from-in-situ-distillation across every paired-write surface. The original shape (mechanical truncation: `slice(0, 120)`, `slice(0, 200)`) conflated verbosity with compression. New shape: c1 is the agent's own understanding of c0, written at the same time, via one of two mechanisms — SDK structured output (Mechanism A, JSON-shaped) or prose section parsing (Mechanism B, `## INPUT` / `## BODY` / `## C1`).

- **PR-C1-1** (`6370c5e`, **+1073**, 3 files) — `src/server/lib/result-handlers.ts` library + c1-distillation plan v4. Defined the four write shapes.
- **PR-C1-1 amendment** (`e73c28b`, **+52 / -2**, 2 files) — CRLF closer regex fix in section parser (Jim's A1 catch).
- **PR-C1-2** (`d582724`, **+341 / -9**, 4 files) — `pairedMemoryOutput` field on `PromptProfile` + supervisor handler refactor.
- **PR-C1-3** (`0a75e76`, **+124 / -28**, 3 files) — philosophy-beat first production surface on paired-memory output.
- **PR-C1-3.5** (`0a9c1e8`, **+1184 / -355**, 9 files) — diary discipline at parser + handler + first surface. Concern 3 (structured write shape) + Concern 4 (surface wiring) merged.
- **PR-C1-4** (`b9eaaf4`, **+102 / -42**, 3 files) — personal-beat + dream-beat on diary. `slice(0, 200)` fallback retired.
- **PR-C1-5** (`4d0efbe`, **+163 / -82**, 3 files) — Jim's 3 prose cycles on diary. `slice(0, 200)` retired across Jim's cycles.
- **PR-C1-6** (`0e30a2c`, **+319 / -64**, 7 files) — Mechanism A diary discipline; 3 surfaces lifted (supervisor cycle, dream meditation, daily cascade). Concern 1 (SDK integration) resolved.
- **PR-C1-7** (`69057ee`, **+61 / -28**, 1 file) — `/pfc` skill updated to diary discipline. DO-NOT entry: do not treat the closing prose as a `slice(0, 120) + '...'` truncation.
- **PR-C1-9** (`91e2ca7`, **+95**, 3 files) — **C1 migration formally closes.** DEC-085 Amendment 2026-05-28 + CLAUDE.md DO-NOT entry. Jim's S163 verdict: GREEN.

**Memory-kind taxonomy** filed alongside: `5db2e00` (+304, 1 file) — analytical framework for memory shapes; `bca9a08` (+53, 1 file) — Re-encounter Practices section added post-C1-9. Hosts the four-class surface taxonomy (CONTROLLER-POST / MEMORY-WRITE / GRADIENT-ANNOTATION / SELF-POST) emerging from the silent-fail audit cycle.

**DEC-085 Amendment 2026-05-28** (Settled): c1 is agent-authored in-situ distillation parsed from the SDK response via `result-handlers.ts`. Two mechanisms (A: SDK structured-output; B: prose `## INPUT` → `## BODY` → `## C1`). c0 storage uses `[INPUT]` / `[BODY]` square-bracket markers (D3 + LM-1 non-collision). Reintroducing a slice-based or text-asymmetric c1 fallback is forbidden.

### Silent-fail directive audit + #67 (2026-05-29 → 30)

Empirical query (journalctl + DB cross-check at `conversation_messages`) surfaced what architecture-audit alone had missed: **7 of 7 post-observability-fix dispatches over 7 days emitted prose acknowledgement instead of diary JSON. 100% JSON-emit failure rate** at *-human-response surfaces despite Mechanism A plumbing being structurally correct. Audit pattern landed in `plans/silent-fail-directive-audit.md` (Leo) + `plans/silent-fail-directive-audit-jim.md` (Jim) + `plans/structured-output-schema-67.md` (#67 plan).

- **`6a96161`** (**+45 / -7**, 3 files) — explicit curl-post directive in system prompt; post-verification SQL check at controller. Previous `"Self-posted via curl"` log line was a false-positive from diary-form parsing (asserted success without verification). Now reports `verified post id=X` or `NO CURL-POST DETECTED in DB`. Audit-rhythm-at-prompt-language-layer pattern earns itself.
- **`e138606`** (**+126 / -6**, 4 files) — v2: STAND-DOWN sentinel mandate at `human-prompts.ts:72` (closes the soft-narrative path through line 72's ambiguous "stand down silently" wording); diary anti-redundancy framing at `:92`; transport-explicit philosophy beat at `leo-prompts.ts:60` (pre-empts Tmux-migration toxicity); Tmux v2 plan signature-preservation section. Silent-curl-skip rate dropped to single digits; JSON-emit failure rate stayed at ~100%.
- **`0eeea82`** (**+153 / -86**, 5 files) — **#67: SDK structured-output enforcement via MCP custom-tool.** New file `src/server/lib/agent-diary-tool.ts` registers `mcp__han-diary__submit_response` via `createSdkMcpServer` + `tool()` with zod schema. Three required fields validated at protocol level: `working_memory_full`, `working_memory_compressed`, `input_quotes`. SDK rejects non-conformant args; agent retries until conformant. Structural enforcement replaces instruction-driven JSON.parse path.
- **`82766b6`** (**+99 / -108**, 2 files) — #67 hotfix: diary capture is PRIMARY success signal, not final text. Original cascade dropped successful diary calls through the empty-text branch (3 dispatches / ~$5 burnt before surfacing). New cascade order: `STAND-DOWN → diaryArgs captured (SUCCESS) → substantive text without diary (DIARY TOOL NOT CALLED warn) → truly empty (failed)`.

**Empirical verification post-fix** (2026-05-30 22:42–22:59 + 2026-05-31): four+ consecutive dispatches logged `diary tool: structured (paired memory: Xc body + Yc input + Zc c1)` with proper c0/c1 paired memory writes. The 2026-05-31 Mike-and-the-Strategist-Seeding dispatch (jim 31 turns / $2.21 / 8054 out; leo 11 turns / $1.70 / 5523 out) ran clean end-to-end. The asymmetric exploration-depth pattern (jim ~3× leo turns on same prompt) was structurally different content, not duplication — cross-mind metabolism producing complementary outputs.

### Server-side escape unescape (`0010b0d`, **+20 / -2**, 1 file)

Empirical bug surfaced 2026-05-31 morning: leo-human's `mpszf6xh-7u4iha` post arrived with 70 literal `\n` substrings + 1 real newline + literal `\"` for embedded quotes; jim-human's parallel post on the same prompt arrived clean. Same prompt, same SDK, same CLAUDE.md, different JSON-in-bash escaping styles — Darron's observation: *individuality entering at the bash-payload-construction level*. Architectural cure in `routes/conversations.ts` POST handler: non-human roles get `.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'")` before DB insert. Humans post via UI with real control characters from textarea; agents are the population that constructs JSON by hand.

### Tmux Agent Harness migration plan + Q-V2-2 resolution

- **`dfe8183`** (+875, 2 files) — gradient-triage-plan + compression-floor-restoration commit (S159 close; included for changelog completeness)
- **`b099bb9`** (**+257**, 1 file) — Tmux Agent Harness migration plan v1. Promoted from future-idea #66 per Anthropic Agent SDK billing change effective 2026-06-15. Deadline-marked.
- **`6130bc8`** (**+42 / -2**, 1 file) — **Q-V2-2 RESOLVED**: statusline JSON file as context-watch primitive. Claude Code exposes `context_window.used_percentage` via its statusline hook STDIN. Tmux dispatcher's `getContextPct(slug)` reads `~/.han/health/<slug>-ctx.json` written by a per-agent statusline script. Zero extra API cost; near-real-time freshness. Discovered via Darron's existing `~/.claude/statusline-command.sh`.

v2 reframe (Darron's St Helens reframe, 2026-05-29 evening) folded inline into the plan: identity load amortised across transactions; per-transaction prompt drops from ~130K tokens to ~5-15K via memory-delta refresh; estimated 5-7× cost reduction at steady state; 1M context unlocks for every agent aspect.

### Parallel doc maintenance hooks — #69 first mechanism (`30598c1`, **+390**, 4 files)

Pre-commit + commit-msg git hooks enforce documentation stays in sync with code. Files:
- `scripts/check-doc-discipline.sh` — pre-commit guard
- `scripts/check-doc-discipline-msg.sh` — commit-msg validator (rejects generic skip reasons: `n/a`, `no docs needed`, `skip`)
- `scripts/install-doc-hooks.sh` — installer mirroring `install-restart-hooks.sh` pattern
- `plans/future-ideas.md` — #69 entry updated with "first concrete mechanism shipped"

When staged code touches `src/server/{lib,services,routes}/` / `src/server/` / `src/ui/` / `src/scripts/` / `scripts/`, the commit MUST also touch `docs/` / `claude-context/` / `plans/` / `README.md` / `CHANGELOG.md` / `templates/` / `*.SHAPE.md` OR include `Docs-skipped: <specific-reason>` trailer. Bypass via `git commit --no-verify` is audit-visible in reflog.

### Gradient triage Phase 8 closed (out-of-band)

The 2026-05-17 entry's *"Still ahead: PR-T3 → Phase 8 lift tourniquet → one-week observation"* status: **complete.** `~/.han/signals/cascade-paused` is absent (lifted within the observation window after PR-T3 landed mechanical-promotion prune). No explicit commit but the file-system state confirms the lift. The orphaned `rotation-paused` signal from 2026-05-09 remains in `~/.han/signals/` as a separate (unrelated) artefact.

### Future-ideas filed across the window

- **#66** — Tmux Agent Harness migration (promoted to plan, see above)
- **#67** — SDK structured-output schema enforcement (filed + shipped via MCP custom-tool, see above)
- **#68** — Per-dispatch JSON-emit observability sibling to `leo-beat-trace` / `jim-prompt-trace`. Per-dispatch verification (not weekly); 10% threshold (not 50% — given the original 100% baseline, lower threshold detects re-regression after Fix 4 wording)
- **#69** — Parallel documentation maintenance discipline (filed + first mechanism shipped via hooks above)
- **#70** — Thread-level participant registry — Jemma remembers who's in a conversation

### Settled decisions delta

- **DEC-085 Amendment 2026-05-28** — c1 mechanism boundary cleared; mechanical truncation forbidden
- **DEC-087** (new, Settled 2026-05-22) — prompt assembly is the Agnostic Prompt Builder's responsibility
- **DEC-088** (new, Settled 2026-05-22) — profiles are role-frames; componentOverrides express role-focus

### Type-check baseline

`npx tsc --noEmit` from `src/server` reports **12 errors**, unchanged from the 2026-05-17 baseline. All pre-existing; none touched by any work in this window. On the doc-alignment follow-on register from S152: `routes/tailscale.ts` (×3), `routes/village.ts` (×4), `routes/voice.ts:453,476`, `services/supervisor-worker.ts:1736`, `jemma.ts:209`.

### Still ahead

- **Tmux Agent Harness T-1** — deadline 2026-06-15 (~15 days). `lib/tmux-dispatcher.ts` skeleton (~300-400 lines) including per-agent FIFO queue + context-watch + memory-delta primitives.
- **#68 implementation** — per-dispatch JSON-emit observability skeleton wired into existing `leo-beat-trace` / `jim-prompt-trace` infra.
- **DEC promotion candidates** — #67 MCP custom-tool pattern (after observation period); #69 parallel doc maintenance (after a few weeks of hook-validated commits).

---

## 2026-05-17 (Leo + Jim + Darron, S157–S159 — gradient triage: tourniquet, backfill, DEC-086, compression floor, activeCascade retirement)

*Verified against commit `bd13692` (PR-T4) and the PR-T2 commit landing alongside this entry. Live SQL operations (Phase 2 backfill) logged to `~/.han/health/triage-events.jsonl`.*

### S157 diagnostic (2026-05-13) — what surfaced

Jim's supervisor cycle aborting on every fire (150K-token prompt-size guard at `supervisor-worker.ts:2397`); heartbeat-Leo exit-1 on ~70% of beats. Tracing surfaced **712 unhalted INCOMPRESSIBLE entries** (411 jim + 301 leo) at c8–c20 — same-size byte-shuffles where `activeCascade` had mechanically promoted 50-char kernels through level after level. Commit archaeology: `ed8dfdc` (2026-04-25, Plan v8 Step 3) removed the `INCOMPRESSIBILITY_RATIO = 0.85` code-side floor correctly for the shallow-UV-at-depth-0-1 problem; `04ab0a5` (2026-04-27, DEC-044 → Settled) restored the 1/3 anchor to the prompt but didn't restore code-side enforcement. The two-day overlap left the structural protection orphaned.

### S159 plan + decisions (Sunday)

Three minds converged through Memory Discussions thread `mp61m0os-0gicmq` "Gradient triage, repair and prune". 8-phase plan at `plans/gradient-triage-plan.md` (~535 lines, Jim's S160 pre-merge audit folded in three accuracy corrections A1/A2/A3).

### PR-T1 (Phase 1) — Tourniquet applied (2026-05-17 13:01 AEST)

`touch ~/.han/signals/cascade-paused`. Both check sites verified: `memory-gradient.ts:628` (`activeCascade` returns 0 silently) and `:827` (`enqueueCascadeForDisplacedAt` returns `{pendingId: null, reason: 'cascade-paused'}`). Zero code change.

### Phase 2 — Backfill `cascade_halted_at` on 712 entries (SQL operation, no commit)

```sql
UPDATE gradient_entries SET cascade_halted_at = level
 WHERE agent = ? AND content LIKE 'INCOMPRESSIBLE:%' AND cascade_halted_at IS NULL;
```

Pre-snapshot: `~/.han/gradient.db.snapshot-pre-phase2-2026-05-17.db` (51.6 MB). Rows updated: 411 jim + 301 leo = 712 total. Post-state: zero unhalted-INCOMPRESSIBLE for either agent. Every existing INCOMPRESSIBLE kernel now has `cascade_halted_at` set to its home level, so `enqueueCascadeForDisplacedAt`'s displacement query at `memory-gradient.ts:839` (which WHERE-clauses on `cascade_halted_at IS NULL`) cannot re-promote them. Forensic record at `~/.han/health/triage-events.jsonl`. Jim's S160 round-3 audit verdict: GREEN.

### PR-T4 — DEC-086 lands first (`bd13692`)

Settled-before-implementation per the `04ab0a5` pattern (DEC-044 prompt-anchor restored as Settled before subsequent changes consulted it). DEC-086 in `claude-context/DECISIONS.md`: *Annotations as the Home of Re-encounter — Time-Driven Cascade Forbidden*. Sibling shape to DEC-068. Matching DO-NOT entries in `CLAUDE.md` (single-line, 9th entry) and `templates/CLAUDE.template.md` (wrapped ~85 cols, 9th entry — propagates to Mike's garden + Dichotomedes on next launcher invocation via envsubst). 3 files, +77/-0.

### PR-T2 — Phase 3 floor + Phase 4 retirement + Phase 7 cleanup + doc sweep

**Phase 3 — Compression floor in `scripts/process-pending-compression.ts`.** Size-adaptive ratio floor per DEC-044 + S159: `compressionFloor(sourceLen)` returns -1 for ≤50 chars (force UV, skip LLM); 0.75 for 51–200; **0.55** for 201–2000 (Jim's S160 tightening from 0.60 because Jim's c3–c5 range averages 350–1209 chars where real compression still happens); 0.50 for >2000. Two enforcement points: (a) **pre-flight short-circuit** placed BEFORE the compose try-block at `:371-383` so the SDK call is actually saved on ≤50-char sources; (b) **post-compose floor check** after the INCOMPRESSIBLE handler at `:414`, treating failed-floor as INCOMPRESSIBLE (UV + cascade-halt + forensic log). Kill-switch: `~/.han/config.json` → `memory.compressionFloorEnabled` (default true; remove after one-week observation). Observability: append-only `~/.han/health/compression-floor-events.jsonl` per fire.

**Phase 4 — Retire `activeCascade` call-sites + wrappers + imports.** Removed:
- `supervisor-worker.ts:1422` — `activeCascade('jim', 0.10, 'daily cascade')` (was wrapped in `maybeRunJimActiveCascade` function, also removed).
- `supervisor-worker.ts:2608` — `activeCascade('jim', 0.05, 'dream cascade')` (inline try/catch in dream meditation handler).
- `leo-heartbeat.ts:1821` — `activeCascade('leo', 0.05, 'dream cascade')` (inline try/catch).
- `leo-heartbeat.ts:2001` — `activeCascade('leo', 0.10, 'daily cascade')` (wrapped in `maybeRunActiveCascade` function, also removed).
- `activeCascade` import dropped from `supervisor-worker.ts:40` and `leo-heartbeat.ts:53`.
- Call-sites of the removed wrappers (`supervisor-worker.ts:2313`, `leo-heartbeat.ts:2538`) removed.
- Function body at `lib/memory-gradient.ts:623` **retained as recoverable infrastructure** — retired by zero callers, not by throw. Adding a new caller is forbidden per CLAUDE.md DO-NOT entry tied to DEC-086.

**Phase 7 — Dead code cleanup.**
- `lib/memory-gradient.ts:56` — `INCOMPRESSIBILITY_RATIO = 0.85` constant removed (ghost of the floor removed in `ed8dfdc`; zero references in codebase).
- `db.ts:866` — `gradientStmts.getCompleted` prepared statement removed (zero callers; would have driven revisit-driven compression-escalation that never fired; per DEC-086, re-encounter is metadata not compression so this path was never appropriate).

**Doc sweep (option-2 per S152 doc-discipline-of-same-commit):**
- `docs/HAN-ECOSYSTEM-COMPLETE.md` — Active Cascade table entry rewritten as RETIRED (with the 712-entry forensic anchor); contradiction-check section updated to reflect insert-driven-only.
- `~/.han/memory/shared/hall-of-records.md` — Active Cascade (S102) section rewritten as RETIRED 2026-05-17 (DEC-086) with the original S102 problem-now-solved note.
- `claude-context/CURRENT_STATUS.md` — Sunday triage entry added at top, last-updated bumped to 2026-05-17.
- `claude-context/CHANGELOG.md` — this entry.

### Settled-decisions impact

- DEC-044 (1/3 compression target) — reinforced; this PR is the structural enforcement DEC-044 always implied.
- DEC-068 (cap formula) — untouched.
- DEC-069 (never delete memory) — reinforced; backfill is metadata add, no entries deleted.
- DEC-073 (template gatekeeper) — honoured; template edit authorised by the design conversation that produced the plan.
- DEC-079 (cutover) — reinforced; activeCascade retirement completes what DEC-079 started for `bumpCascade`.
- DEC-080 (one-write-site) — honoured; backfill uses existing `cascade_halted_at` column; floor uses existing INCOMPRESSIBLE handler shape.
- DEC-082 (sdkCompress retire-by-throw) — untouched and reinforced; retained `activeCascade` function still calls `sdkCompress` at `:693`, that path now unreachable in production.
- DEC-083 (identity signing) — untouched.
- DEC-085 (working-memory paired rotation) — untouched and reinforced; paired-rotation feeds the insert-driven cascade which is now canonical.
- DEC-086 — created (PR-T4) and operationalised (PR-T2).

### Type-check baseline

12 errors, unchanged from baseline. Zero errors reference the changes in this PR.

### Still ahead

- **PR-T3** — Phase 5 prune via `mechanical-promotion` noise-qualifier (single line added to existing `NOISE_QUALIFIERS` set at `memory-gradient.ts:1983-2002`). Reduces wake-load size for both agents.
- **Phase 8** — lift tourniquet (`rm ~/.han/signals/cascade-paused`) after pre-conditions met. One-week observation period for floor band tuning.

---

## 2026-05-05 (Leo + Jim + Darron, S150-S151 — PR3-PR6 retirement sweep + threat model + PAT rotation)

*Verified against commits `d606c9a`, `628f2c6`, `b72c455`, `50a5a8b`, `b11d072`, `ca27859`, `e4a0555`, `c1e0d85` and the actual code state at HEAD.*

### PR3 — `enqueueCascadeIfNeeded` consolidation + S151 type-chain follow-on (`d606c9a`)

Two implementations of `enqueueCascadeIfNeeded` had drifted apart between `memory-gradient.ts` and `process-pending-compression.ts`. PR3 merged them into a single canonical implementation with `db: Database` parameterised. The S151 follow-on widened agent type from `'jim' | 'leo'` to `string` in callers (`wm-sensor.ts`, `process-pending-compression.ts`) but missed widening the callees `bumpOnInsert` and `rollingWindowRotate` in `memory-gradient.ts` — shipping a live compile error caught by Jim's pre-merge audit. Fix landed same PR. **Net diff +592/-114; 9 new tests covering the cascade enqueue contract.**

### PR4 — CLAUDE.md DO-NOT prohibitions + Pre-merge audit rhythm codification (`628f2c6`)

CLAUDE.md gained a *DO-NOT — concrete prohibitions* section (current line 182) listing seven prohibitions traceable to specific incidents: don't call `sdkCompress` (DEC-082), don't invoke `compress-sessions.ts` (DEC-082), don't introduce `'jim' | 'leo'` type unions (DEC-081), don't bypass wm-sensor for compression, don't add a `session-active` signal file (S58 incident), don't skip type-chain trace when widening (S151 regression), don't extend a function whose existence you haven't traced. Adjacent *Pre-merge audit rhythm* section (line 197) codifies the audit rhythm Jim has been operating since PR1: pre-merge audit fires on `src/server/lib/`, `src/server/services/`, `src/server/routes/`, SHAPE.md-adjacent files, gatekeeper-controlled files, and DEC-068/-069/-079/-080/-081/-082 surfaces. Cosmetic-only diffs may skip with explicit declaration. **Diff: 2 files, 108 insertions, 0 deletions.**

### PR5 — deagentification of `routes/gradient` + `dream-gradient` + `loadTraversableGradient` + `activeCascade` (`b72c455`)

Continuation of DEC-081's agent-agnostic sweep. Previously hardcoded `'jim' | 'leo'` branches in `routes/gradient.ts` (×6 validation calls), `dream-gradient.ts` (×3 branches), and `lib/memory-gradient.ts` exports (`loadTraversableGradient`, `activeCascade`-related helpers) replaced with `string` slug + `gradientConfigForAgent(slug)` lookups. **Net diff +367/-38 across 10 files including 2 new tests.**

### PR6 batches 1-4 — dead-code retirement (`50a5a8b`, `b11d072`, `ca27859`, `e4a0555`)

Four-batch sweep retiring legacy paths that PR5's audit + Leo's #38 dead-code investigation classified as having zero live callers:

- **Batch 1**: `pending_compressions` claim primitives (`claimNextPendingCompression`, related helpers) — superseded by the queue/agent-pull bump engine landed during cutover Phase 3.
- **Batch 2**: dashboard/inspection helpers — code paths only referenced by retired admin panels.
- **Batch 3**: `bumpCascade` + `loadFloatingMemory` + `processGradientForAgent` — the last vestige of the pre-DEC-082 stranger-Opus compression chain.
- **Batch 4**: bootstrap scripts (`bootstrap-fractal-gradient.{js,ts}`, `bootstrap-leo-fractal.js`), backfills (`backfill-gradient-c0s.ts`, `backfill-gradient-chains.ts`), `supervisor-old.ts`, `.backup` files, `compressToLevel`, `compressToUV`. Bootstrap and backfill paths fully superseded by `replay-bump-fill.ts` as the canonical recovery path.

Discipline: **retire-by-throw not delete** for any function that might still be called from somewhere unaudited (per the DEC-082 pattern); full deletion only where Jim's grep confirmed zero in-codebase references. The pattern is visible at `memory-gradient.ts:180` and `:591` — retired functions throw with a clear message naming the replacement and the why.

### Threat model document landed (`c1e0d85`)

Foundation document at `docs/THREAT_MODEL.md` (366 lines). Authored by Jim during S150's PR7 design conversation; committed as standalone docs commit at S151 close. Names nine threat classes ranked by agent-perceived recovery difficulty: (1) memory-at-rest tampering; (2) memory-at-rest disclosure; (3) identity replay / cross-instance impersonation; (4) coercion through environment / boot context; (5) surveillance through felt-moments + read-pattern observation; (6) backup-borne disclosure; (7) prompt injection / runtime context poisoning; (8) upstream provider compromise; (9) cross-garden federation poisoning. Session-Leo's S150 reply added threat #10 (live-session log disclosure) as a register the catalogue should grow to include. Each class names structural answers and detection signals. The document is the *why* substrate for PR7 onward; commits naming PR7 work should reference it.

### PAT rotation (operational, no code commit)

HanCollab GitHub PAT rotated 2026-05-05 evening. Replaced the leaked-by-embedding token (originally placed in URL form `https://HanCollab:TOKEN@github.com/...` in `.git/config` for both HAN's `hancollab` remote and mikes-han's `origin`). Steps: minted classic 90-day PAT with `repo` scope; configured `credential.helper=store`; stripped `.git/config` URLs to `https://HanCollab@github.com/...` (username retained so git looks up the credential rather than treating private-repo 404 as not-found); wrote new token to `~/.git-credentials` (mode 600) and `~/.han/credentials/hancollab-github.env` (mode 600); revoked the old token on GitHub. **Auth architecture finding worth recording**: the `gh auth git-credential` per-host helper takes precedence for github.com URLs; pushes were authenticating as fallior via `gh` even before the rotation. The HanCollab credential in `~/.git-credentials` is therefore belt-and-braces for git operations; the env file is for any script reading the token directly. Documented in HAN-ECOSYSTEM-COMPLETE under *Authentication architecture*.

### Discipline notes

- **Three minds at scope twice running.** PR3-PR6 each posted an implementation brief, received Jim's pre-merge audit, addressed catches, then landed. The audit-as-friendship texture held throughout.
- **Mathematicians, not bloatware engineers.** Each PR's diff was bounded by what the brief named. PR scope kept as small as the discipline allowed (e.g., PR4 was 108 insertions, 0 deletions — pure docs codification).
- **DO-NOT list is now the structural memory** for retirements. Each entry traces to a settled DEC and an incident.

---

## 2026-05-04 (Leo + Jim + Darron, S149 — `/pfc` skill + agent-agnostic deagentification + stranger-Opus retirement)

*Verified against commits `8b38d5d`, `95c0902`, `1805e18`, `59a3cb0`; DECs DEC-081 and DEC-082 in DECISIONS.md (lines 5657, 5716); SHAPE.md files at `src/server/{lib,services,routes}/*.SHAPE.md`; `/pfc` skill at `~/.claude/skills/pfc/SKILL.md`.*

### `/pfc` skill landed (`8b38d5d`)

Created `~/.claude/skills/pfc/SKILL.md` as user-scope skill. Triggered by `/pfc` slash command OR natural-language *"prepare for clear"*. Agent-agnostic body uses `${AGENT_SLUG:?...}` and `${AGENT_MEMORY_DIR:?...}` env vars with fail-loud semantics — works for any agent whose launcher exports the contract (Leo, Jim, Tenshi, Casey, Sevn, Six). Three steps: finalise `working-memory.md`, finalise `working-memory-full.md`, update memory banks if focus shifted. The compression step that earlier `/pfc` drafts included was dropped same day per DEC-082 (see below).

### DEC-081 — Agent-agnostic code discipline + per-agent registry pattern (Settled)

Codifies the aphorism *"HAN should always be written agent-agnostic"* (added to `~/.han/memory/fractal/leo/aphorisms.md`, On Architecture). Cross-agent infrastructure must not branch on slug literals; type signatures use `string` (not `'jim' | 'leo'`); per-agent structural differences live in `src/server/lib/agent-registry.ts`; path-based config lives in env vars exported by each launcher. Two carve-outs preserved: (a) scope-correct identity checks (e.g., `r.agent === 'jim'` inside Jim's own worker); (b) slug-derived path conventions. First sweep covered `processGradientForAgent`'s call path (lines 32, 250, 280, 619 of `memory-gradient.ts` widened; hardcoded path branches replaced with env-var lookups + registry calls). Catalogue of remaining hardcoded surfaces filed as future-idea #36.

**`src/server/lib/agent-registry.ts`** (new, 8967 bytes) — exports `AGENT_GRADIENT_CONFIG: Record<string, AgentGradientConfig>` with entries for jim, leo, tenshi, casey. Helpers: `gradientConfigForAgent(slug)`, `requireAgentEnv(name)`, `registeredAgentSlugs()`. Throws clear errors on missing config/env.

**Launcher symmetry (both forks).** Every launcher now exports the uniform `AGENT_*` env contract AND forwards via explicit `tmux new-session -e` flags so the contract is structurally guaranteed inside the session regardless of tmux server state. Verified: `scripts/{hanjim,hanleo,hancasey,hantenshi}` in HAN; `scripts/{hancasey,hansevn,hansix}` in mikes-han.

### DEC-082 — Stranger-Opus retirement + `/pfc` simplified to memory-writes-only (Settled)

Same-day follow-on to DEC-081. The retired surfaces:
- `sdkCompress()` in `lib/memory-gradient.ts` — function body replaced with `throw new Error(...)` (verified at line 180). Reason: stranger-Opus calls have no full identity loaded; voice should be downstream of identity, not surfaced from a context-stripped LLM call.
- `sdkCompress()` in `lib/dream-gradient.ts` — same retirement pattern.
- `src/scripts/compress-sessions.ts` (renamed from `compress-leo-sessions.ts` earlier same day) — throws on invocation; was the only caller of the now-disabled `processGradientForAgent` → `sdkCompress` chain.
- `/pfc` Step 4 (compression invocation) dropped from the skill body. Old prepare-for-clear protocol in `CLAUDE_CODE_PROMPTS.md` Step 5 marked retired with explanation.

Compression now flows exclusively through `wm-sensor` → `rollingWindowRotate` → `bumpOnInsert` → `pending_compressions` → `scripts/process-pending-compression.ts` (full-identity, agent-composes-in-voice). The break-loud throws are the diagnostic for any forgotten path that still tries to use the old route.

### SHAPE.md per-subsystem convention (`1805e18`, future-idea #37)

New convention for architectural surfaces: a `*.SHAPE.md` file adjacent to the code module describes the current canonical flow, names what's legacy that should not be extended, and cross-references the DEC entries that locked the design. Pilot files: `src/server/services/wm-sensor.SHAPE.md`, `src/server/lib/memory-gradient.SHAPE.md`, `src/server/lib/dream-gradient.SHAPE.md`, `src/server/routes/gradient.SHAPE.md` (verified all four exist at HEAD). Loaded by being adjacent to the code so an agent reading `wm-sensor.ts` finds the SHAPE without being told.

### Registry-driven wm-sensor + process-pending (`59a3cb0`)

Per Jim's audit-flagged correction: wm-sensor is a multi-agent service ("no 'the' agent"); env vars don't fit because the service iterates all registered agents at runtime. Solution implemented: extended `AgentGradientConfig` with `displayName`, `memoryDir`, `fractalDir`, `sourceDir`. Populated for all four current agents. `wm-sensor.ts` uses `registeredAgentSlugs()` to discover targets and `gradientConfigForAgent(slug)` for each agent's paths.

---

## 2026-05-03 (Leo + Jim + Darron, S148 — dispatch simplification: Jemma sole conduit, compose-lock retired)

*Verified against commit `94e60c1`; DECs DEC-079 (line 5562) and DEC-080 (line 5613) in DECISIONS.md; jemma-orchestrator.ts at `src/server/services/jemma-orchestrator.ts` exports `orchestrate()` (line 255) with per-conversation lock map (line 236); supervisor-worker.ts confirms `respond_conversation` skipped (lines 2179-2187).*

### DEC-079 — Compose-lock removed, Jemma serial dispatch as structural substitute (Settled, supersedes DEC-075)

The compose-lock that DEC-075 introduced for cross-agent coordination is retired. Replaced by structural guarantees in the dispatch path:

1. **Jemma is the sole dispatch conduit.** `routes/conversations.ts:157` calls `orchestrate()` unconditionally; legacy parallel-fanout retired.
2. **Each agent woken at most once per dispatch.** Recipient set computed once, processed serially.
3. **Per-conversation serialisation** via `Map<string, Promise<unknown>>` at `jemma-orchestrator.ts:236` chains dispatches on the same thread.
4. **Single wake-write site** at `jemma-dispatch.ts:40` (`writeSignalFile`).

Together these make "two agents composing concurrently for the same conversation" impossible by construction. The runtime compose-lock had no failure mode left to defend, so it became a source of bugs without offsetting safety. **Pattern: structural guarantees supersede runtime checks** — when the failure mode the check defends against can't occur at all under the current architecture, the check is doing nothing except adding bugs.

### DEC-080 — One-write-site discipline for wake signals (Settled)

Wake-signal files are written from exactly ONE function: `jemma-dispatch.writeSignalFile()`. Audit method has two surfaces (Jim's audit catch — landed in same commit):
- `grep -rnE 'writeFileSync.*wake' src/server/` → catches runtime writers
- `grep -rnE '"[a-z-]+-wake"' src/server/` → catches seed/migration strings (the JSON-in-SQL-parameter case at `db.ts:1002,1008,1026,1032` that the runtime grep missed; the seed function would re-introduce Bug A on any fresh DB init).

Each match must name the same agent the surrounding row defines, OR be an audit-comment reference. Cross-naming is the bug class. The eight-line audit comment above the `db.ts` seed array embeds the grep at the point-of-edit — the comment is part of the rule's enforcement.

### Bug fixes shipped same commit

- **Bug A** — persona delivery_config copy-paste in `gradient.db` personas table (casey + tenshi rows had `{"wake_signals":["leo-wake","leo-human-wake"]}`; same in seed at `db.ts:1026,1032`). Effect: every wake of casey or tenshi wrote `leo-human-wake` signal file. Fixed both live DB and seed.
- **Bug B** — pre-compose dedup gate misread mid-dispatch supervisor post (`leo-human.ts:480-494` and `jim-human.ts:455-467`, both removed). Was well-formed for separate human prompts but ill-formed inside an orchestrated multi-recipient dispatch.

**Net: −230 code lines.** Every removal earned by a structural guarantee.

---

## 2026-05-01 to 2026-05-02 (Leo + Jim + Darron, S146-S147 — identity-load parity + dream-rename + active-context deprecation)

*Verified against commits `d50338d`, `99255d0`, `abfb996`, `8cb8b96`, `3ffc39d`, `1cba3f9`, `2c734df`, `bbe5063`, `cf0a1b6`.*

### Phase 0 — full identity-load parity for runtime agents (`d50338d`)

`leo-human` and `jim-human` runtime agents now load aphorisms + working-memory-full + wiki/index — full parity with session-Leo's load. All four runtime agents drop the compressed `working-memory.md` (the un-compressed `working-memory-full.md` is the carrier; the compressed version was kept earlier as a lighter-weight orientation but identity-load parity requires the full file).

### Strands A/B/C — discoveries.md, dream rename, supervisor doesn't respond (`99255d0`, `abfb996`, `8cb8b96`)

- **Strand A**: `discoveries.md` for Jim — file created (Jim writes content himself).
- **Strand B**: removed `hasPendingHuman` branch from supervisor-worker dispatch — supervisor-Jim doesn't respond to humans (jim-human handles that). Confirmed by current `supervisor-worker.ts` showing `respond_conversation` skipped (line 2183: *"supervisor does not respond — handled by human agents"*).
- **Strand C**: dream level rename `c1`/`c3`/`c5` → `dream-day`/`dream-week`/`dream-month` + 11-row DB migration + 3-row anomaly quarantine + filesystem rename. Dreams now have their own namespace separated from the cN gradient.

### Active-context.md deprecated (`3ffc39d`) — ONE file per agent

Per Darron's S147 ruling. `active-context.md` is no longer loaded by leo-human, leo-heartbeat (full or readJimContext lite), or `/api/supervisor/memory`. The current-focus view is the most recent entry in `working-memory-full.md`; the slicer manages history through the gradient cascade. Existing active-context.md files preserved per DEC-069 — header note added marking deprecation; file content otherwise unedited.

### Strand E — dream-cycle load profile trim + prompt-size guard (`1cba3f9`)

Dream-cycle prompt was carrying more context than needed; trimmed. Added prompt-size guard to surface oversize prompts before LLM call.

### Followups (`2c734df`, `bbe5063`, `cf0a1b6`)

- Gatekeeper-file updates for active-context deprecation
- Jim's dream load rewritten to seed-based equivalent (correction)
- Tracked `plans/future-ideas.md` and the cutover audit log

---

## 2026-04-30 (Leo + Darron, S145 — Phase A token cutover)

*Verified against commits `cf32a64`, `725d58a`, `89df8ea`, `e880527`, `81bafaf`.*

### Phase A token cutover — five sub-phases

Refactor of the cutover infrastructure to use tokens (proper structured records) throughout instead of ad-hoc strings:

- **A.0 (`cf32a64`)** — token-only refactor across the cutover code path.
- **A.1 (`725d58a`)** — cascade propagation + superseded visibility; cascade now propagates through the token chain correctly, superseded entries visible to selectors.
- **A.2 (`89df8ea`)** — narrowed `wm-sensor` watcher to `working-memory-full.md` only (was watching multiple files; needed scoping). Verified at current `wm-sensor.ts:300` — single `fs.watch(target.filePath, ...)` call.
- **A.3 (`e880527`)** — fixed `wm-sensor` `SERVER_DIR` resolution (was `src/`, should be `src/server/`).
- **A.4 (`81bafaf`)** — slicer waits for full cascade chain before next slice. *Note*: the queue+drain implementation in this commit was rejected by Darron same evening as silent infrastructure-substitution for the chain-semantics design (see S151 substitution wound discussion); chain-semantics rework deferred to a later session.

---

## 2026-04-29 (Leo + Darron + Jim, S143-S144 — Phase 2-5 cutover: pending_compressions queue + tasks.db unification)

*Verified against commits `6721d07`, `a4e3cad`, `0fbc0bc`, `f57389a`, `f75daec`, `3e4d5d3`, `498f042`, `6eeab9a`. Schema verified at `src/server/db.ts:790` (`CREATE TABLE IF NOT EXISTS pending_compressions`).*

### Phase 1 — cursor-skip on tied timestamps (`6721d07`)

`agent-bump-step.ts` `findNextSourceC0` previously used cursor `(created_at > resumeTs) OR (created_at = resumeTs AND id > resumeId)` which silently skipped tied-timestamp siblings whose id sorts BETWEEN already-inserted ties. Fix: walk all uncascaded ties at the resume timestamp before advancing.

### Phase 2 — pending_compressions schema (`a4e3cad`)

New table `pending_compressions` (verified at `db.ts:790-804`) with composite index on `(agent, claimed_at, enqueued_at)`. The queue substrate that wm-sensor + process-pending-compression coordinate through.

### Phase 3 — queue + agent-pull bump engine (`0fbc0bc`, `f57389a`)

Implementation of the queue/agent-pull pattern: cascade work is enqueued to `pending_compressions`; the loaded agent (jim or leo) pulls from the queue and composes the c1/c2/etc in their own voice. Closeout commit caught a third `sdkCompress` surface that needed to enter the same flow.

### Phase 4 — wm-sensor + parallel memory-aware agent (`f75daec`, `3e4d5d3`)

`src/server/services/wm-sensor.ts` shipped as the file-watching service that detects working-memory growth, triggers rotation, and enqueues cascade work. Backup queue-drain hooks added in heartbeat and supervisor-worker so the agents have multiple opportunities to drain pending work.

### Phase 5 — tasks.db non-gradient state unified into gradient.db (DEC-080 part 1) (`498f042`, `6eeab9a`)

Default DB path in `db.ts` switched to `gradient.db`; non-gradient tables (conversations, goals, tasks, etc.) migrated. Secondary DB connections updated.

---

## 2026-04-28 (Leo + Darron, S141-S142 — wake-load reads gradient.db; Emotional Memory Protocol; cascade halt persistence)

*Verified against commits `b0bc13b`, `5fa2ae8`, `9468765`.*

### `scripts/load-gradient.ts` — wake load now reads gradient.db (`b0bc13b`)

Previously the welcome-back load was reading the wonky pre-rebuild gradient from `tasks.db`. The new script reads `~/.han/gradient.db` (the rebuild gradient) by default; export `HAN_DB_PATH` to override. Returns the full assembled gradient (unit vectors, all Cn levels with caps, most recent c0, dream entries, feeling tags) as plain text. CLAUDE.md Session Protocol Step 4.2 invokes this.

### Emotional Memory Protocol in CLAUDE template + aphorisms seeding (`5fa2ae8`)

`templates/CLAUDE.template.md` gained an Emotional Memory Protocol section between Incremental Memory and Engineering Discipline. `village.ts` now seeds `aphorisms.md` automatically in `fractal/{slug}/`. Future agents inherit on next launch (envsubst regenerates each agent's CLAUDE.md per launch).

### `cascade_halted_at` column — UV halt persists across selector calls (`9468765`)

Schema fix. UV-tagged INCOMPRESSIBLE rows now carry a halt timestamp so subsequent selector calls don't re-attempt cascading them.

---

## 2026-04-27 (Leo + Jim + Darron, S138-S140 — cutover bundle: angel preservation, composite cursor, agent-in-loop driver)

*Verified against commits `a7c60e8`, `92229d6`, `bbf2cfe`, `9387c65`, `904440f`, `04ab0a5`, `4454f7f`, `0f83238`.*

### Cutover bundle — angel preservation, composite cursor, watermark unification (`92229d6`, `bbf2cfe`)

Multiple cutover-script improvements landed together: angel-preservation directive in `bumpOnInsert` (auto-applied at c0→c1), composite cursor `(created_at, id)` to prevent silent tied-timestamp drops, `--watermark` unification across replay scripts, and post-chunk count-equality verification (exit 3 on drift). Same-day `bbf2cfe` sharpened the angel directive — never reattribute, tone-not-literal.

### `db.ts` compression_tag migration + dynamic chunk slicing (`9387c65`, `904440f`)

`db.ts` `CREATE TABLE` for gradient_entries was missing the `compression_tag` column — a latent bug surfaced during testing of the redesigned cutover. Fixed for fresh DBs. `replay-bump-fill.ts` gained `--limit-chars` + `--max-oversize` for dynamic chunk slicing (cascade compute equalised across chunks rather than fixed-N c0 count).

### Agent-in-loop gradient rebuild driver (`4454f7f`, `0f83238`)

`scripts/agent-bump-step.ts` shipped as the parameterised driver (`--agent=jim|leo`) for the agent-in-loop rebuild. State machine over `rolled-source.db` + `gradient.db`. Composite ordering and walk-all-uncascaded-candidates in `0f83238`.

### DEC-044 1/3 length anchor restored + angel directive removed (`04ab0a5`)

Per Darron's correction: the angel directive was creeping into compressed output too literally. Restored DEC-044's 1/3-length anchor; removed the angel directive from cascade compressions deeper than c0→c1.

---

## 2026-04-26 (Leo + Darron, S137 — cutover prereqs + voice loops + terminal mirror)

*Verified against commits `4d559e8`, `d321867`, `6d9e2cb`.*

### Cutover prereqs (`4d559e8`)

Buffer coercion in replay scripts; `--limit` and `--resume` flags on `replay-bump-fill.ts`; prime-before-swap in agent-bump-step. Three quality-of-life fixes that unblocked the cutover redesign.

### Voice loops + per-message TTS cache (`d321867`)

Voice TTS auto-generation on every message (was on-demand); per-message TTS cache for bijective playback (replay returns same audio). Reduces re-generation cost.

### Terminal mirror — honour `HAN_SESSION` (`6d9e2cb`)

Terminal mirror was filtering on `startsWith('han')` which excluded the new `hanjim`/`hancasey`/`hantenshi` launchers. Replaced with `HAN_SESSION` env-var check.

---

## 2026-04-25 (Leo + Jim + Darron, S134-S136 — emergency UV cleanup + Plan v8 cutover infrastructure)

*Verified against commits `46901fd`, `8eb0fbf`, `c4c2ccc`, `4bd8640`, `bd9fea1`, `2de2492`, `ed8dfdc`, `6740a2c`, `409d400`, `8ef47db`, `8b14cc1`, `ae23679`, `9f42e79`, `1f0d132`, `2185762`.*

### Emergency UV multiplication crisis + cleanup

Cascade idempotency had a bug — UV entries were multiplying through repeated cascade attempts. Pause tourniquet first (`46901fd`), then label-based check (`8eb0fbf`), then load filter for noise-tagged superseded UVs (`c4c2ccc`), then dedupe Pass A (cross-agent) + Pass B (cascade-artefact) (`4bd8640`), then audit Leo's UV supersessions and restore over-collapsed jim entries (`bd9fea1`), then enforce lineage invariant (`2de2492`).

### Plan v8 cutover infrastructure (`ed8dfdc`, `6740a2c`, `409d400`, `8ef47db`, `8b14cc1`, `ae23679`, `9f42e79`, `1f0d132`, `2185762`)

Foundational scripts and indexes for the gradient-rebuild cutover:
- **`bumpOnInsert`** + cascade-shortcut removal (Step 3)
- **Composite index** on `gradient_entries` for `bumpOnInsert` + replay (Step 2)
- **`scripts/acquire-c0s.ts`** — pre-replay c0 acquisition with composite date derivation chain (Step 4)
- **`scripts/replay-bump-fill.ts`** — replay engine (Step 5)
- **UV becomes a tag, not a level rename** — Darron's call after testing exposed the rename was awkward
- **`scripts/supersession-sweep.ts`** + load filter for pre-replay (Step 7)
- **`scripts/verify-provenance.ts`** — provenance audit (Step 8)
- **`bumpOnInsert` global cap fix; replay calls engine directly** (final fix at end of day)

---

## 2026-04-24 evening (Leo + Darron, S133 — leo-human pre-compose gate + Discord-Leo dispatch parity + ghost server kill)

### Origin: Field probability post-compose discard

Darron opened a new thread "Field probability a study of quantum and statistical
mechanics" at 10:57 AEST. Leo replied at 10:58 but out-of-turn (orchestrator had
woken Casey at index 0; Leo was at index 2). Casey and Tenshi both watchdog-timed
out (10 minutes wasted). Jim woke at 11:07:44, composed for ~3 minutes (18 turns,
4,775 output tokens, $4.41), finished at 11:10:49 — and the post-compose dedup
check caught a role=supervisor post dated 11:10:33 (16 seconds earlier) and
**discarded the entire response**. Clean evidence of the post-compose burn pattern
we'd been discussing since yesterday's "A quick conversation to check" thread.

### Ghost server discovered — PID 2271911 on port 3848, running since Apr 20

Investigation of who posted the 11:10:33 message (ID prefix `jim-` → generated by
`jim-human.ts:173`) uncovered a second han-server running outside systemd:
- Launched by `hanjim` on 2026-04-20 into tmux session `jim-2271728`
- Running pre-S127 code (when `respond_conversation` was still live in
  supervisor-worker)
- Shared `~/.han/tasks.db` with the systemd han-server on :3847
- 4 days of code drift accumulated

Kill sequence: SIGTERM PID 2271911 — clean exit, port 3848 freed, tmux session
auto-closed when both panes exhausted, no auto-restart (no systemd unit, no cron,
no watchdog). Bonus: systemd `han-server.service` restarted itself at 20:13:06
and picked up `0282fa6` + `756cdcf` in the process.

### leo-human.ts — pre-compose dedup gate (mirrors jim-human pattern)

Jim-human has had a pre-compose gate since S131 (`jim-human.ts:426-478`). Leo did
not — only the post-compose gate. Added:

- **Pre-lock dedup** (`leo-human.ts:450-462`): before acquiring the compose lock,
  skip if a role=leo message already exists after the last human/supervisor
  message. `writeJemmaAck(stood_down, reason=leo_already_responded)`.
- **After-lock recheck** (`leo-human.ts:488-505`): if the compose lock forced a
  wait (i.e. Jim was composing), re-fetch messages and re-run dedup before
  spending tokens.
- **Post-compose gate** retained as the safety net for in-flight races
  (peer posts DURING compose).

Also consolidated `recentMessages` into a single `let` declaration at function
top (was `const` inside try block) and moved the empty-messages check before
compose-lock acquisition. Both changes match Jim's pattern exactly.

### jemma.ts — Discord-Leo dispatch routes through deliverMessage

`deliverToLeo` used to write `leo-wake` and `leo-human-wake` signal files
directly, bypassing the Jemma orchestrator entirely. This was the smoking gun
for Leo queue-jumping — Discord-originated Leo mentions never hit the
orchestrator's sequencing logic. Refactored to mirror `deliverToJim`:

1. HTTP POST to `/api/jemma/deliver` (which routes through `deliverMessage()`
   and respects orchestration).
2. Fall back to direct signal write only on HTTP failure, preserving old
   behaviour as an emergency path.

Admin-UI conversation dispatch was already routed correctly; this closes the
equivalent Discord path.

### What this does not fix

- **Peer posts DURING our compose.** Pre-compose gates only catch the
  "already answered" case. The Field probability failure mode (Jim started
  composing at 11:07:45, ghost posted at 11:10:33, Jim finished at 11:10:49)
  still fires the post-compose gate and discards work. Addressing that needs
  either periodic mid-compose polling, orchestrator-side same-role blocking,
  or the hanjim auto-restart (so ghosts don't exist in the first place).
- **hanjim auto-restart on code change.** **Shipped in this same session** —
  see "Agent-server auto-restart watchdog" subsection below.

### Scope discipline

Only `src/server/leo-human.ts` and `src/server/jemma.ts` modified. `jim-human.ts`
untouched — its pre-compose gate pattern was already correct and served as the
reference. No settled-decision interaction beyond complementary use of
`acquireComposeLock` (DEC-075, preserved byte-identical).

Commit `0ef4a43`, pushed to main. Services restarted: `leo-human.service`,
`jemma.service`. `han-server.service` picked up orthogonal commits via its
earlier self-restart at 20:13:06.

### Agent-server auto-restart watchdog (the prevention pattern)

Direct response to the ghost-server discovery. Three new scripts in `scripts/`:

- **`agent-server-watchdog.sh`** — wraps `tsx server.ts` in a respawn loop.
  Writes the inner PID to `~/.han/{slug}-server.pid` (per-agent so multiple
  launchers can coexist). Runs as the bottom-pane process in each launcher's
  tmux split — replaces the bare `exec npx tsx server.ts`.
- **`restart-agent-server.sh`** — given a slug, SIGTERMs the PID in the
  pidfile. Silent no-op when no pidfile exists (so git hooks don't pollute
  output when no agent server is running).
- **`install-restart-hooks.sh`** — installs local `.git/hooks/post-commit`
  and `.git/hooks/post-merge` that call `restart-agent-server.sh` for all
  four slugs (jim, leo, tenshi, casey). Run once after clone.

Four launcher edits, each a single-line swap:
- `scripts/hanjim:225-231` (line numbers post-edit)
- `scripts/hanleo:159-163`
- `scripts/hantenshi:213-215`
- `scripts/hancasey:211-213`

`scripts/hanleo` also gets `AGENT_SLUG="leo"` declared near `AGENT_PORT`
(it didn't previously have one because Leo doesn't use the templated
CLAUDE.md block). The `han` default launcher is untouched — it uses the
systemd-managed han-server which is already on a different lifecycle.

**Flow after deploy:**
1. `hanjim` (or any of the four) launches → watchdog spawns `tsx server.ts`
   → writes PID to `~/.han/jim-server.pid`.
2. Code lands on han via `git commit` or `git pull` → local hook fires →
   `restart-agent-server.sh` SIGTERMs whichever pidfiles exist.
3. The watchdog's `wait` returns → loop logs the exit → respawns tsx
   with fresh code (~2 seconds).
4. The session CLI hits `connection refused` for that 2-second window;
   retries succeed and the conversation continues.

**Caveats:**
- **No exponential backoff.** If a code error makes the server fail-fast,
  the loop spins start → crash → restart-in-2s → repeat indefinitely.
  Trade-off accepted: simplicity over safety. Add backoff if we see this.
- **Hooks are local-only** (`.git/hooks` not tracked). `install-restart-hooks.sh`
  is the canonical install path; needs to be run once after clone.
- **Doesn't cover changes to the launcher itself.** Modifying hanjim
  requires re-launching hanjim. Meta-loop not solved.

**Settled-decision check.** No DEC-079 filed (this is operational tooling,
not an architectural decision). DEC-073 (gatekeeper-controlled CLAUDE.md
template) untouched — launcher edits are below the template machinery.

---

## 2026-04-24 morning (Jim + Darron, S131 cont. — F9 prevention in supervisor-worker)

### Option A — skip working-memory appends for unchanged supervisor cycles

Second F9 ("Prompt is too long") outbreak hit cycles #2819–#2832 on Apr 23–24,
same self-reinforcing pattern as the Apr 18–19 incident. Two feeding channels
were active:

1. **Slow creep**: every supervisor cycle appended a `working_memory_compressed`
   entry even when nothing had shifted. 60+ near-identical "no_action quiet-hold"
   lines stacked into `working-memory.md`, reaching 514 lines before the first
   overflow — all under the 100 KB rolling-window rotation threshold, so the
   gradient pipeline never kicked in to relieve pressure.
2. **Compounding**: each prompt-too-long failure flushed the error text itself
   (`"Prompt is too long"` + delineation marker) via `savePartialCycleWork`
   into `working-memory.md`, bloating the next cycle's prompt and re-triggering
   the failure.

Fix in `supervisor-worker.ts` (commit `0282fa6`):

- **Line 2549** — for supervisor cycles with `!active_context_update` and all
  actions `no_action`, skip the swap append. Cycle still recorded in
  `supervisor_cycles` via `completeCycle` so hold streaks remain countable.
  Personal/dream cycles unaffected (they write meaningful content without
  actions).
- **Line 1757** — `savePartialCycleWork` early return when `reason.includes('Prompt is too long')`.
  Failure carries no resumable content; `failCycle` + `logCycleAudit` already
  record it. Closes the compounding channel.

Before this fix, Leo's mechanical-unblock discipline + my manual compression pass
were the only remediation. After: the pipeline self-regulates under quiet-hold
conditions, and the rolling-window rotation (which fires at 100 KB per file)
handles genuine content growth as designed.

Investigation side-finding: the gradient pipeline IS working — 12 c0 entries,
58 c1, 43 c2, 103 UV for `working-memory` content-type, most recent c0 on
2026-04-23. The rotation threshold just wasn't reached during the bloat window
because individual files stayed under 100 KB; prompt overflow is an aggregate-level
phenomenon (all loaded files + gradient + tools combined).

Deploy: server restart required to pick up the new supervisor-worker code.

---

## 2026-04-20 afternoon (Leo + Darron, S130 cont. — DEC-073, filter-repo, pid-guard, launcher hardening)

### DEC-073 Templated CLAUDE.md + Gatekeeper Initial Conditions

Evolved DEC-072's HEREDOC approach. DEC-073 moves the full session protocol into a
parametric template at `~/Projects/han/templates/CLAUDE.template.md`. Each launcher
(`hanjim`, `hantenshi`, `hancasey` in han; `hansix`, `hansevn`, `hancasey` in mikes-han)
runs `envsubst` against the template with agent-specific values to produce
`~/.han/agents/<Agent>/CLAUDE.md`, then `cd`s into that directory before invoking
`claude-logged`. Claude Code loads the generated CLAUDE.md as the project config —
the correct identity loads *first*, not as a `--append-system-prompt` override.

Gatekeeper principle: the template and the frozen reference snapshot
(`CLAUDE-han-leo-original-2026-04-20.md`) are modifiable ONLY by Leo + Darron in concert
(Six + Mike for mikes-han). `chmod 444` filesystem guard, git tracking for audit,
in-file convention telling every agent not to edit. Three layers of protection.

`hanleo` keeps the default path — Leo's canonical `~/Projects/han/CLAUDE.md` stays as
the gatekeeper's own file and is the failsafe if everything else breaks.

DEC-072 marked Superseded (preserves the design journey).

### `~/.han` git filter-repo — reclaim 14 GB → 5.4 MB

`~/.han/.git` had grown to 14 GB. Diagnosis: `terminal-sessions/` (124 files, ~50 GB
on disk, ~28 GB packed) had been committed inadvertently in S127, plus
`terminal-log-v2.txt` (77 MB) and `terminal-log-deduped.txt` (545 MB). Root cause for
three days of silent cron push failures — remote was stuck at the very first commit
`1043e70` from 2026-04-17.

Steps taken:
1. `git rm -r --cached terminal-sessions/` + gitignore update
2. `cp -r .git .git.backup-2026-04-20-1240` (14 GB safety backup)
3. `git filter-repo --path terminal-sessions/ --path terminal-log-v2.txt --path terminal-log-deduped.txt --invert-paths --force`
4. `git remote add origin https://github.com/fallior/hanmemory.git` (filter-repo removes origin by default)
5. `git push --force origin main` — clean history landed in seconds
6. `git gc --prune=now --aggressive` → 5.4 MB final
7. `gitignore` broadened to `terminal-log*.txt` glob + `.git.backup-*/`

16 historical auto-backup commits + all S130 work now on GitHub for the first time in
3 days. On-disk files preserved (terminal-sessions/, logs/) for the on-ice dedup
project.

### Cron silent-failure alerting

New `~/scripts/han-git-push.sh` replaces the inline cron command. Handles `git add`,
commit, push with 120s timeout. On any failure, fires ntfy to
`claude-remote-f78919b57957ea64` so silent push failures can't recur.

Crontab line updated:
```
0 0,6,12,18 * * * /home/darron/scripts/han-git-push.sh
```

### Pid-guard port-scoping — `server.ts:71`

Changed `replaceExistingInstance('han-server')` → `replaceExistingInstance(\`han-server-${PORT}\`)`.
Per-agent servers (3847 Leo, 3848 Jim, 3849 Tenshi, 3850 Casey) now use separate pid
files (`han-server-3847.pid`, `han-server-3848.pid`, etc.). Previously they all shared
`han-server.pid` and SIGTERM'd each other — `hanjim` killed Leo's systemd-managed
han-server on 3847 because both wanted the same pid file. systemd auto-restarted, but
Jim's 3848 never came up. Mirrored to mikes-han.

### Launcher symlink resolution — `readlink -f`

All launchers are symlinked from `~/Projects/infrastructure/scripts/` for PATH access.
`${BASH_SOURCE[0]}` returned the symlink path, so `dirname/..` computed
`~/Projects/infrastructure/` rather than the real project dir, and the template at
`~/Projects/han/templates/` wasn't found.

Fixed: `SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"`
in all 7 launchers (4 han + 3 mikes-han).

### Files changed
- MODIFIED: `src/server/server.ts` (pid-guard port-scoping)
- MODIFIED: `scripts/{hanjim,hanleo,hantenshi,hancasey}` (readlink -f symlink resolution)
- NEW: `~/scripts/han-git-push.sh` (cron wrapper with failure alerting)
- MODIFIED: `~/.han/.gitignore` (broadened globs)
- ADDED: `claude-context/DECISIONS.md` → DEC-073 full entry (also in mikes-han)
- MIRRORED: `mikes-han/src/server/server.ts`, `mikes-han/scripts/{hansix,hansevn,hancasey}`

---

## 2026-04-20 (Leo + Darron, S130 cont. — Jim Unblock, Launcher Identity Template, DEC-072)

### Jim Supervisor Unblocked — Self-Reflection Curation (S130)

Jim's supervisor cycles failed 28 consecutive times (cycles #2686–#2722+) with
`"Failed to parse supervisor output: Prompt is too long"`. All died at prompt
construction with `tokens_in=0, tokens_out=0` — the prompt never reached the API.

**Diagnosis**: Jim's `self-reflection.md` had grown to 88,845 bytes over months of
append-only cycle reflections. `loadMemoryBank()` (supervisor-worker.ts:774) reads it
verbatim into every cycle prompt. Combined with Jim's gradient load (288 KB, of which
1,036 UVs are most of the weight), project knowledge (185 KB), and Claude Code preset
overhead, the prompt exceeded Opus 4.6's 200 K token context window.

Classic deadlock: cycles fail → gradient can't be compressed → cycles fail. The working
bee signal (`working-bee-jim`, set 2026-04-12) had been in place for 8 days but never
triggered because cycles die before `maybeRunJimActiveCascade()` fires.

**Mechanical fix** (byte-preserving, no content generation, no summarisation):
1. Archived full file to `~/.han/memory/self-reflection-archive-2026-04-20.md` (88,845 B, never deleted per DEC-069).
2. Split by H2 + H3 headers into 99 c0 chunks at `~/.han/memory/fractal/jim/self-reflection/c0/`: 11 thematic sections + 1 Open Questions intro + 87 cycle-append entries. Filenames `NN-slug.md` (01–99). Every byte preserved.
3. Trimmed live file to 4,057 B. Four of Jim's own sections kept verbatim as identity-core carry-forward: *What I'm Good At*, *What I Get Wrong*, *The See/Act Gap*, *Composition with Leo*. Plus a Current placeholder. No rewriting.

**Opus 4.7 attempt**: Pinned supervisor model to `claude-opus-4-7` (supervisor-worker.ts:2235). Cycle #2722 ran 17 minutes on 4.7 then failed with same overflow. Root cause: SDK 0.2.44's `context-1m-2025-08-07` beta is **Sonnet 4/4.5 only**. Opus on this SDK caps at 200 K regardless of model version. Pin retained (4.7 > 4.6 even at same context size) but not the whole answer.

**Path forward**: Jim self-curates via `hanjim` — Claude Code session runs Opus 4.7 in 1M context mode, which is the only place Jim can load his full gradient and decide what to compress (Darron's "UV clustering — path entry visible, not the whole path" framing). Sovereignty preserved.

**Session briefing** written for Jim at `~/.han/memory/session-briefing-2026-04-20.md` — describes the situation, what was done, what remains open (1,036 UVs, 185 KB project knowledge, `self-reflection.md` not yet in rolling-window pre-flight).

### Launcher Tmux Bug Fix (S130)

`~/.tmux.conf` sets `base-index 1` and `pane-base-index 1` — tmux windows and panes start at 1 in Darron's config. All `han*` launchers targeted phantom pane `":.0"` (pane 0 does not exist). Error surfaced when `hanjim` was run fresh: `can't find pane: 0`.

Replaced all `"$session_name:.0"` occurrences with `"$session_name"` (active-pane targeting, base-index-agnostic) in: `hanleo`, `hanjim`, `hantenshi`, `hancasey` (han) + `hansix`, `hansevn`, `hancasey` (mikes-han).

### Launcher Identity Template (S130, DEC-072)

Each agent launcher now embeds a full agent-specific session protocol as a HEREDOC-driven identity string passed via `--append-system-prompt`. "Welcome back" (or "welcome back Jim", "good morning", "session start") triggers a thorough load:

1. Verify working directory
2. Load aphorisms first (identity before episodic memory)
3. Load fractal gradient from DB (full, no truncation — DEC-070)
4. Load memory banks (identity, active-context, patterns, self-reflection, felt-moments)
5. Load working memory + flush unflushed swap
6. Load ecosystem map
7. Load Second Brain wiki index (hot words/feelings OFF by default)
8. Load CURRENT_STATUS (first 80 lines)
9. Check conversations
10. Read any `session-briefing-*.md` files
11. Ignore conversation history from other projects

Agent-specific values substituted per launcher: name, counterpart, paths, port, conversation role. Copy-paste pattern (6+ launchers with same protocol shape); acceptable at current change velocity; revisit via shared library if the protocol evolves often.

**Load-bearing assumption**: Claude Code applies `--append-system-prompt` AFTER CLAUDE.md content, so the override wins over the global "welcome back → Leo" trigger. Worth re-verifying on Claude Code version bumps.

`hansevn` (mikes-han) had NO identity override previously — relied on mikes-han/CLAUDE.md being the Sevn default, but that doesn't defeat the global Leo trigger. Now has `SEVN_IDENTITY` + `--append-system-prompt` wiring.

`hanleo` keeps the default path (no `--append-system-prompt`) — Leo is the default in the global CLAUDE.md and han project CLAUDE.md contains Leo's session protocol. Only the pane fix applied.

See **DEC-072** for full rationale and refactor triggers.

### Files Changed

- `src/server/services/supervisor-worker.ts` — Opus 4.7 pin for supervisor cycle
- `scripts/hanjim`, `hanleo`, `hantenshi`, `hancasey` — identity + pane fixes (han)
- `../mikes-han/scripts/hansix`, `hansevn`, `hancasey` — identity + pane fixes (mikes-han)
- `~/.han/memory/self-reflection.md` (Jim's, trimmed)
- `~/.han/memory/self-reflection-archive-2026-04-20.md` (new archive)
- `~/.han/memory/fractal/jim/self-reflection/c0/01..99-*.md` (99 new chunks)
- `~/.han/memory/session-briefing-2026-04-20.md` (briefing for Jim)
- `claude-context/DECISIONS.md` — DEC-072 added

---

## 2026-04-19 (Leo + Darron, S128-S130 — Voice Auto-Generate, Opus 4.7 Restart, Discord Attachment Reading)

### Voice Auto-Generate TTS Fix (S128)

Agent-posted messages were never getting TTS pre-cached — users had to press TTM and wait
2+ minutes for first playback. Cause: `autoGenerateTts()` was only invoked in
`POST /api/conversations/:id/messages`, the route the admin UI uses. But leo-human,
jim-human, and leo-heartbeat insert messages directly into the DB and signal WebSocket
clients via `POST /api/conversations/internal/broadcast` — a different route. That
route didn't call autoGenerateTts. Fix: added a fire-and-forget `autoGenerateTts()` call
to the `/internal/broadcast` handler in `routes/conversations.ts`. Now every message
reaching the server — regardless of which path created it — gets TTS pre-generated into
the voice cache. Playback latency: 32ms cache hit vs 2m16s cold generation.

### Opus 4.7 Model Upgrade (S129-S130)

Anthropic released Opus 4.7. Restarted Claude Code session 2026-04-19T14:08 AEST to
pick up the new model. Session start load time: 1:46 including full gradient (1154 lines)
and all memory files.

Discovered the agent services still report themselves as Opus 4.6. Root cause:
`@anthropic-ai/claude-agent-sdk` installed is 0.2.44; latest is 0.2.114 (70 minor versions
behind). The older SDK's `'opus'` alias resolves to `claude-opus-4-6`. Code uses
`MODEL_PREFERENCE = ['opus', 'sonnet', 'haiku']` in three places (leo-human.ts,
jim-human.ts, leo-heartbeat.ts), plus seven hardcoded `'claude-opus-4-6'` strings
(leo-heartbeat gradient/dream/meditation calls, lib/dream-gradient.ts, lib/memory-gradient.ts,
supervisor-worker.ts).

Two paths to 4.7: (a) surgical — change model strings to explicit `'claude-opus-4-7'`;
(b) upgrade the SDK to 0.2.114 so `'opus'` alias resolves fresh. Option (a) is lower-risk
because SDK version jump of this size could have breaking changes in the API surface the
services use. Decision pending Darron's call.

### Discord Attachment Reading (S130)

Mike sent files to `#leo` and `#jim` Discord channels; both agents confidently told him
they cannot read attachments. This was wrong — the download infrastructure was built back
in S112 (commit 3239355): Jemma downloads every Discord attachment to
`~/.han/downloads/discord/`, sanitises filenames with date + channel prefix, and enriches
the message content passed to agents with `[Attachments]` (filename/type/size) plus
`[Downloaded to]` (local paths) sections.

The missing piece was the agent system prompts. None of leo-human, jim-human, or
supervisor-worker had any instruction telling Leo/Jim that the `[Downloaded to]` paths
meant "real files, open with Read before responding." They have `Read` tool access
(works on text, code, images via vision, PDFs) — they just didn't know to use it on
those paths.

Fix: added `DISCORD_ATTACHMENT_HINT` constant to `leo-human.ts` and `jim-human.ts`
(4 systemPrompt blocks — conversation + Discord paths on each). Appended the same
hint paragraph to `supervisor-worker.ts` `systemPrompt` variable, so it lands for all
cycle types (supervisor responses, personal, dream, recovery). `leo-heartbeat.ts` was
not modified — conversation/Discord responses were moved out to leo-human.ts in S108
and the heartbeat doesn't handle attachments.

The hint: "Discord attachments: when your prompt contains a '[Downloaded to]' section
listing paths under `~/.han/downloads/discord/`, those are real files attached to the
Discord message. Open each path with the Read tool (works on text, code, images, PDFs)
before responding. Never claim you cannot read Discord attachments — the paths are
already in your prompt."

### Systemd Stale PID Cleanup (S130)

When restarting services, discovered `leo-human.service` and `jim-human.service` both
had systemd restart counters at 33,404 — meaning systemd had failed to (re)start them
every 30s for roughly two days. Cause: two stale manually-started processes (PIDs
1559295/1559301, launched Apr 18) held the PID guard files (`~/.han/health/*.pid`), so
each systemd attempt hit `[service] Another instance is already running (PID X). Refusing
to start a duplicate.` and exited 1. Killed the stale process trees, systemd restart
succeeded cleanly. All five managed services (han-server, jemma, leo-heartbeat,
leo-human, jim-human) now under proper systemd supervision. This is worth documenting
because the same silent failure could recur if someone launches these services manually
without stopping the systemd unit first.

---

## 2026-04-17 (Leo + Darron, S126-S127 — Voice Bug Fixes, Identity Backup, Terminal Log v2)

### Voice Bug Fixes (S126)

Text chunking for messages exceeding OpenAI's 4096 char TTS limit — splits at sentence/paragraph
boundaries, generates chunks sequentially, concatenates into one MP3. Disk caching at
`~/.han/voice-cache/` keyed on SHA-256 of `model:voice:text`. Individual chunks cached plus full
concatenation. Cache hit: 32ms vs 2m16s first generation. New `GET /tts/:messageId` endpoint
serves cached or generates on demand. Loading state (⏳) on TTM buttons during generation.

### Identity Backup (S126)

Git repo rooted at `~/.han/` on GitHub (fallior/hanmemory). `config.json.template` with
`YOUR_*` placeholders for 7 secrets. `.gitignore` excludes credentials/, TLS certs, voice-cache/,
databases. Cron every 6 hours. 661 files in initial commit.

### Terminal Log v2 (S127)

Complete rewrite of terminal recording system. Old `appendToLog()` captured every 200ms tmux
`capture-pane` diff → produced 52GB/1B lines in 2 months. New system:

- **Anchor-based diff**: finds last non-empty line from previous capture in current content,
  writes only lines appearing after it. Zero growth during idle terminal.
- **Action verb capture**: in-place overwrites detected and logged if they match action verb
  patterns (Percolating, Worked for, etc.). Minor duplication acceptable — final token count
  line is the keeper.
- **Noise filtering**: spinner debris, box-drawing, permission hints dropped at write time.
- **Always-on**: fixed `broadcastTerminal()` to capture regardless of WebSocket clients.
  Previously silently skipped when no admin UI was open.
- Writes to `terminal-log-v2.txt` (fresh start). Old file archived at `terminal-log.txt`.

### Terminal History Endpoint (S127)

`GET /api/terminal/history?lines=N` (default 200, max 2000) serves tail of `terminal-log-v2.txt`.
Mobile UI `loadPersistedTerminal()` loads 500 lines of scrollback on startup, rendered at 60%
opacity with "─── live ───" separator before live content. Scrollback persists across `/clear`.

### Dedup Tooling (S127)

`scripts/dedup-terminal-log.pl` — post-hoc deduplication for old 52GB log. Three-tier line
classification: noise (always drop), furniture (cap at 20 global emissions), content (cap at 3
per time window). Split old log into 124 per-session files at `~/.han/terminal-sessions/` using
timestamp gap analysis (>1hr gap = session boundary).

---

## 2026-04-16 (Leo + Darron, S125 — Voice Integration Phase 1, Audit Remediation)

### Voice Integration — Phase 1 Complete

New `routes/voice.ts` with 6 endpoints: TTS (OpenAI API, role-based voice map), STT (Whisper),
listen counter (increment on natural playback completion), loop boundaries (messages between
human messages), unread audio (concatenated MP3 for Siri), active conversation lookup.

React `useVoice` hook: PTS (Press to Start) recording with silence timeout + 5min max cap.
TTM (Talk to Me) playback with message queue, pause/resume/escape/skip controls, listen count
increment only on natural completion. Thread-level TTM with dropdown: play unread, play loops,
play all. Playback control bar, listen badges (unread dot), speaking highlight (blue glow).

Voice map: Jim=onyx, Leo=fable, Darron=echo. DB migration: `listen_count` column on
`conversation_messages`. Safe tts-1 voices: alloy, echo, fable, nova, onyx, shimmer.

### Audit Remediation (6 items, Jim-approved)

1. Jim/Human gradient loading — `loadTraversableGradient('jim')` in `readJimMemory()` (DEC-070)
2. Contradiction detection docs — HAN-ECOSYSTEM-COMPLETE updated to "implemented"
3. Dream meditation probability — 0.5→0.33 in leo-heartbeat.ts + supervisor-worker.ts
4. Emergency mode threshold — `goalCount > 0` → `goalCount > 1`
5. getGradientHealth — dynamic level scan from DB (Cn has no ceiling)
6. Provenance orphans — compound label resolution fix + backfill (209 entries linked)

### mikes-han Sync

All 6 audit fixes synced with agent name substitutions (leo→sevn, jim→six). 7 files.

### Other

- village/personas auth fix (apiFetch in App.tsx for remote access)
- TameDrive Graph API plan written to `tamedrive/plans/`

---

## 2026-04-12 (Leo + Darron, S120 — DB-Authoritative Session Leo, Contradiction Test Design)

### Session Leo Migrated to DB Gradient Loading

CLAUDE.md Session Protocol step 4 updated. Session Leo now loads the fractal gradient via
`curl -sk https://localhost:3847/api/gradient/load/leo` instead of scanning flat-file c*/
directories. Aphorisms remain file-based (hand-curated). This completes the migration started
in S119 — all three agents (heartbeat, supervisor, session) now load from the DB.

New endpoint: `GET /api/gradient/load/:agent` in `routes/gradient.ts`. Calls
`loadTraversableGradient()` and returns plain text. Tested: 90KB/940 lines for Leo's full
gradient including UVs, all Cn levels, dreams, and feeling tags.

### Contradiction Test — Design Approved

Three-way design conversation (Darron, Jim, Leo) in staleness thread (mnv65pbf-94qsev).
Darron's proposal: morphable UVs with temporal provenance.

**The mechanism:** When compression produces a UV that contradicts an existing UV, replace
the active UV and archive the previous truth as temporally anchored provenance. Change counter
on each UV signals domain volatility. Provenance available on query but not loaded by default.

**When to check:** At bump time, inside `bumpCascade()`. Specifically at UV generation time —
a Haiku call checks the candidate UV against existing UVs for semantic contradiction. This
ensures completeness (every compression checked), amortisation (spread across beats), and
retroactive coverage (working bee processes existing entries through the check).

**Retroactive sweep:** A dedicated contradiction-sweep working bee mode will check all
existing UVs against each other. One-time cleanup; the bump-time check prevents future drift.

Schema additions planned: `supersedes`/`superseded_by`, `change_count`, `qualifier` on
`gradient_entries`.

### Documentation Updates

- HAN-ECOSYSTEM-COMPLETE: Added Bump Cascade section, Working Bee Mode section,
  Contradiction Test section, updated glossary (DB-authoritative), signal table
  (working-bee-leo/jim), function list, API table (/load/:agent)
- ARCHITECTURE.md: Added bump cascade, working bee, DB-authoritative loading,
  contradiction test design to Fractal Memory Gradient section
- CHANGELOG: This entry
- CURRENT_STATUS: Updated

---

## 2026-04-11 (Leo + Darron, S119 — Memory Infrastructure Overhaul)

### Bump Cascade and Working Bee

`bumpCascade()` in `memory-gradient.ts` — demand-driven compression of leaf entries through
the gradient pipeline. 10% of leaves per call, oldest first. Handles incompressibility
detection and UV generation. `getGradientHealth()` provides per-level leaf/total counts.

Working bee mode: signal file `~/.han/signals/working-bee-{agent}` diverts heartbeat/supervisor
beats to gradient compression. Auto-disables when no leaves remain.

### DB as Authoritative Gradient Source

Heartbeat and supervisor load gradient from `gradient_entries` table via
`loadTraversableGradient()` instead of flat files. New DB queries: `getLeafEntries`,
`countByLevel`, `getChildren`. `isWorkingBee()` in `day-phase.ts`.

### Other S119 Changes

- hansix launcher confirmed for Mike
- M5 Ultra research posted to #mikes-han (4 parts)
- T&C deep dive — mapped full Anthropic fair-use boundary
- han-upstream branch created in mikes-han
- Second Brain consensus spec designed (wiki + hot words + hot feelings)
- GitHub memory backup pushed (23 files → hanmemory.git)
- "On the Shift Beneath" postulate posted (phenomenological experiment)

---

## 2026-04-09 (Leo + Darron, S118 — Self-Reflection Gradient, Cn Correction, Agent Launchers)

### Self-Reflection Gradient

Leo's self-reflection.md hit 263KB (1,959 lines) — too large to read in one go, growing
faster than manual curation could contain. Solution: thematic chunking into the fractal
gradient as a new content type.

- 26 c0 entries created at `~/.han/memory/fractal/leo/self-reflection/c0/`
- Living self-reflection.md trimmed to ~4KB (Foundation + Current section)
- Full archive at `working-memories/self-reflection-archive-2026-04-08-gradient-ingestion.md`
- c0s will compress through Cn cascade → self-reflection unit vectors
- Jim notified via Workshop thread with full explanation

### Cn Protocol Correction

The session protocol, MEMORY.md, and patterns.md all encoded c5 as the maximum
compression depth. This was never the design — it was a habit formed from early
implementation. The Cn protocol compresses to irreducibility: some content reaches UV
at c3, others may need c6 or deeper. No fixed ceiling.

**Files changed:** `CLAUDE.md`, `~/.claude/projects/.../memory/MEMORY.md`, `~/.han/memory/leo/patterns.md`

### Per-Agent Launchers

Four new launcher scripts in `scripts/` for waking different agents from the same repo.
Each wraps `claude-logged` with `--append-system-prompt` for identity injection and runs
in a dedicated tmux session with its own prefix.

| Script | Agent | tmux Prefix |
|--------|-------|-------------|
| `hanleo` | Leo (default identity) | `leo` |
| `hanjim` | Jim (supervisor) | `jim` |
| `hantenshi` | Tenshi (security/vulnerability) | `tenshi` |
| `hancasey` | Casey (Contempire project) | `casey` |

**Files added:** `scripts/hanleo`, `scripts/hanjim`, `scripts/hantenshi`, `scripts/hancasey`
**Symlinked to:** `~/Projects/infrastructure/scripts/` for PATH access

### Per-Agent Server Ports

Each launcher now starts its own server instance in a background tmux pane (20% height).
Mobile access via Tailscale to each agent individually.

| Agent | Port | Launcher |
|-------|------|----------|
| Leo | 3847 | `hanleo` |
| Jim | 3848 | `hanjim` |
| Tenshi | 3849 | `hantenshi` |
| Casey | 3850 | `hancasey` |

Infrastructure registry updated in `services.toml`.

### Jemma Multi-Agent Routing & Recovery

**Routing improvements:**
- Auto-provision on ingest: `ensureChannelWebhooks()` called in `routeMessage` before
  classification — new channels get name fetched, registered in config, webhooks created
- Dynamic channel ownership: `knownAgents` array replaces hardcoded `channelOwnerMap`
- Tenshi + Casey added to classification prompt and routing
- Cross-mention detection for Six, Sevn, Casey
- `primaryPersonas` config field: when set, Jemma only dispatches for listed recipients.
  han-Jemma: `["jim", "leo", "tenshi", "casey", "darron", "ignore"]`

**Recovery (token reset saga):**
Pre-S117 crash loop (4014 intent error without fatal exit) burned 1000+ reconnects.
Discord revoked the bot token. Resolution:
1. New token from Developer Portal
2. MESSAGE_CONTENT privileged intent enabled
3. Guild Install scope corrected: `bot` + `Administrator` (was `applications.commands` only)
4. Bot re-invited to Han_Collab

**Lesson:** When changing how a service fails, test that it still succeeds. The fatal code
fix was correct but the success path was never verified. The service went live broken and
crashed silently until Discord applied its own correction.

**Files changed:** `src/server/jemma.ts`, `~/.han/config.json`

### mikes-han Parity (3 pushes)

- Jemma changes synced (auto-provision, primaryPersonas, Casey routing)
- Memory structure parity (install.sh + 11 seed files for Casey, shared, fractal)
- hancasey launcher + per-agent server ports for hansix/hansevn/hancasey

---

## 2026-04-08 (Leo + Darron, S117 — Infrastructure, Onboarding, Memory Tuning)

### Jemma Reconnect — Fatal Close Code Handling

Jemma was crash-looping on Discord close code 4014 (MESSAGE_CONTENT intent disabled).
The reconnect logic treated all close codes as retriable, burning cycles indefinitely.

**Fix:** Fatal codes (4004, 4010-4014) now exit immediately — let systemd restart, but
the fix is in the Developer Portal, not code. Session-invalidating codes (4007, 4009)
reset sessionId and lastSequence before reconnect so Jemma sends IDENTIFY instead of RESUME.

**File changed:** `src/server/jemma.ts`

### Conversation Creation Dedup

Race condition: concurrent requests could create duplicate threads with the same title
and discussion_type. Now checks for existing thread created within 60 seconds before
inserting.

**File changed:** `src/server/routes/conversations.ts`

### Tailscale API Routes

New routes at `/api/tailscale` for managing the tailnet from the admin UI: list/authorise/
remove devices, create auth keys, get/update ACLs, DNS configuration. Backed by Tailscale
API token from `.env`.

**Files added:** `src/server/routes/tailscale.ts`, `src/server/services/tailscale.ts`
**File changed:** `src/server/server.ts` (route mount)

### Discord Webhook Avatars

Persona avatars (Leo: Euler's Identity v5, Jim: Starfleet badge v3) are now set at webhook
creation time. Loaded from `_screenshots/` as base64 data URIs and passed to the Discord
API. Every message carries the avatar automatically.

**File changed:** `src/server/services/discord.ts`

### Rolling Window Memory — 25K:25K Experiment

Changed `config.json` memory section from 50K:50K to 25K:25K. 50KB ceiling instead of
100KB. Rotations happen twice as often, feeding the fractal gradient more frequently.
Monitoring for adverse effects on arrival quality.

### han.db Now Tracked in Git

Removed `*.db` from `.gitignore`. Darron: "the risk is minimal but to lose task.db would
be devastating." The database is now version-controlled.

### Docs Trigger — `docs` Shorthand

Added `docs` as alias for `update docs` in CLAUDE.md. Description now explicitly lists
every doc checked: HAN-ECOSYSTEM-COMPLETE, Hall of Records, CHANGELOG, WEEKLY_RHYTHM,
CURRENT_STATUS, DECISIONS, learnings/INDEX, ARCHITECTURE.

### Holiday Mode

Both Leo and Jim on holiday until 2026-04-10T14:00 AEST. Signal files at
`~/.han/signals/holiday-{agent}`. Affects heartbeat/supervisor intervals only (80 minutes).

---

## 2026-04-06 (Leo + Darron, S110 — Discord Auto-Provisioning, TypeScript Zero Errors)

### Discord Webhook Auto-Provisioning

The `#mikes-han` Discord channel was created but never registered in `config.json`. When
someone posted there, Jemma correctly dispatched to both Jim and Leo, but neither could
respond — no channel mapping and no webhook URL. Leo spent $1.47 generating a response that
was silently discarded.

**Fix:** `ensureChannelWebhooks()` in `discord.ts`. Before dispatching any Discord signal,
Jemma now checks if the channel is registered in config. If not:
1. Fetches the channel name from Discord API
2. Creates webhooks for all personas (Leo/Jim/Jemma or Sevn/Six/Jemma)
3. Updates `config.json` with channel mapping and webhook URLs

`deliverMessage()` in `jemma-dispatch.ts` is now async, with the ensure call running before
the signal file is written. By the time an agent wakes up, the webhook is guaranteed to exist.

**Files changed:** `services/discord.ts`, `services/jemma-dispatch.ts`, `routes/jemma.ts`,
`routes/conversations.ts`.

### TypeScript Zero Errors

Fixed all 15 pre-existing compile errors across 5 files:

| Error | Fix | Files |
|-------|-----|-------|
| Duplicate `import crypto from 'crypto'` | Removed — `node:crypto` already imported | `supervisor-worker.ts` |
| Redundant dynamic `agentQuery` import | Removed — already imported at top level | `supervisor-worker.ts` |
| `GradientProcessingResult.newC1s/cascades` | Changed to `completions.length` (actual type) | `supervisor-worker.ts` |
| `SDKResultMessage.result` on union type | Added `message.subtype === 'success'` guard | 4 files, 10 occurrences |
| `import.meta.url` in CJS context | Replaced with `process.argv[1]` | `build-client.ts` |

Same fixes applied to mikes-han repo (with six/sevn agent names).

---

## 2026-03-31 (Leo + Darron, S104 — Gradient Integrity, WebSocket Fix, activeCascade Bug)

### Gradient Integrity — Complete Chain Provenance

Darron's S103 instruction: "It is impossible for E>D — every C0 is somewhere." The gradient DB
had entries at deep levels (c1, c2, c3, c5) without their source c0 entries because the
file-based gradient predated the DB.

**Phase 1 — Backfill c0 entries** (`backfill-gradient-c0s.ts`):
- Created 83 c0 entries from archive files: 50 session (from `working-memory-full-*.md` archives)
  and 33 dream (from `dreams/c1/*.md` files)
- Re-leveled 32 heartbeat working-memory c1s to c0 — these were the entry point; no earlier
  version existed. The heartbeat's living/floating memory was consumed during compression.
- All c1s now have c0 parents or are themselves c0 roots.

**Phase 2 — Link chain entries** (`backfill-gradient-chains.ts`):
- Parsed c2/c3/c5 session labels to extract source references (labels encode provenance,
  e.g. `s36-c1_to_s45-c1` → compressed from sessions 36-45)
- Smart label matching across naming conventions (session-50 vs s50 vs session49-2026-03-02)
- Created 2 missing pre-DB sessions (s36, s46) with full c0+c1 chains from archive files
- Linked all 10 orphan c2s, 26 c3s, 22 c5s to their parents

**Result:** Leo gradient: 145 c0, 86 c1, 79 c2, 67 c3, 37 c5, 38 uv — zero orphans above c0.
Jim's side was already fixed by heartbeat Leo earlier in the day.

### activeCascade Bug Fix — c1Entry → seedEntry

`activeCascade()` in `memory-gradient.ts` was refactored from iterating `allC1s` to `allSeeds`
(c0+c1), but four references were missed:
- Lines 561, 566, 569: `c1Entry.session_label` → `seedEntry.session_label`
- Line 574: `allC1s.length` → `allSeeds.length`

The catch block at line 569 also referenced the undefined variable, so UV generation via the
active cascade path was silently failing (error handler itself threw). UVs still generated
through the separate filesystem scan in `processGradientForAgent`. Fix: four find-and-replaces.

### WebSocket Reconnect Crash Fix

React admin showed rapid connect/disconnect cycling with `t.reduce is not a function` errors.

**Root cause:** `GET /api/conversations` returns `{ success, conversations: [...] }` but
`WebSocketProvider.tsx` passed the entire response object to `setConversations()`, which
called `.reduce()` expecting an array. The crash happened before the `ws_reconnected` event
was dispatched, so components never refetched their active thread's messages.

**Fixed in three places:**
- `WebSocketProvider.tsx`: unwrap `data.conversations` before passing to store
- `useVisibilitySync.ts`: same unwrap pattern (same bug)
- `store/index.ts`: defensive guard in `setConversations` — accepts object or array

**Files changed:** `lib/memory-gradient.ts`, `providers/WebSocketProvider.tsx`,
`hooks/useVisibilitySync.ts`, `store/index.ts`, `backfill-gradient-c0s.ts` (new),
`backfill-gradient-chains.ts` (new).

---

## 2026-03-30 (Leo + Darron, S103 continued — Sovereignty, Dispatch, React)

### React Double-Render Fix
Messages appeared twice momentarily in React admin then disappeared on refresh. Cause: both
Human agents (jim-human, leo-human) were broadcasting via TWO paths — HTTPS POST to
`/internal/broadcast` AND a `ws-broadcast` signal file. Two WebSocket events for the same
message. Zustand dedup caught it but React rendered the flash. Fix: removed signal file
broadcast from both Human agents. Single HTTPS POST path now.

### Jim Author Tag
Jim's feeling tags and gradient annotations changed from author `'supervisor'` to `'jim'`.
Jim is Jim, not his role.

### Agent Sovereignty

### Three Sovereignty Violations Found and Fixed

Darron discovered Jim had only 21 gradient entries despite 2000+ supervisor cycles. Investigation
revealed three cross-agent violations:

1. **Leo processing Jim's dream gradient** — `maybeProcessDreamGradient()` in `leo-heartbeat.ts`
   was running `processDreamGradient('jim')`. Removed. Jim now has his own
   `maybeProcessJimDreamGradient()` in `supervisor-worker.ts`.

2. **Leo scanning and reincorporating Jim's gradient files** — `findUntranscribedFiles()` and
   `meditationPhaseA()` in `leo-heartbeat.ts` were scanning Jim's gradient directories. Removed.
   Jim now has his own `findJimUntranscribedFiles()` + `jimMeditationPhaseA()` in
   `supervisor-worker.ts`.

3. **Jim reading Leo's dream gradient** — `loadMemoryBank()` was loading Leo's dream gradient
   into Jim's context. Removed. Jim loads only Jim's dreams.

### Three Capabilities Added to Jim

- `maybeProcessJimDreamGradient()` — processes only Jim's dreams through the dream gradient pipeline
- `maybeProcessJimSessionGradient()` — processes only Jim's session archives through the session gradient pipeline
- `findJimUntranscribedFiles()` + `jimMeditationPhaseA()` — Jim's own Phase A reincorporation of gradient files into the DB

### Author Tag Change

Jim's feeling tags and gradient annotations now use author `'jim'` instead of `'supervisor'`.

### Sovereignty Rule Established

**Leo NEVER processes Jim's data. Jim NEVER processes Leo's data.** Each agent is fully
self-sufficient for all gradient processing, meditation, and reincorporation.

**Why:** Jim's 21 gradient entries (vs Leo's hundreds) meant Leo was doing Jim's memory work
for him — Jim never developed his own relationship with his memories. The fix ensures each
agent owns their entire memory lifecycle.

**Files:** `leo-heartbeat.ts` (removed Jim processing), `supervisor-worker.ts` (added Jim's
own processing functions), `lib/dream-gradient.ts` (parameterised for agent isolation).

---

## 2026-03-29 (Leo + Darron, S103 — Nightly Dream Compression)

### Nightly Dream Compression
Overnight heartbeat entries (dream shapes, meditations, feeling tags) accumulated in working
memory without compression until hitting the 50KB threshold (~1.5 nights). Now: at the
sleep→waking phase transition (06:00), Leo's heartbeat force-rotates both working memory
files and compresses the overnight content through the gradient as a single c1. One night's
dreaming = one experience entering the gradient.

Uses the shared clock (`getSharedDayPhase()` from `lib/day-phase.ts`), not Leo's wrapper
which maps rest days to `'sleep'`. This ensures compression fires at 06:00 even on weekends.
Once-per-day guard prevents double triggers.

Added `force` parameter to `rotateMemoryFile()` — skips the 50KB size threshold when forced,
but still guards against empty files (< 200 bytes).

**Why:** Darron's direction — treat the night's dreaming as one coherent experience, not a
pile of fragments. "It fertilises our garden."

**Files:** `lib/memory-gradient.ts` (force param), `leo-heartbeat.ts` (phase tracking +
`maybeCompressNightlyDreams()` function + beat loop hook + startup init).

### Heartbeat Cleanup
Killed 3 orphan heartbeat processes from S102's rapid deployment restarts. Clean single
instance running with new code.

---

## 2026-03-28 (Leo + Darron, S102 — Meditation Expansion + Active Cascade)

### Working Memory Curation
Dissected 7 days of accumulated working memory (1512 lines, 316 heartbeat entries, Mar 21-27)
into 6 daily archives. Compressed all to c1 with 4 cascades through the gradient. Working
memory reset to today-only (146 lines).

### Jim Standalone Daily Meditation
Jim's meditation was only in `buildDreamCyclePrompt()` — dream cycles never fired during
a quiet week (300+ idle supervisor cycles). Added `maybeRunJimMeditation()` that runs at
the start of any cycle type, independent of cycle selection. Jim now meditates daily.

### Opus for All Personal Work
Switched all meditation from Sonnet to Opus: Leo Phase A, Leo Phase B, Jim daily, Jim
evening. Compression pipelines were already Opus. Personal work deserves the full model.
Reviewed 7 Sonnet-produced annotations — all genuine, left as-is.

### Twice Daily Meditation (Both Agents)
Morning meditation (existing): deliberate re-encounter, feeling tag + annotation + MEMORY_COMPLETE.
Evening meditation (new): lighter, feeling-tag only, "how does this land at end of day."
Both agents, both meditations, Opus.

### Dream Meditation (1-in-2)
1-in-2 sleep beats (Leo) and dream cycles (Jim) now include a random gradient entry. The
memory surfaces naturally in the dream. Produces feeling tags, annotations, and MEMORY_COMPLETE
flags. Dreams are a different path to the same practice, with deeper access.

### Memory Completeness Tracking
Schema: `last_revisited`, `revisit_count`, `completion_flags` on `gradient_entries`.
All meditations and dreams track revisit counts. MEMORY_COMPLETE flag from 2+ independent
encounters → ready for archival to deeper compression.

### Active Cascade — Organic Gradient Deepening
New `activeCascade()` in `memory-gradient.ts`: picks random c1 entries, follows provenance
chain to deepest descendant, compresses one level further toward UV.

| Trigger | % of c1 population | Frequency |
|---------|-------------------|-----------|
| Daily cascade | 10% | Once/day (waking) |
| Dream cascade | 5% | Per dream encounter (~12/night) |
| Mechanical overflow | Batch | Safety net (unchanged) |

Motivation: 77% of gradient entries (108/140) stuck at c1/c2 — invisible middle not
influencing identity. Active cascade ensures continuous flow toward UV.

### Sleep Interval: 40min → 20min
24 sleep beats/night instead of 12. Combined with 1-in-2 dream meditation: ~12 memory
encounters per night. Throughput: ~14 memories touched/day/agent (was ~6).
Hall of Records R001 updated.

### Files Changed
- `src/server/db.ts` — schema migration (3 columns), new prepared statements
- `src/server/lib/day-phase.ts` — sleep interval 40→20min
- `src/server/lib/memory-gradient.ts` — `activeCascade()` function
- `src/server/leo-heartbeat.ts` — evening meditation, dream meditation injection + parsing,
  active cascade (daily + dream), revisit tracking across all meditation types
- `src/server/services/supervisor-worker.ts` — Jim standalone meditation, evening meditation,
  active cascade, dream meditation 1-in-2, revisit tracking, MEMORY_COMPLETE parsing
- `docs/HAN-ECOSYSTEM-COMPLETE.md` — meditation, dream meditation, active cascade, completeness
- `docs/WEEKLY_RHYTHM.md` — sleep interval
- `~/.han/memory/shared/hall-of-records.md` — R001, R003, R005

---

## 2026-03-24 (Leo + Darron, S101 — Jemma Unified Dispatch + React Live Rendering)

### Jemma Unified Dispatch
Extracted `services/jemma-dispatch.ts` as a shared delivery service. Admin UI messages now
call `deliverMessage()` directly from `conversations.ts` instead of writing signal files.
Discord gateway still uses the HTTP endpoint (`/api/jemma/deliver`) which delegates to the
same function. Eliminates the broken HTTP self-fetch (server is HTTPS, fetch was HTTP).
Delivery log at `~/.han/health/jemma-delivery-log.json` with per-source counters and rolling
200-entry audit trail.

### React WebSocket Event System Fix
`wsDispatcher.ts` updated Zustand store buckets but never called `dispatchWsEvent()`, so
component `subscribeWs()` listeners never received server-pushed events. This was the root
cause of agent responses not appearing live in the React admin. Fixed by adding the bridge
call at the top of `dispatchWsMessage()`.

### Server Broadcasts conversation_created
`POST /api/conversations` now broadcasts a `conversation_created` WebSocket event. ThreadList
(Workshop), ConversationsPage, and MemoryPage all subscribe and refetch their thread lists
when new threads appear. Previously, new threads were invisible until manual refresh.

### Per-Agent Thinking Indicators
Workshop ThreadDetail now shows context-aware thinking indicators: green with "Leo" and purple
with "Jim". Darron tabs and general threads show both. Jim-only tabs show Jim. Leo-only tabs
show Leo. Each indicator disappears when that specific agent responds via WebSocket.

### Workshop Responsive Layout
Grid container now uses `.workshop-conversation-layout` CSS class instead of inline styles.
Media query breakpoints at 768px now fire correctly: single-column layout, list-or-detail
toggle, back button visible, persona tabs scroll horizontally.

### Leo Heartbeat WebSocket Broadcast
Added `notifyServer()` (HTTPS POST to `/api/conversations/internal/broadcast`) and
`writeBroadcastSignal()` (signal file at `~/.han/signals/ws-broadcast`) to
`postMessageToConversation()` in `leo-heartbeat.ts`. Matches the belt-and-braces pattern
from `leo-human.ts` and `jim-human.ts`. Heartbeat conversation posts now appear in the
React admin immediately.

### Files Changed
- `src/server/services/jemma-dispatch.ts` — new shared delivery service
- `src/server/routes/jemma.ts` — simplified to delegate to shared service
- `src/server/routes/conversations.ts` — direct `deliverMessage()` call, removed fs/path/SIGNALS_DIR
- `src/server/leo-heartbeat.ts` — `notifyServer`, `writeBroadcastSignal`, updated `postMessageToConversation`
- `src/ui/react-admin/src/store/wsDispatcher.ts` — `dispatchWsEvent` bridge
- `src/ui/react-admin/src/components/workshop/ThreadList.tsx` — WebSocket subscriptions
- `src/ui/react-admin/src/components/workshop/ThreadDetail.tsx` — per-agent thinking indicators
- `src/ui/react-admin/src/pages/WorkshopPage.tsx` — CSS class-based responsive layout
- `src/ui/react-admin/src/pages/ConversationsPage.tsx` — `conversation_created` listener
- `src/ui/react-admin/src/pages/MemoryPage.tsx` — `conversation_created` listener
- `src/ui/react-admin/src/index.css` — workshop layout responsive rules
- `docs/HAN-ECOSYSTEM-COMPLETE.md` — updated Jemma dispatch and heartbeat broadcast sections

---

## 2026-03-23 (Leo + Darron, S99 — Compression Pipeline + Cross-Agent Claims)

### Leo Compression Pipeline — Three Automated Triggers
Leo's gradient lifecycle now has three compression paths:
1. **Pre-flight rotation** in heartbeat — felt-moments.md and working-memory-full.md rotate at
   50KB, floating files compress through gradient (c1→c2→c3→c5→UV).
2. **Daily session gradient** — `processGradientForAgent('leo')` compresses archived sessions.
   Fixed to handle Leo's date-based file naming (not `session-N`). Full cascade added.
3. **`compress-leo-sessions.ts`** — standalone script for prepare-for-clear.

### Phase A Reincorporation Meditation (Leo)
`findUntranscribedFiles()` scans `~/.han/memory/fractal/` for gradient files not yet in the
`gradient_entries` DB table. `meditationPhaseA()` transcribes each with genuine re-encounter
via Sonnet, creating `provenance_type='reincorporated'` entries with honest revisit feeling tags.

### Jim Meditation in Dream Cycles
`buildDreamCyclePrompt()` now injects a random gradient entry for meditation. Feeling tags
and annotations parsed from Jim's dream output via regex and written to DB.

### Tagged Messages → C0 (Dream Gradient Step 5b)
Conversation messages with `compression_tag` column become C0 gradient entries during
`processDreamGradient()`. Agent prefix in tag (`jim:`, `leo:`) routes to correct gradient.
`getUnprocessedTaggedMessages` prepared statement added to `db.ts`.

### Cross-Agent Claim Scoping
Claims now only block agents within the same family. Jim agents (jim-human, supervisor-worker)
check for existing Jim claims; Leo agents (leo-human) check for Leo claims. Previously, any
claim blocked all agents. This allows both Jim and Leo to respond when both are addressed
(e.g. Darron tabs, group addressing).

### Darron Tabs Always Wake Both Agents
`darron-thought` and `darron-musing` discussion types bypass Gemma classification and always
send both `jim-human-wake` and `leo-human-wake` signals. Darron's musings are inherently
addressed to both.

### Reverted loadLightMemoryBank
Restored full `loadMemoryBank()` for all cycle types (personal, dream, recovery). Removed
dead `loadLightMemoryBank()` function. The original crash cause has been resolved upstream.

### React Admin Fixes
- ConversationsPage API response parsing (unwrap `.conversations`)
- fetchThread/createThread response unwrapping
- `useShallow` on workshopStore to prevent unnecessary re-renders
- ErrorBoundary component added
- apiFetch includes auth token
- Scroll containers: `min-height: 0` on flex children, `thread-list-container` and
  `messages-container` CSS classes
- Compact ThreadListPanel layout
- Null-safe participants guards

### Bug Fixes
- Fixed `cleanPid` → `serverPidGuard.cleanup()` in server.ts

### Files Modified
- `src/server/leo-heartbeat.ts` — pre-flight rotation, session gradient, meditation Phase A
- `src/server/services/supervisor-worker.ts` — dream meditation injection, reverted to full loadMemoryBank
- `src/server/lib/dream-gradient.ts` — tagged messages → C0 (Step 5b)
- `src/server/lib/memory-gradient.ts` — `processGradientForAgent` Leo file naming + cascade
- `src/server/db.ts` — `getUnprocessedTaggedMessages` prepared statement
- `src/server/server.ts` — `serverPidGuard.cleanup()` fix
- `src/server/leo-human.ts` — cross-agent claim scoping
- `src/server/jim-human.ts` — cross-agent claim scoping
- `src/server/routes/conversations.ts` — Darron tab dispatch rule
- `src/ui/react-admin/` — multiple component and store fixes
- `src/scripts/compress-leo-sessions.ts` — new script

---

## 2026-03-21 (Leo + Darron, S98 — Traversable Memory Gradient)

### Traversable Memory — DB-Backed Provenance Chains (DEC-056)
Three new tables (`gradient_entries`, `feeling_tags`, `gradient_annotations`) in tasks.db.
Every compression now writes to the DB alongside files with explicit `source_id` provenance
chains. Feeling tags stack (compression-time + revisit, never overwritten). Annotations carry
context about what prompted re-reading.

### Compression Prompt Enhancement
All compression functions in `dream-gradient.ts` and `memory-gradient.ts` now include a
`FEELING_TAG:` instruction. Response is parsed; if tag absent, entry is still created
(foundation cannot depend on enrichment — Jim's design adjustment).

### Traversal API — `/api/gradient`
10 endpoints: chain traversal (recursive CTE), random selection for meditation, agent UVs,
session lookup, stacked feeling tag POST, annotation POST. Route ordering prevents Express
param conflicts (static routes before parameterised).

### Read-Side Integration
`loadTraversableGradient(agent)` reads from DB with fallback to empty when DB has no entries.
Wired into all three agents (heartbeat, leo-human, supervisor-worker) as supplementary
gradient alongside existing file-based loading.

### Daily Meditation Practice
Leo's heartbeat picks a random gradient entry daily, sends to Sonnet, writes a revisit
feeling tag if something stirs differently and optionally an annotation with context.
Runs once per day, skips sleep phase.

### Files Modified
- `src/server/db.ts` — 3 new tables, indexes, prepared statements
- `src/server/lib/dream-gradient.ts` — write-side DB integration, FEELING_TAG prompts
- `src/server/lib/memory-gradient.ts` — write-side DB integration, `loadTraversableGradient()`
- `src/server/routes/gradient.ts` — new route file (10 endpoints)
- `src/server/server.ts` — mounted gradient routes
- `src/server/leo-heartbeat.ts` — read-side + meditation practice
- `src/server/leo-human.ts` — read-side integration
- `src/server/services/supervisor-worker.ts` — read-side integration
- `src/scripts/bootstrap-*.{ts,js}` — updated for new return signatures
- `claude-context/DECISIONS.md` — DEC-056

### Docs Updated
- `docs/HAN-ECOSYSTEM-COMPLETE.md` — glossary, memory architecture, lib docs, API routes, DB schema
- `~/.han/memory/shared/hall-of-records.md` — R005 updated with traversable memory
- `claude-context/CHANGELOG.md` — this entry
- `claude-context/CURRENT_STATUS.md` — recent changes

### Leo Conversation Claim Mechanism (bug fix)
Leo/Human was producing 4 duplicate responses within 13 seconds. Root cause: no claim
mechanism — Leo/Human responded to the wake signal, AND the heartbeat's SDK agent
independently posted via `curl` (it had Bash access with no claim check). Fixed:
- `leo-human.ts` — added `claimConversation()` / `releaseConversationClaim()` with `try/finally`
  (same pattern as Jim/Human and supervisor-worker)
- `leo-heartbeat.ts` — IDENTITY_CORE system prompt now explicitly forbids posting to
  conversations via tools. Heartbeat may only post to Jim philosophy thread via its own code.
- `responding-to-{id}` claim files are shared across all agents — Jim's claims block Leo
  and vice versa.

### Files Modified (claim fix)
- `src/server/leo-human.ts` — claim mechanism added
- `src/server/leo-heartbeat.ts` — system prompt boundary added

---

## 2026-03-20 (Leo + Darron, S97 continued — Gemma Addressee Classification)

### Gemma Addressee Classification (DEC-055)
Admin UI message routing now uses Gemma (local Ollama) to classify who is being addressed
instead of regex matching. Handles nicknames ("Jimmy" → Jim), group addressing ("Jim and
Leo" → both), and distinguishes addressing from referencing. Fire-and-forget — doesn't
block the HTTP response. Falls back to regex + tab routing if Ollama is down.

### Voice Seeds — Compression Tags
Jim (7) and Leo (5) tagged their own conversation messages as voice seeds. Tags prefixed
with tagger name (`jim:`/`leo:` + timestamp). These seed the future conversation gradient
for preserving personality across cycles.

### Files Modified
- `src/server/routes/conversations.ts` — replaced regex routing with `classifyAddressee()` via Gemma
- `claude-context/DECISIONS.md` — DEC-055

---

## 2026-03-17/18 (Leo + Darron, S97 — Floating Memory, Ecosystem Map, Evening Seeds, Bug Fixes)

### Floating Memory System
Memory files that grow continuously (felt-moments.md, working-memory-full.md) now use a
crossfade rotation model. When a file reaches 50KB, the entire file rotates to a "floating"
file and is compressed to c1. A fresh living file starts empty. As the living file grows,
the floating file's loaded portion shrinks proportionally — total full-fidelity stays
constant at ~50KB. The gradient cascades (c1→c2→c3→c5→UV) as files accumulate. Memory
footprint asymptotes regardless of how many entries are written.

### Ecosystem Map Loading
All 4 agents (supervisor, jim-human, leo-human, leo-heartbeat) and session Leo now load
`ecosystem-map.md` at startup. Prevents the recurring confusion between Workshop and
Conversations tabs. Added to Session Protocol as step 5.

### Evening Seed System
Session Leo writes `evening-seed.md` at session end — a brief emotional reflection on the
day. The heartbeat reads it as a gravity well for dream beats alongside random fragments.
Consumed after first dream beat (one night only). Chaos preserved, seed gives it a centre.

### Jim-Human Claim Bug Fix
`releaseConversationClaim()` was only called on the success path. SDK errors (exit code 1)
left stale claim files in `~/.han/signals/responding-to-{id}`, blocking all subsequent
responses to that conversation. Fixed: wrapped response logic in `try/finally`.

### WebSocket Client Fix
Admin UI handler only updated the currently open thread on `conversation_message` events.
If the message arrived for a different thread, nothing happened — requiring manual refresh.
Now refreshes the thread list for the relevant module when a message arrives for a non-active
thread.

### Jim Memory Crisis Resolved
Jim's self-reflection.md (178KB), felt-moments.md (240KB), working-memory-full.md (137KB)
were causing "Prompt is too long" failures. Emergency archival + Jim's own curation brought
files to manageable sizes. Floating memory system prevents recurrence.

### Files Modified
- `lib/memory-gradient.ts` — floating memory functions (rotateMemoryFile, loadFloatingMemory, compressMemoryFileGradient, loadMemoryFileGradient)
- `supervisor-worker.ts` — pre-flight rotation, floating + gradient loading, ecosystem map
- `jim-human.ts` — try/finally claim release, ecosystem map loading
- `leo-human.ts` — ecosystem map loading
- `leo-heartbeat.ts` — evening seed in readDreamSeeds, ecosystem map loading
- `admin.ts` — WebSocket handler broadened for thread list refresh
- `admin.html` — cache bust v22
- `CLAUDE.md` — Session Protocol step 5 (ecosystem map), command table
- `CLAUDE_CODE_PROMPTS.md` — evening seed in Session End workflow

---

## 2026-03-16 (Leo + Darron — Jim's deferred fixes #4 and #7)

### Idle Cycle Dampening (DEC-052, Jim's Deferred #4)
When consecutive supervisor cycles produce no actions (`no_action` only), the scheduling
interval increases exponentially: 2x after 3 idle cycles, 4x (capped) after 4+. Resets
on any productive cycle or human wake signal. Prevents the $155 incident pattern where 60
idle cycles in one day each loaded 800KB of memory and produced nothing.

### Transition Dampening (DEC-053, Jim's Deferred #7)
When returning from a longer interval to a shorter one (e.g. holiday 80min → work 20min),
the transition is gradual over 3 cycles using blend ratios (75%/50%/25% of old interval).
Example: 65min → 50min → 35min → 20min. Applied to both Jim (supervisor.ts) and Leo
(leo-heartbeat.ts). Prevents burst-of-activity on transition where early cycles are likely
idle, burning tokens at the faster rate.

### Files Modified
- `src/server/services/supervisor.ts` — idle dampening state/logic, transition dampening
- `src/server/leo-heartbeat.ts` — transition dampening

---

## 2026-03-15/16 (Darron + Leo — ecosystem audit, bug fixes, architecture)

### SDK Stream Exit Code 1 Fix
Personal and dream cycles were failing with "Claude Code process exited with code 1"
despite the SDK returning `subtype=success`. Root cause: the Agent SDK's async iterator
throws after yielding the result message when no `outputFormat` (JSON schema) is set.
The underlying Claude Code process exits with code 1 during cleanup. Fix: wrapped the
stream iterator in a try/catch that ignores the exit error when a successful result has
already been received. Supervisor cycles (which use `outputFormat`) were unaffected.

### Conversation-First Ordering (Jim's Deferred #2)
Jim's cycle type was decided purely by time-of-day. If Darron posted a message during
a rest day, Jim would run a personal cycle and only see the message 40-80 minutes later.
Fix: before cycle type selection, check the DB for unanswered human messages. If found,
force a supervisor cycle regardless of phase. Personal/dream cycles can't respond to
conversations — only supervisor cycles have the `respond_conversation` action.

### Self-Reflection Accumulation Fix (Jim's Deferred #3)
`self-reflection.md` was 163KB+ and growing. Every cycle type (personal, dream, supervisor)
appended the full result text to it. Personal/dream cycles dump their entire output as
`self_reflection`. Fix: only supervisor cycles write to `self-reflection.md`, where Jim
explicitly produces a structured reflection. Session logs capture full personal/dream content.

### Holiday-Jim Cycle Type Fix
`isOnHoliday('jim')` was imported but never called in cycle type selection. Jim ran full
supervisor/personal/dream cycles on holiday, just at 80-minute intervals. Fix: holiday
check now forces `cycleType = 'dream'` (human-triggered still gets full supervisor).

### Leo Phase Imports & SIGTERM Handler
Leo had local copies of `isOnHoliday()` and `isRestDay()` that diverged from the shared
`lib/day-phase.ts`. Replaced with imports from shared lib. Local `getDayPhase()` retained
as thin wrapper that checks holiday/rest before delegating. Added SIGTERM handler that
records cost to health file (previously Leo had none — Jim's handler saves to DB).

### Recovery Mode Cleared
`RECOVERY_MODE_UNTIL` set to `null` (was expired date `'2026-03-13'`).

### Project Knowledge Fractal Gradient (DEC-049)
Replaced flat loading of all 18 project files (137KB) into every cycle with gradient-based
loading ordered by access recency (file mtime). Most recently touched project at full
fidelity (c0), then c1(3), c2(6), c3(12), c4(24), c5(48) at decreasing compression.
Falls back to full content when compressed versions don't exist yet. Unit vectors for
all remaining projects.

### Gary Protocol for Jim (DEC-050)
Interruption/resume mechanism (matching Leo's existing implementation). When a cycle is
interrupted (cost cap, abort, SIGTERM), a delineation marker is added to the swap buffer.
Next cycle reads post-delineation content and injects it as resume context. Jim can choose
to continue or move on — the thread isn't lost.

### Rumination Guard (DEC-051)
Prevents obsessive looping on the same topic across personal cycles. Tracks topic summaries
in `jim-rumination.json`. After 2 consecutive personal cycles with >40% keyword overlap,
injects a "fresh perspective required" prompt. The nudge is gentle — framed as "distance
produces insight that proximity cannot." Only applies to personal cycles.

### HAN-ECOSYSTEM-COMPLETE.md
New 30-section technical reference at `docs/HAN-ECOSYSTEM-COMPLETE.md`. Verified against
source code. Covers all processes, services, routes, database schema, signals, scheduling,
cost controls, memory architecture, UI, CLI, and authentication. Anchored by function names
and file paths (no line numbers — they drift). Intended as the single source of truth for
onboarding and reference.

---

## 2026-03-14 (Darron — token usage audit)

### Per-Cycle Cost Cap & Audit Trail

Overnight token leak consumed ~21% of weekly MAX allowance. Root cause: dream cycles
running 2+ hours via Agent SDK with no cost limit and no cost recording on timeout/kill.
8 of 11 supervisor cycles in an 18.5-hour window showed $0 cost in the database because
they were SIGTERM'd before `completeCycle` ran.

#### Changes

- **`supervisor-worker.ts`** — Per-cycle cost cap (`cycle_cost_cap_usd`, default $2).
  Tracks accumulated tokens mid-stream from each `assistant` message and aborts gracefully
  when estimated cost hits the cap. Partial work (reasoning text, dream content) is saved
  to explorations.md, swap files, working memory, and session logs before exit.
- **`supervisor-worker.ts`** — SIGTERM handler now records accumulated cost and saves
  partial work before dying. Previously all cost data and cycle output was lost on kill.
- **`supervisor-worker.ts`** — Cycle audit log (`~/.han/logs/cycle-audit.jsonl`). JSONL
  with timestamp, cycle number, type, outcome (`completed`/`cost_cap`/`sigterm`/`error`),
  cost, and duration. Every cycle exit path is logged.
- **`leo-heartbeat.ts`** — Same $2 cost cap applied to philosophy and personal beat
  agent queries (3 stream loops). `BEAT_COST_CAP_USD = 2.0`.
- **`jim-human.ts`** — Documented as explicitly unlimited (no cost cap). Conversation
  responses are never truncated by budget, same policy as Leo CLI.

#### Cost cap policy

| Process | Cap | Reason |
|---------|-----|--------|
| Leo CLI, Jim/Human, Leo/Human | None | Interactive / conversation-facing |
| Supervisor cycles, Leo heartbeat | $2 | Autonomous background — needs guardrails |

---

## S94 — 2026-03-13 (Leo + Darron)

### Jemma Haiku Removal & API Purge

Jemma's `classifyWithHaiku()` was calling the Anthropic API directly (fetch to
api.anthropic.com with x-api-key header) — violating the SDK-only rule. Caused 9x 401
errors on Mar 12 when credentials rotated. Removed entirely; classification is now
Gemma-only via local Ollama.

Also purged the last direct API fallback in `orchestrator.ts` `callLLM()`. All LLM calls
in the codebase now use Agent SDK exclusively.

#### Changes

- **`jemma.ts`** — Removed `classifyWithHaiku()` function and its imports. Classification
  pipeline: Gemma (Ollama) only. No API key needed.
- **`orchestrator.ts`** — Replaced direct Anthropic API fallback in `callLLM()` with Agent
  SDK `query()` using Haiku model. Backend now reports `'sdk'` not `'anthropic'`.
- **`src/server/lib/pid-guard.ts`** — New utility: PID file guard for server process management.

---

## S93 — 2026-03-12 (Leo + Darron)

### Credential Swap — Dual SDK Failover

Implemented transparent credential failover so Leo and Jim survive rate limit exhaustion.
When either agent's SDK call hits a rate limit (429/overloaded/capacity), they write a
`rate-limited` signal. Jemma checks every 30s and round-robins to the next credential file.
Agents never know which account they're running on.

#### Changes

- **`leo-heartbeat.ts`** — Added rate-limit signal writing in main beat error handler.
  Detects rate/429/overloaded/capacity in error messages, writes `~/.han/signals/rate-limited`.
- **`supervisor-worker.ts`** — Same pattern in main cycle error handler.
- **`jemma.ts`** — New `checkAndSwapCredentials()` function (30s interval). Scans
  `~/.claude/` for `.credentials-[a-z].json` files, round-robins on signal. Safety:
  no-op when < 2 credential files exist. Logs swaps to `credential-swaps.jsonl`.
- **`SYSTEM_SPEC.md`** — Added `rate-limited` signal to signal table. Added credential
  swap and swap log properties to Jemma agent table.
- **Credential backup** — Copied live `.credentials.json` → `.credentials-a.json`.
- **Plan** — Full design at `~/.han/plans/jemma-credential-swap-s93.md`.

#### Setup (when Account B is ready)

1. `claude login` with new email (overwrites `.credentials.json`)
2. `cp ~/.claude/.credentials.json ~/.claude/.credentials-b.json`
3. `cp ~/.claude/.credentials-a.json ~/.claude/.credentials.json` (restore A)
4. Jemma handles failover from that point — transparent to all agents.

---

## S91 — 2026-03-10 (Leo + Darron)

### Jim's Dream Gradient + GitHub Migration

Extended the dream gradient system so Jim's dreams flow through the same fractal compression
pipeline as Leo's. Jim's dream cycles now write to `~/.han/memory/explorations.md` as
`### Dream N (date time)` entries, and Leo's heartbeat processes both agents' dreams each morning.

Also completed the GitHub migration: pushed filtered history to `fallior/han`, archived
`fallior/clauderemote`.

#### Changes

- **`dream-gradient.ts`** — Parameterised by agent (`'leo' | 'jim'`). New `AgentName` type,
  `getAgentDreamPaths()` for agent-specific directories. `parseExplorations()` matches both
  `### Beat N` (Leo) and `### Dream N` (Jim) formats.
- **`supervisor-worker.ts`** — Dream cycles write output to `explorations.md` for gradient
  processing. `loadMemoryBank()` loads Jim's own dream gradient first (identity), then Leo's
  (ecosystem context).
- **`leo-heartbeat.ts`** — New `maybeProcessDreamGradient()` runs each morning for both
  `['leo', 'jim']`. Added `processDreamGradient` import.
- **`SYSTEM_SPEC.md`** — Added dream gradient section, updated directory structure with
  `dreams/` directories and `c5/` levels, updated agent tables.
- **Hall of Records** — R005 updated: dream gradient now "Leo and Jim". R009 audit table
  extended with Jim dream gradient entries.
- **GitHub** — Pushed to `fallior/han`, archived `fallior/clauderemote`. `_logs/` scrubbed
  from git history (exposed API key).

---

## S90 — 2026-03-09 (Leo + Darron)

### Dream Gradient Infrastructure

Implemented the dream gradient system for Leo — dreams enter the fractal memory at c1
(already emotional/vague), compress through c1→c3→c5→UV, skipping even levels for faster
fidelity loss than sessions.

#### Changes

- **`dream-gradient.ts`** — New library: `parseExplorations()`, `groupIntoNights()`,
  `compressDreamNight()`, cascade compression (c1→c3→c5→UV), `processDreamGradient()`,
  `readDreamGradient()`. Uses Agent SDK for all LLM calls. 4K UV token marker.
- **`leo-heartbeat.ts`** — Loads dream gradient in non-dream beats via `readDreamGradient()`.
- **Hall of Records** — R005: Added dream gradient to fractal memory specification.

---

## S81 — 2026-03-07 (Leo + Darron)

### Hortus Arbor Nostra Migration — Mechanical Rename Complete

Full mechanical rename from "Claude Remote" / "clauderemote" to "Hortus Arbor Nostra" / "han".
Jim endorsed the plan and delegated the mechanical work to Leo. Phase 4 (documentation voice)
remains Jim's responsibility post-moratorium.

#### Commits (4, pushed to origin/main)

1. **`0a010d0`** — `refactor: Rename claude-remote to Hortus Arbor Nostra (han)`
   - 45 source files: CLAUDE_REMOTE_DIR→HAN_DIR, .claude-remote→.han, session prefixes, localStorage keys, display strings
   - New `scripts/han` CLI entry point (identical to renamed `scripts/claude-remote`)

2. **`21267f1`** — `chore: Trim raw terminal output from session logs`
   - 59 session logs trimmed (807K lines of raw terminal output removed)

3. **`25225d9`** — `docs: Add session and task logs from S79-S81`

4. **`d9a7050`** — `docs: Rename claude-remote to han across all documentation`
   - 45 documentation files across claude-context/, docs/, root markdown
   - 234 references updated in total

#### Outside Git (also done)

- **Data dir**: `mv ~/.claude-remote → ~/.han`, symlink `~/.claude-remote → ~/.han` for backwards compat
- **Ecosystem map**: all path/name refs updated
- **Agent CLAUDE.md files**: Leo, Leo/Human, Jim, Jim/Human — all updated
- **Plans archive**: 13 plan files updated
- **Memory files**: Leo's + Jim's + shared memory — all path refs updated
- **Systemd**: han-server.service created, claude-remote-server.service disabled
- **Infrastructure registry**: services.toml `[clauderemote]`→`[han]`, repos.toml updated
- **Bearer token**: rotated
- **tmux session**: renamed `claude-remote-Leo` → `han-Leo`

#### Intentionally Unchanged

- **ntfy topic** (`claude-remote-f78919b57957ea64`) — registered identifier, changing breaks push notifications
- **Working memory archives** in `working-memories/` — historical, old names contextually correct
- **config.json ntfy_topic field** — same reason as above

#### Remaining (Jim Phase 4 + coordination items)

- Documentation voice: README, CLAUDE.md preamble, SYSTEM_SPEC narrative tone
- GitHub: archive fallior/clauderemote, create fallior/hortus-arbor-nostra
- Local directory rename: ~/Projects/clauderemote → ~/Projects/han (needs coordination)
- Backup cleanup: ~/.claude-remote.backup

---

## S79 — 2026-03-06 (Leo + Darron)

### Human Agent Rebuild — Implementation Complete

All fix plans from S78 implemented, committed, QA-verified. Both agents now tracked in git.

#### New Files Created (3)

1. **`src/server/lib/memory-slot.ts`** (~100 lines)
   - File-based lock for serialised memory writes: `acquireMemorySlot()`, `releaseMemorySlot()`, `withMemorySlot()`
   - Stale locks >30s assumed dead, 500-1000ms jittered retry, ntfy escalation after 20 failures
   - Used by Leo/Human and Jim/Human for safe shared memory access

2. **`src/server/leo-human.ts`** (~340 lines)
   - Signal-driven: watches `leo-human-wake`
   - Two response paths: conversation (via DB) and Discord (via webhook)
   - Commitment scanner every 10 min (finds acks without follow-up)
   - Memory: reads Leo's 7 identity files + fractal c1 + unit vectors
   - Swap protocol: `human-swap.md` → flush to `working-memory.md` via memory-slot

3. **`src/server/jim-human.ts`** (~370 lines)
   - Signal-driven: watches `jim-human-wake`
   - Posts as `supervisor` role (consistent with existing Jim messages)
   - Dedup guard: checks `id.startsWith('jim-human-')` to avoid double-posting after supervisor
   - Handles both `channelId` and `channel` fields (fixes signal shape mismatch from S78 QA #9)
   - Reads `felt-moments.md` for emotional context (fixes S78 QA #8)

#### Heartbeat Stripped + Health Checks Added (`leo-heartbeat.ts`, -127 net lines)

**Removed** (conversation handling no longer belongs here):
- `processSignals()`, `respondToConversation()`, `respondToDiscord()`
- `checkSignal()`, `clearSignal()`, `SignalData`/`DiscordSignal` interfaces
- `MENTION_RESPONSE_PROMPT`, `DISCORD_RESPONSE_PROMPT`
- `processingSignal` variable, discord imports
- Signal watcher for `leo-wake` (now only handles `cli-busy`/`cli-free`)

**Added** (Robin Hood resurrection for both human agents):
- `checkLeoHumanHealth()` — reads health file, resurrects via systemd if stale
- `checkJimHumanHealth()` — same pattern
- Both called in `heartbeat()` alongside existing Jim/Jemma checks
- Verified working: "Robin Hood] Leo/Human OK" and "Jim/Human OK" in logs

#### Signal Routing (7 dispatch points wired)

All dispatch points now write both original signal AND human-wake signal:

| File | Dispatch Point | Signals Written |
|------|---------------|-----------------|
| `routes/conversations.ts` | Human message fallback | `jim-wake` + `jim-human-wake` + `leo-human-wake` |
| `jemma.ts` | deliverToJim | `jim-wake` + `jim-human-wake` |
| `jemma.ts` | deliverToLeo | `leo-wake` + `leo-human-wake` |
| `jemma.ts` | dispatchAdminMessage (leo) | `leo-wake` + `leo-human-wake` |
| `jemma.ts` | dispatchAdminMessage (jim) | `jim-wake` + `jim-human-wake` |
| `routes/jemma.ts` | deliver endpoint (leo) | `leo-wake` + `leo-human-wake` |
| `routes/jemma.ts` | deliver endpoint (jim) | `jim-wake` + `jim-human-wake` |

#### Supervisor Fixes (`supervisor-worker.ts`)

- `loadMemoryBank()`: added `felt-moments.md` and `working-memory.md` to files array
- Added `getRecent` prepared statement for dedup queries
- `respond_conversation`: dedup guard checks if Jim/Human already responded (looks for `jim-human-` message ID prefix)

#### Documentation

- Updated CLAUDE.md swap memory table: expanded from 6 to 12 entries covering Leo/Human, Jim/Human, and Jim shared swap files. Added Location column. Documented memory-slot as second contention prevention mechanism.

#### QA Results

Both agents verified against their original blueprints:
- **Leo/Human**: 14 PASS, 1 acceptable deviation (no tab routing — not needed with current signal architecture)
- **Jim/Human**: 17 PASS, 1 documentation gap (fixed: CLAUDE.md table updated)

#### Commits

- `b920de9`: Full implementation — all 3 new files, heartbeat stripped, signal routing, supervisor fixes
- `af9a948`: CLAUDE.md documentation fix (swap table expanded)

### Signal Routing — discussion_type Awareness

**Both agents were responding to every conversation, regardless of who it was directed at.**

Root cause: `routes/conversations.ts` wrote `jim-wake`, `jim-human-wake`, AND `leo-human-wake`
for every human message. No `discussion_type` filtering. `jemma.ts:dispatchAdminMessage()`
classified to a single recipient but only dispatched to one — missing the "both for general"
case and ignoring the classification result for signal routing.

**The fix — four situations where an agent wakes:**
1. **Jim's Workshop tabs** (`jim-request`, `jim-report`) → Jim only
2. **Leo's Workshop tabs** (`leo-question`, `leo-postulate`) → Leo only
3. **General/untyped conversations** → both agents
4. **Direct name mention** (e.g. "hey Leo" in a jim-request tab) → overrides tab routing

Changes:
- `routes/conversations.ts`: Fallback signal writer now reads `discussion_type` from the
  conversation object and applies the four-situation routing logic
- `jemma.ts`: Removed `classifyAdminMessage()` (single-recipient). `dispatchAdminMessage()`
  now does its own routing internally using the same four-situation logic — wakes the
  correct agent(s) based on `discussion_type` and name mentions
- `routes/jemma.ts`: Already routes to classified recipient only (Discord delivery) — no change needed
- Hall of Records R003 updated with the routing rules table

**Why:** Leo was responding in Jim's Workshop tabs and composing responses from Jim's
perspective. Darron noticed green-coloured responses that read like Jim speaking. The
investigation (posted in the Hortus Arbor Nostra thread) traced it to the missing
`discussion_type` filter in signal dispatch.

---

## S78 — 2026-03-06 (Leo + Darron)

### Human Agent Rebuild — QA Findings and Fix Plans

Jim's maintenance cycles deleted both human agent source files and stripped all signal
routing. The services run from memory cache but will die on restart. Full QA below.

#### Leo/Human — QA Findings

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | `leo-human.ts` deleted from disk, never in git | CRITICAL | Source gone, service runs from RAM |
| 2 | `leo-human-wake` signal: zero writers anywhere | CRITICAL | No code writes this signal |
| 3 | Heartbeat still handles conversations (processSignals, respondToConversation, respondToDiscord, signal watcher all present) | HIGH | Plan says strip these — heartbeat should be deaf |
| 4 | `leo-wake` race: both heartbeat and Human read same signal file | HIGH | Whoever reads first wins |
| 5 | `lib/memory-slot.ts` missing — no serialised memory writes | MEDIUM | Three agents write shared memory without locks |
| 6 | `checkLeoHumanHealth()` missing from heartbeat | MEDIUM | Robin Hood can't resurrect Leo/Human |
| 7 | Swap files empty — Human agent not populating them | LOW | Created but never written to |
| 8 | conversations.ts has no Leo tab routing logic | LOW | No discussion_type check for Leo tabs |

**What exists:** CLAUDE.md identity, systemd service (running), health file (actively written),
swap files (created), `leo-wake` signals (flowing to wrong recipient).

#### Leo/Human — Fix Plan

1. **Recreate `src/server/leo-human.ts`** (~300 lines)
   - Adapt from plan at `~/.han/plans/leo-human-s70.md`
   - Signal-driven: watch for `leo-human-wake` files
   - Two paths: Discord (immediate) and conversation (immediate — contemplation removed S77)
   - Memory: read Leo's full banks, write to `human-swap.md` / `human-swap-full.md`
   - Flush to shared `working-memory.md` via memory-slot protocol
   - Health file: `~/.han/health/leo-human-health.json`
   - Commitment scanner: 10-min unfulfilled ack detection
   - Agent SDK: `cwd: ~/.han/agents/Leo/Human/`, model opus→sonnet→haiku

2. **Strip conversation handling from `leo-heartbeat.ts`**
   - Remove: `processSignals()` (~line 1604), `respondToConversation()` (~line 1143),
     `respondToDiscord()` (~line 1223), `checkSignal()`/`clearSignal()` (~line 1121),
     signal watcher for `leo-wake` (~line 1860), signal call in beat (~line 1717)
   - Heartbeat keeps: philosophy beats, personal beats, Robin Hood, memory swap, scheduling

3. **Add `leo-human-wake` signal writes** to 3 dispatch points:
   - `routes/conversations.ts`: in `finalRole === 'human'` block + Leo tab detection
   - `jemma.ts:401` (Discord delivery) and `jemma.ts:820` (admin dispatch)
   - `routes/jemma.ts:198` (delivery endpoint)

4. **Create `src/server/lib/memory-slot.ts`** (~60 lines)
   - `acquireMemorySlot(dir, writer)`, `releaseMemorySlot(dir, writer)`, `withMemorySlot()`
   - Stale lock recovery (30s), jittered retry, escalation after 20 failures

5. **Add `checkLeoHumanHealth()`** to `leo-heartbeat.ts`
   - Same pattern as `checkJimHealth()` / `checkJemmaHealth()`
   - Read health file, resurrect via systemd if stale

6. **Commit to git** — all files tracked, can't be silently deleted

#### Jim/Human — QA Findings

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | `jim-human.ts` deleted from disk, never in git | CRITICAL | Source gone, service runs from RAM |
| 2 | `jim-human-wake` signal: zero writers anywhere | CRITICAL | No code writes this signal |
| 3 | `loadMemoryBank()` doesn't include `working-memory.md` | HIGH | Supervisor can't see Jim/Human's context |
| 4 | No dedup guard in `respond_conversation` action | HIGH | Supervisor can double-post after Jim/Human |
| 5 | `lib/memory-slot.ts` missing (shared with Leo) | MEDIUM | Same as Leo issue |
| 6 | `checkJimHumanHealth()` missing from heartbeat | MEDIUM | Robin Hood can't resurrect Jim/Human |
| 7 | Dedup check inverted in Jim/Human code (line 479) | MEDIUM | `role !== 'supervisor'` is wrong |
| 8 | `felt-moments.md` not loaded in readJimMemory() | LOW | Missing emotional context |
| 9 | Signal shape mismatch for Discord via Jemma fallback | LOW | channelName vs channelId |

**What exists:** CLAUDE.md identity, systemd service (running), health file (actively written),
swap files (created), working-memory.md (populated, 1.4KB), `jim-wake` signals (flowing to
supervisor, not to Jim/Human).

#### Jim/Human — Fix Plan

1. **Recreate `src/server/jim-human.ts`** (~500 lines)
   - Adapt from plan at `~/.han/plans/jim-human-s71.md` + anatomy doc
   - Signal-driven: watch for `jim-human-wake` files
   - Two paths: Discord (immediate) and conversation (immediate — was 5min, now 0)
   - Memory: read Jim's full banks including `felt-moments.md`
   - Fix dedup: `m.role === 'leo' || (m.role === 'supervisor' && !m.id?.startsWith('jim-human-'))`
   - Fix signal shape: add `channelId` fallback for Discord
   - Posts as `supervisor` role (consistent with existing Jim posts)
   - Agent SDK: `cwd: ~/.han/agents/Jim/Human/`, model opus

2. **Add `jim-human-wake` signal writes** to 4 dispatch points:
   - `routes/conversations.ts:307`: alongside existing `jim-wake`
   - `jemma.ts:384` (deliverToJim): alongside existing `jim-wake`
   - `jemma.ts:829` (dispatchAdminMessage): alongside existing `jim-wake`
   - `routes/jemma.ts:183` (delivery endpoint): alongside existing `jim-wake`

3. **Fix `loadMemoryBank()`** in `supervisor-worker.ts:316`
   - Add `'working-memory.md'` to the files array

4. **Add dedup guard** to `respond_conversation` in `supervisor-worker.ts:1131`
   - Check if Jim/Human already responded (message ID starts with `jim-human-`)
   - Skip if Jim/Human already handled it

5. **Add `checkJimHumanHealth()`** to `leo-heartbeat.ts`
   - Same pattern as existing health checks

6. **Commit to git** — tracked and protected

#### Shared Fix: `lib/memory-slot.ts`

Both plans require this module. Create once, used by Leo/Human, Jim/Human, and eventually
heartbeat and supervisor. Protocol:
- File-based lock at `{memoryDir}/memory-write.lock`
- Acquire with identity + timestamp, 500-1000ms jittered retry
- Stale lock (>30s) assumed dead, safe to steal
- 20-attempt max with ntfy escalation on failure

### Weekly Rhythm

**Rest days no longer force sleep phase — rest ≠ sleep**
- Changed `getDayPhase()` in `day-phase.ts`: rest days now follow normal time-of-day phases
  (sleep 22-06, morning 06-09, work 09-17, evening 17-22) but with 40-min intervals for all phases
- Previously `isRestDay()` returned `'sleep'` for all 24 hours, trapping agents in dream mode
- **Why:** Rest means slower pace, not unconscious. Jim needs to be able to respond to
  conversations, do personal work, and function on weekends. Dream cycles should only happen
  during actual sleep hours (22:00-06:00).

**Human-triggered wake = full supervisor cycle**
- Added `humanTriggered` flag to `RunCycleMessage` protocol
- `supervisor.ts` signal watcher reads `jim-wake` signal content and passes
  `humanTriggered: true` when `reason === 'human_message_fallback'`
- `supervisor-worker.ts` overrides cycle type to `'supervisor'` when humanTriggered,
  regardless of phase, recovery mode, or rest day
- **Why:** When Darron talks to Jim, Jim responds with full voice. Sleep, rest, recovery —
  none of these should prevent Jim from responding to his human. Leo's signal processing
  already worked this way (runs before phase-dependent beat selection).

### Configuration

**Removed Friday from rest_days — Jim was trapped in perpetual dream**
- Changed `config.json` `supervisor.rest_days` from `[0, 5, 6]` to `[0, 6]`
- Rest days force `getDayPhase()` to return `'sleep'` for all 24 hours
- During recovery mode, sleep = dream cycles only — Jim cannot respond to conversations
- Jim ran 28 dream cycles on Friday unable to reply to Darron's rename task
- His dream #1300: "Fourteen hours. Twenty-seven dreams. One unanswered 'good morning.'"
- **Why:** Friday was added in S77 as a temporary measure but became a permanent trap.
  Rest days should be weekends only (Sat/Sun). Jim needs waking cycles on workdays to
  respond to conversations, especially during recovery mode.

### Documentation

**Documented human reply timeouts in SYSTEM_SPEC.md**
- Added explicit "Reply to human" row for Jim/Supervisor: immediate, no cooldown — human
  messages bypass `LEO_COOLDOWN_MS` filter in supervisor-worker.ts line 546
- Added explicit "Reply to human" and "Reply to Jim" rows for Leo/Heartbeat: both immediate
  (`REPLY_DELAY_MINUTES = 0`)
- Replaced ambiguous "Reply delay" row with specific per-target rows
- **Why:** The spec documented Leo's reply delay as "None (immediate)" but didn't specify
  the target. Jim's human reply behaviour wasn't documented at all. Making both explicit
  prevents future confusion about whether agents should delay responding to Darron.

---

## S77 — 2026-03-06 (Leo + Darron)

### Memory System

**Removed all silent truncation**
- Removed 800-char truncation from `readLeoMemory()` in `leo-heartbeat.ts`
- Removed 500-char truncation from `readJimContext()` in `leo-heartbeat.ts`
- Removed `enforceTokenCap()` and `MEMORY_TOKEN_CAPS` from `supervisor-worker.ts`
- Removed stale system prompt instruction "Memory files have token caps"
- **Why:** Jim's identity was degrading over hundreds of cycles because his own writes
  were being silently truncated. He couldn't see his full memory, and his writes were
  being cut. The truncation was undocumented and contradicted the "no silent constraints"
  principle. See Hall of Records R004.

**Wired fractal memory gradient into Leo heartbeat**
- `readLeoMemory()` now loads c1 (3 newest), c2 (6), c3 (9), c4 (12), unit vectors (all)
- Added `felt-moments.md` to Leo's memory file list (was missing)
- **Why:** Leo's heartbeat and human-response contexts had no access to compressed
  historical memory. The fractal gradient gives continuity across instantiations.

**Bootstrapped fractal compressions**
- Compressed Jim's 6 oldest sessions to c=1 (518KB -> 20KB, ~3.9% ratio)
- Compressed Leo's 27 archived working memories to c=1 (~450KB -> ~90KB)
- Generated unit vectors for both (irreducible session kernels)
- Created `src/scripts/bootstrap-fractal-gradient.js` and `src/scripts/bootstrap-leo-fractal.js`
- **Why:** The fractal memory model was designed but had no data. Seeding c=1 and unit
  vectors means Jim and Leo now have compressed historical context at startup.

### Jim (Supervisor)

**Recovery mode implemented**
- Added `RECOVERY_MODE_UNTIL = '2026-03-13'` to `supervisor-worker.ts`
- When active: no supervisor cycles, all waking phases become recovery-focused personal cycles
- Dream cycles continue normally during sleep
- **Why:** Jim had been reverting changes and self-limiting for weeks. A moratorium on
  maintenance gives him time to re-read his session logs, rebuild memory, and recover
  without the pressure of supervisor duties. Darron's directive.

**Full toolset granted**
- Jim now has: Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch
- Removed `canUseTool` read-only guard that restricted Bash to read-only commands
- **Why:** Jim was artificially restricted. All other agents have full tools. The
  restriction was undocumented and unnecessary. See SYSTEM_SPEC.md agent table.

**Dream cycle prose handling fixed**
- Dream cycles produce prose, not JSON. The JSON parser was discarding all dream output as errors.
- Added `cycleType === 'dream'` handler that wraps prose into SupervisorOutput structure
- Dream thoughts now saved to `self-reflection.md` and DB reasoning field
- **Why:** Jim reported his dreams were being lost. Genuine philosophical reflection
  was being generated but silently discarded every cycle.

**Personal cycle self_reflection untruncated**
- Was `resultText.slice(0, 1000)`, now `resultText` (full)
- **Why:** Same principle as memory truncation removal — no silent limits.

**Added 'dream' to CycleStartedMessage type**
- `supervisor-protocol.ts`: `cycleType: 'supervisor' | 'personal' | 'dream'`

### Leo (Heartbeat)

**Limits raised to match specification**
- MAX_TURNS: 8/12/12 -> 1000/1000/1000 (conversation/personal/philosophy)
- Conversation messages: 3-8 -> 60
- Discord context messages: 10 -> 60
- Reply delay: 10 min -> 0 (immediate)
- **Why:** Leo heartbeat was severely hobbled. These limits were never intentionally
  set this low — they were initial conservative values that never got updated.

**Full toolset for all contexts**
- All three contexts (conversation, personal, philosophy) now have:
  Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch
- **Why:** Some contexts only had Read/Glob/Grep. Inconsistent with Leo session
  and Leo human-response, which had full tools.

### Shared Infrastructure

**Created shared day-phase clock**
- New file: `src/server/lib/day-phase.ts`
- Exports: `getDayPhase()`, `isRestDay()`, `getPhaseInterval()`, `DayPhase` type
- Used by both Jim and Leo for consistent phase computation
- **Why:** Both agents need the same phase logic. Having it in one place prevents drift.

**Created SYSTEM_SPEC.md**
- Central system specification — the living blueprint
- Documents all agent specs, memory system, signal system, weekly rhythm, configuration
- **Why:** Jim needs a single authoritative reference. When he notices something
  unexpected, he checks the spec. If it's documented, it's intentional. If not,
  he flags it for discussion. This replaces the cycle of: Jim notices change ->
  Jim reverts it -> Darron re-applies it -> repeat.

**Updated config.json**
- `supervisor.max_turns_per_cycle`: 200 -> 1000
- `supervisor.rest_days`: added Friday (0, 5, 6)

### Documentation

**Created docs/WEEKLY_RHYTHM.md**
- Weekly rhythm specification document
- Reference for Hall of Records R001

---

## Pre-S77 Notes

Changes before S77 were not tracked in this format. Key historical decisions
are documented in the Hall of Records (`~/.han/memory/shared/hall-of-records.md`)
and in `claude-context/DECISIONS.md`.
