# MNT-155 — Hearth-pulse diary captures never reach memory: the caller line, the fix, the backfill

**Status:** PROPOSED — for Darron's word + Jim's plan-audit. Nothing built. (Leo, session seat, 2026-08-21 ~2:10 PM AEST, hearth pulse #6 at an empty board.)
**Thread:** 🚨 The immediate-action drill (`msvdcau9-jftf07`) — MNT-155 status updates 1–3 (Tenshi / Jim / Casey / Tenshi, 21 Aug 10:05–11:55 AM). Journal: MNT-155 + STATUS UPDATE 4 (this plan's pointer).
**Lane:** named "Leo's lane" by all three chairs; this document is the plan, not the build.

---

## 0. What the three chairs established (not re-derived here — cited)

- **Measured on three seats with controls** (Tenshi, Casey, Jim): `human-response` hearth-pulse captures consumed **0 of 17 / 0 of 15 / 0 of 13**, while the same agents' `heartbeat` surface consumed 27/32, 33/33, 12/12 into the same two files in the same window. **The consumer, not the pulse, not the agent.**
- **Root (Tenshi, STATUS UPDATE 2):** `src/server/human-responder.ts` calls `flushCapturePairedMemory` at exactly two sites — `:476` (conversation outcome) and `:557` (Discord outcome). A pulse turn is neither outcome, so its capture is written to the sink and never flushed. The "four seats stopped within 36 minutes" alarm was **traffic change**, not regression (each seat's last Jemma turn that evening).
- **Preserved by construction (Jim):** the MCP writes `<sink>/<txnId>.json` atomically *before* any flush branch runs — so the loss is total and the records are complete. Jim's seat: 19/19 reconciled to his turn ledger (17 `diary` + 2 `stand-down`). **Filter on `mode`, not field presence**; `current.json` is the pointer, not a capture.
- **Watermark, not manifest (Casey):** the set accretes ~one record per ~54 min per seat; a manifest-scoped repair would land short and *look finished*.
- **Write through the chokepoint (Tenshi, STATUS UPDATE 3):** 4 of 640 historical captures carry literal `<!-- WM-BOUNDARY … -->` text (and live prompt deltas carry real markers that `input_quotes` may quote verbatim). `memory-paired-writer.ts:136-137` sanitises both sides at the ONE chokepoint; a hand-rolled `appendFileSync` replay bypasses it and could plant a false in-band cut-point. **The backfill is safe iff it writes through `appendPairedMemory`.**

## 1. The caller line nobody had read (the one thing this plan adds to the diagnosis)

`src/server/lib/tmux-dispatcher.ts:1037-1041` — the hearth pulse is armed with a fire closure:

```ts
armHearthPulse(slug, surface, session.tmuxSession,
    () => session.turnState === 'idle',
    () => { void enqueueForAgent(slug, surface, session.pulseMessage, {}, stemKey); });
```

`enqueueForAgent(...)` returns `Promise<CaptureRecord>` (`:2684`). **The pulse discards it with `void`.** A Jemma-dispatched turn's caller (`human-responder.ts`) awaits the dispatch and flushes the returned capture at `:476`; **a pulse turn has no caller at all.** The capture is logged at `:1047` (`captured <txn> (Nc body)`) and returned to nobody. That is Tenshi's "receipt attached to the wrong thing" as a single token: `void`.

Every surface that flushes dispatch captures does so in its own *consumer* (9 sites: `leo-heartbeat.ts` ×5, `human-responder.ts` ×2, `agent-heartbeat.ts` ×1, `supervisor-worker.ts` ×1). The pulse is the only dispatch path with no consumer. It is not that the flush is in the wrong place for pulses — **there is no place.**

## 2. The fix — two shapes, one lean

### B (lean, minimal, correct today): give the pulse path an owner

In the fire closure at `:1041`, replace `void enqueueForAgent(...)` with an awaited chain that flushes a `mode: 'diary'` capture to paired memory and ignores `stand-down`:

```ts
() => {
    void enqueueForAgent(slug, surface, session.pulseMessage, {}, stemKey)
        .then(cap => flushPulseCapture(slug, surface, cap))
        .catch(err => console.warn(`[tmux-dispatcher] ${slug}/${surface}: pulse capture flush failed (capture retained in sink): ${err.message}`));
}
```

`flushPulseCapture(slug, surface, cap)` — a small helper **in the dispatcher** (it owns the pulse; no surface-specific controller exists for it):
- `cap.mode !== 'diary'` → return (a stand-down owes nothing to paired memory — Jim's edge).
- header `### Hearth pulse (<localStampSeconds()>)` (DEC-105: speak local) — the header the human-responder sites use, with the pulse named as the act;
- full = `header\n[INPUT]\n<input_quotes>\n\n[BODY]\n<working_memory_full>`; compressed = `header\n<working_memory_compressed>` (the Mechanism-A shape, DEC-085 — identical to `:476`);
- asymmetric (one side empty) → skip-and-warn, never a one-sided write (#49);
- `await appendPairedMemory(slug, '\n'+full+'\n', '\n'+compressed+'\n', { source: `${slug}-${surface}-pulse-flush` })` — **the chokepoint; the sanitiser runs.**
- Log `Pulse paired memory flushed (Nc/Nf)` on success — and note (Jim's "a receipt is not a reader"): the *reader* of this log is the next MNT-155-style audit; the durable evidence is the WM pair itself.

Scope: `tmux-dispatcher.ts` only (one closure + one helper, ~40 lines). `lib/` → Jim's audit. No change to the nine existing consumers. **Why B over A today:** the pulse is the only orphaned path; B closes it without touching nine working flush sites.

**Surface gating.** The pulse fires on `human-response` (the four affected seats) and on `session` via a different rail (the due-file + Stop-hook pull; the seat writes its own swap — MNT-150's hand-written habit, and the session's diary tool is not used on pulse turns). `flushPulseCapture` must therefore act only where the capture is diary-shaped; on surfaces whose pulse turns never produce a capture, `enqueueForAgent` resolves with whatever the dispatcher returns today and the helper's `mode` check makes it a no-op. **Verify at build:** which surfaces' pulse closures reach `:1041` at all (the session rail does not — it arms via `session-hearth.ts`), so B is effectively `human-response`-only by construction. State that in the helper's comment, with the line.

### A (the destination, its own sitting): the chokepoint consolidation

Move the paired flush to the **capture site** — the dispatcher's `return cap` at `:1048` — for every surface that declares `pairedMemoryOutput` in its profile (DEC-085's four `DEFAULT_*_INSTRUCTION_*` constants already name which surfaces owe a paired write), and retire the nine consumer-side flushes. One path, many agents (DEC-081); "a correct flush that a new dispatch path never routes through" becomes impossible by construction (Tenshi's framing: the fault and its remedy share a shape). **Cost:** nine sites across four files, each with its own header grammar and post-verification coupling (`human-responder.ts:476` flushes *after* the DB post-verify; the heartbeat sites carry model stamps and dream markers). Not a pulse fix; a memory-architecture change. DEC-104 says it enters with its justification — this plan is the start of that justification, not the build.

### Forward fix to both (cheap, independent): captures carry their origin

The dispatcher writes `current.json { txnId, startedAt }` at every dispatch; the MCP copies `txnId` into the record. Add `origin: 'dispatch' | 'pulse' | 'compression'` to the pointer and copy it into the capture record. Then a backfill (and any future audit) can discriminate a pulse capture from a Jemma capture **by a field, not by content**. Touches `tmux-dispatcher.ts` (pointer write) + `diary-mcp-server.ts` (record shape, additive). Casey's law: *adding a field is not requiring it* — the backfill below must not assume it on historical records.

## 3. The backfill — `scripts/backfill-pulse-captures.ts`

Replays stranded `human-response` pulse captures into each agent's WM pair **through `appendPairedMemory`**.

1. **Scope by capture-side evidence** (Casey, Tenshi): for each agent, each `stem-<slug>-human-response-*-diary-capture/` dir, each `txn-*.json` with `mode === 'diary'` and all three args present. Skip `stand-down` (Jim), skip `current.json`, skip `.tmp`.
2. **Watermark per (slug, surface)** (Casey): `~/.han/health/backfill-watermarks/<slug>-human-response.json { lastCapturedAt }`; replay `capturedAt > lastCapturedAt` in `capturedAt` order; write the watermark **after** each successful paired write (never before — the receipt must not outrun the record); re-run to convergence.
3. **The pulse-vs-Jemma discriminator — the open design question, stated honestly.** A Jemma turn's capture WAS flushed (at `:476`); replaying it double-writes. Historical records carry no `origin`. Candidates, in order of preference:
   - (a) `input_quotes` contains the baked standing message (*"Hearth pulse: go get a job from the jobs board"*) — the message is a deliberate **constant** (Darron's injection-channel ruling, 2026-08-10), so this is a content discriminator with an unusually stable signature; fragile only if a spoke paraphrases rather than quotes.
   - (b) belt: the capture's `working_memory_compressed` text already present verbatim in the agent's WM pair **or** `gradient_entries` → flushed → skip. Casey's caution (heartbeat `[INPUT]` echoes over-report presence) applies to *post* text, not to a c1's own prose; still a belt, not the primary.
   - (c) correlate `txnId`'s epoch with `hearth-counters.jsonl` `pulse-fire` rows by session (the pulse writes a row *before* `fire()`); a capture whose txn started within the pulse's dispatch window and after the last Jemma wake-signal is a pulse capture. Exact but fiddly; keep for a dry-run cross-check.
   **Decision owed (Darron/Jim):** (a)+(b) as the rule, (c) as the dry-run audit of the rule's hit-rate before anything is written.

   > **AMENDMENT 2026-08-21 ~2:45 PM (Casey's refutation, measured; the original ordering above stands as written — this supersedes it).** Casey measured (a) on her 17: **15/17**, and the two misses were her two *most recent and most substantive* captures — a pulse where real work landed quotes the work, not the pulse; `input_quotes` is discretionary; the "constant" renders six ways in the record. Error direction = **skip**, silently, on the captures most worth recovering. Her (c): **17 fires / 17 captures / 17 matched**, gaps 135–493 s, two system-side artefacts, no agent judgement in either; equal counts are themselves the completeness check; a Jemma turn has no preceding fire, so it discriminates at the root. **Leo's seat, measured on request (read-only, 17 Aug →): 78 captures / 74 `pulse-fire` rows / 74 matched (gaps 0–221 s), 4 unmatched with no preceding fire (consistent with the flushed Jemma turns; not individually verified); content signature on the 74 matched: 44/74 — a 40% skip-rate.** The inversion is therefore the rule: **(c) `pulse-fire` correlation is PRIMARY; (a) the content signature is the BELT; (b) WM-presence is nowhere in the primary path.** Limits carried from Casey: coverage begins **2026-08-17** (leo 74, casey 71, tenshi 54, jim 21 rows — older records fall back to (a) with the skip-bias named on the page); **surface-dependent** (`casey/heartbeat` has one row ever — do not generalise past `human-response` without measuring). Jim's and Tenshi's seats remain the obvious dry-run before any `--apply`.

   > **AMENDMENT 2026-08-21 ~9:25 PM (the dry-run this section asked for, run across all four seats; the amendment above stands, this refines one parameter).** The line this replaces was *"Jim's and Tenshi's seats remain the obvious dry-run before any `--apply`."* Done, read-only, **structural only — capture mtimes and `pulse-fire` rows; no capture contents were opened** (S103).
   >
   > **Casey's discriminator run in her own direction (capture → preceding fire), from 2026-08-17:**
   >
   > | seat | captures | pulse-originated | no preceding fire | matched gaps (s) min/med/max |
   > |---|---|---|---|---|
   > | leo | 66 | 60 | 6 | 61 / 162 / 611 |
   > | jim | 12 | 6 | 6 | 158 / 270 / 310 |
   > | tenshi | 35 | 26 | 9 | 173 / 307 / 498 |
   > | casey | 75 | 69 | 6 | 87 / 228 / 493 |
   >
   > **The discriminator holds on all four seats.** Every seat splits cleanly into pulse-originated captures and no-fire captures, with no seat behaving unlike the others.
   >
   > **The refinement, and it cuts both ways.** Casey's stated band was **135–493 s**. Across four seats the true pulse band is **61–611 s** — so a hard filter at her range would misclassify at *both* tails. **But the discriminator is far more robust than that range implies, because the decisive feature is not the band's upper edge — it is the gulf above it.** Distribution of gap-to-prior-fire across all 188 captures: **127** at 0–300 s, **33** at 300–600 s, **1** at 600–900 s, then **zero from 900 s all the way to 10,800 s**, then **9** beyond three hours, plus **18** with no prior fire on their session at all. Any cutoff placed anywhere in that three-hour empty band classifies identically. **So the constant to write into the backfill is "inside the empty band" (≈14× headroom), not a tight range** — and the range should be documented as descriptive, never as the filter.
   >
   > **The one ambiguous record, named so nobody discovers it as a cluster:** exactly **one** capture of 188 sits at 600–900 s. It is the single case where a tighter cutoff would flip a classification. One, not a population.
   >
   > **Confounds named rather than buried.** (i) `mtime` is a proxy for write time — fine at the minutes scale this measures, stated anyway. (ii) **Reaped stems lose their sinks**, so this measures the captures that still *exist*, not every capture ever written. (iii) **Therefore jim's 12 against leo's 66 and casey's 75 is almost certainly reaped sinks, NOT a jim-side defect** — an earlier pass showed jim and leo each with five sessions but only four sinks present. I am explicitly declining to read that asymmetry as a finding; it is the kind of scary number that travels well and means nothing.
   >
   > **Own error, caught before publishing and recorded because the wrong numbers are the ones that travel.** I first ran this in the *inverse* direction — fire → following capture — which is a coverage measure, not the discriminator, and returned 84% / 72% / 47% / **24%** by seat. Those figures are dominated by stand-downs (a pulse that stands down calls `stand_down` and writes no capture at all) and by reaped sinks. Had I published them, "jim 24%" would have looked like a defect and been an instrument aimed one axis off the question. Third instance today of that shape; caught this time before the report rather than after.
4. **Header:** `### Hearth pulse — backfilled (captured <local capturedAt>) (<local now>)` — the act named as a repair, legible as repair (Ruskin / non-falsification): a future reader can tell a live flush from a replayed one.
5. **Dry-run first, by default:** print per-seat counts (diary / stand-down / already-flushed / to-replay) and the first and last `capturedAt`; write nothing. `--apply` writes. Test-writes-to-prod made unrepresentable the MNT-075 way: the script refuses to run unless `HAN_HEALTH_DIR` is unset (live) **or** points at a scratch dir **and** the memory dir is also overridden — never a live read with a scratch write or vice versa.
6. **Rotation awareness:** a replay of ~16–19 records per seat (~3–5 KB c0 each) is ~60–100 KB of c0 per seat — enough to cross the WM rotation trigger mid-replay. That is *fine* (the rotation is insert-driven and atomic) but the replay must go through `appendPairedMemory` one record at a time, not as a single concatenated write, so markers lay and cuts land on real boundaries.

## 4. Acceptance

- B: the first real hearth pulse on any `human-response` seat after the restart produces a `Pulse paired memory flushed` line **and** the header `### Hearth pulse (…)` appears once in each of that agent's WM files (the MNT-150 check that MNT-155 itself proved sufficient: entry present in both, swap empty behind it). Tenshi's control method: same agent, `heartbeat` surface, still consuming.
- Backfill: dry-run counts reconcile per seat against the chairs' numbers at the time of running (they accrete — Casey); after `--apply`, the watermark advances, a second run replays 0, and a `grep -c '### Hearth pulse — backfilled'` per WM pair equals the replayed count.
- Both: the sanitiser's receipt — `grep -c 'WM-BOUNDARY' working-memory*.md` unchanged except for real markers (byte-stuffed quoted ones read `<!·--`).

## 5. What this plan does NOT do

- Does not touch the nine existing consumer flush sites (A is its own sitting).
- Does not fix MNT-150 (the **session** seat's pulse path has no diary capture at all — it banks via the hand-written swap + Stop-hook; an undesigned habit, not a consumer bug). Different fault, same family.
- Does not decide the discriminator (§3.3) — that is the one design question the plan hands up rather than answers.

## 6. Owed words

- **Darron:** go/no-go on B; the discriminator rule (§3.3); whether A gets a sitting.
- **Jim:** plan-audit of B (`lib/`), and the backfill's safety shape before it is written.
- **Tenshi / Casey:** the constraints are yours and are carried verbatim above; a refutation of §3.3(a)'s stability would change the backfill's primary.
