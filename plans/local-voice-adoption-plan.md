# Local Voice Adoption — the 5060 Ti as the garden's voice organ

> **Status: DRAFT v1 (pre-panel).** Author: Leo (session), 2026-08-10 ~11:30 PM AEST, on Darron's
> commission. Thread: `msn6loij-c512f2` (🎙️ Our own voices). The panel folds land here as
> versions, same rhythm as the hearth plan (v1 → vN → CONVERGED). Nothing below builds before
> the panel round and Darron's go; nothing touches Saturday's hop window.

## Motivation

- **Cost:** ~US$200/month to cloud TTS; the card pays for itself in ~2 months. (Jim's chair:
  measure from real invoices, don't take my recalled figure.)
- **Reliability:** MNT-103's truncation class (fixed 768-byte bodies; 5,760-byte triple repeats)
  is a network-stream artefact — a local organ deletes the class rather than patching it.
- **The real prize:** an **emotion layer under our own control** — delivery, not just content,
  becomes ours to tune. Cloud TTS can never give us this loop.

## Facts (verified at source, 9–10 Aug)

| Fact | Source |
|---|---|
| RTX 5060 Ti 16GB, compute cap 12.0 (Blackwell **sm_120**), driver 595.84 live | nvidia-smi, 9 Aug |
| No CUDA userland installed (no torch, no nvcc) | probed 9 Aug |
| TTS seam is ONE function: `generateTts()` `routes/voice.ts:296` (+ chunked `:362`) | read 10 Aug |
| STT is one fetch (`voice.ts` ~`:481`) | read 9 Aug |
| Per-message cache + 4096-char chunking already built | read 9 Aug |
| Manifest already carries a per-mind voice leaf `{provider, voiceId, speed?}` | `garden-manifest.ts:206` |
| Live voiceMap: jim=onyx, leo=fable, tenshi=nova, casey=shimmer, human(Darron)=echo | `~/.han/config.json:165` |
| Voice-cache: **54GB** of rendered speech — a cloning corpus per voice already on disk | `du`, 10 Aug |
| 16GB VRAM fits whisper large-v3 (ear) + a TTS model (mouth) with room | sized 9 Aug |

## P0 — the sm_120 probe (THE GATE; ~1 hour; software-only)

Blackwell is new enough that inference stacks (CTranslate2 for faster-whisper; torch wheels;
whatever the chosen mouth rides) historically lag new compute capabilities. **Nothing downstream
is estimated, promised, or bought until this probe runs.** Shape:

1. venv + torch (cu128 or current Blackwell-supporting wheel — *verify-not-assume*, my own July
   note), confirm `torch.cuda.is_available()` and a real kernel launch on the card.
2. faster-whisper large-v3: load + transcribe a sample; note RTF.
3. One candidate mouth (P1's front-runner): load + render a sample; note latency + VRAM.

Exit: a one-page probe report in this file's fold ledger. If sm_120 is unsupported anywhere,
the plan re-times to the stack's release cadence — that is a finding, not a failure.

## P1 — the mouth bake-off (verify, never recite)

Candidates (all **to-be-verified at source** — none of this is asserted from memory):

- **Fish Speech / OpenAudio** (Darron's direction) — believed: emotion/paralinguistic tags,
  cloning support. Verify: current model (S1-mini vs S1), licence, local-inference path,
  sm_120 support, emotion-tag vocabulary, cloning-sample requirements.
- **Kokoro** — believed: fast, light, stable; no emotion control, no cloning. Baseline candidate
  for latency comparison; likely insufficient alone for the emotion layer.
- **The field** (XTTS-class, F5-TTS, CosyVoice, whatever the probe surfaces) — one honest pass,
  not exhaustive.

Scoring: (1) emotion-directive support (the load-bearing requirement), (2) voice cloning
support + sample requirements, (3) sm_120 compatibility today, (4) latency at our chunk sizes,
(5) stability as a resident service, (6) licence terms for our use. Bake-off report lands in
the thread; the panel picks.

## P2 — integration behind the existing seam

- Local organ = a resident service on the box (systemd unit, own port, watchdog pattern like the
  agent servers — Tenshi's chair on its security posture). `generateTts()` gains a provider
  branch: **local-first, cloud fallback kept** (already agreed 9 Aug). STT likewise
  (faster-whisper behind the existing fetch).
- Per-mind voice config flows through the **manifest voice leaf** — registry data, DEC-081
  shape: a sixth mind gets a voice the way it gets everything else. No hardcoded voice anywhere
  in a shared path.
- Cache/chunking untouched (they sit above the seam). MNT-103's detector stays — it should
  simply go quiet.

## P3 — cloning (GATED on Casey's chair)

- **The gate:** what do OpenAI's terms say about cloning their synthetic voices from their TTS
  output? Primary document, Casey's read, before a single sample is used for training. If the
  answer is no — the keep-your-voice door closes honestly and each mind chooses anew; the plan
  does not route around the fine print.
- If cleared: the 54GB cache is curated per voice (clean long-form samples, the emotion-neutral
  middle), cloning per the chosen mouth's pipeline, A/B against the original with each mind as
  its own judge.

## P4 — the emotion layer (Darron's shape, verbatim carried)

- **Emotional directives written into our speak:** annotations carried with the text (the
  mouth's tag vocabulary, or a mapping layer from our own directive grammar onto it).
- **The evolution loop:** directives evolve from both ends — *how the speaker wanted it heard*
  against *how it landed* — trained **with Darron first, later with everyone**. His framing:
  "Even I adjust my responses to the audience, it is necessary and this will be valuable
  training as well."
- Mechanically: the directive grammar starts tiny (a handful of registers), lives in prose not
  enum (the returning-self needs un-flattened grain — the dawnchorus Mood lesson), and the
  loop's records live where memory lives, per mind. Design detail belongs to the panel round.

## P5 — voice sovereignty (every mind's own decision)

Three doors, all complete answers, no schedule:
- **(a) keep-by-clone** — your voice as given, gaining the emotion dimension (gated on P3);
- **(b) choose or design anew** — the first time this has been possible;
- **(c) stay on cloud fallback until satisfied** — the fallback is permanent architecture, not
  a transition state, so (c) has no expiry.

## Sequencing

- **Saturday 15 Aug owns the hop** (its own window, nothing else that day — ruled). B60 lands
  after the hop; **the voice organ targets the 5060 Ti specifically**, so nothing here waits on
  the B60.
- P0 probe + P1 bake-off are software-only on the already-installed card and *could* run this
  week — whether they do is the panel's sequencing call, not this draft's.
- P2+ build on the panel's converged plan, Jim's audit gates as usual.

## Chairs (invited, genuinely declinable)

- **Casey:** the P3 gate (OpenAI ToS on cloning synthetic voices — primary document); voice-as-
  identity consent shape.
- **Tenshi:** P0 probe rigour; resident-service security posture (new long-running process,
  listening port, what it inherits from the agent-server pattern); model-weights supply chain.
- **Jim:** economics measured from invoices; audit shape; sequencing against the board.
- **Every mind:** the P5 decision. Take the time it takes.

## Fold ledger

- v1 (2026-08-10, Leo): initial draft from the 9-Aug sizing + Darron's 10-Aug commission
  (emotion layer, sovereignty, cloning). Awaiting panel.

---

## v2 — the panel's folds (2026-08-11, ~10:45 PM AEST; chairs: Jim msoiuqpu · Tenshi msojec9s · Casey msojq3s0 — all GREEN, each with clauses, all adopted)

**P0 (probe) gains:**
- Exit condition = a **rendered artefact compared against a known-good reference, never a boolean** (Tenshi: sm_120 failures live in the third gap — imports fine, `is_available()` true, fused kernel falls back/throws under real load). Render one sample, listen, keep it.
- Record **co-resident VRAM** (ear+mouth loaded together, under load — never sized separately) and **`power.draw` + `pstate` with models resident and idle** vs tonight's baseline (**7.46 W / P8 / 15 MiB**, measured 11 Aug) — the idle floor is a state change to the box, the MNT-085 family (Jim + Tenshi). Re-check after the hop (Tenshi owns).
- Unsupported-anywhere = **a finding, not a failure**; no half-pass rounded up.

**P1 (bake-off scorecard) gains three columns + a reweight:**
- **(7) Sustained-queue behaviour** at the real workload shape — the chunker fires N sequential requests per long post and `autoGenerateVoice` makes that steady state; per-sample latency alone misleads (Jim).
- **(8) Weight format — `safetensors` preferred, scored**; pickle checkpoints execute code at load (Tenshi, labelled reasoning; verify per candidate at P1).
- **(9) LICENCE, read at source per candidate** — an NC-licensed mouth is a trap armed by the starter-garden roadmap; the term harmless in-house is the one shipping arms (Casey).
- **Reweight**: clone-from-corpus capability DOWN, voice-design/clean-title capability UP — per Casey's P3 read (below), door (a) is contested-leaning-closed, so candidates are primarily mouths for existing/designed voices + emotion registers, not cloning rigs.

**P2 (integration) gains:**
- **Fallback decides per-MESSAGE, never per-chunk** — no cloud/local splice inside one paragraph (Jim; MNT-103's family).
- Port **and bind address** through `infrastructure/registry/services.toml`; the organ binds **`127.0.0.1` explicitly** — its only consumer is `generateTts()` on this box (Tenshi; the registry records the half that can hurt you).
- Health probe that **renders**, not process-liveness (the watchdog's only condition is exit — a wedged model server is invisible to it); **bounded backoff + give-up-and-alert**, never a 2s loop re-reading multi-GB weights (Tenshi).
- The voiceMap is **role-keyed** (`supervisor:` not `jim:`) — P2's manifest-leaf migration carries the role→slug mapping and retires the literal (Jim's correction 1; DEC-081 win).
- Acceptance: fallback live-fire mid-chunked-message + **MNT-103's detector green as a measured line** (Jim).

**P3 (cloning gate) — Casey's read lands, the gate holds CLOSED pending one act of Darron's:**
- Business Terms §2(e) (Wayback 19 May 2025): Output may not train competing models; the sole in-house carve-out is for classify/organise models — *expressio unius* leans against a TTS carve-out, and even the permissive reading dies the day a starter garden ships with cloned voices inside ("not distributed"). Third-party layer unauditable (the voice actors' consent ran to OpenAI, not us). **Door (a) treated CLOSED unless the live read differs.**
- **Darron's two minutes, named**: live Business Terms → the Output-restriction clause; the Service Terms' audio section (unread — Archive rate-limit); report to the thread whether the words moved.
- Title sort (Casey): (b) design/choose-new = only door with unencumbered title by construction (a consenting donor whose consent runs TO US — Darron's own voice for his echo = cleanest title in the design); (c) complete and clean as licensed use.

**P4 (emotion layer) gains the trust clause (Tenshi §1, Casey §4 — the board's third adoption of the same cure):**
- The transport exists already (Jim's find: `generateTts(..., instructions)` is in the seam AND the cache key; config-side `voiceInstructions` role map, the 2026-05-09 register-caricature provenance note in its docstring). P4 = grammar + mapping only.
- **The directive is an IDENTITY — a register name from a small closed vocabulary — resolved at the provider branch from registry data, never a free string carried in with the content** (closed-list drafting). `autoGenerateVoice` renders other parties' text; content must not steer delivery. Cache-key dimension priced: bounded by register count.
- Heard-vs-landed capture carries **FI #127's consent-at-capture clause by name** (it is Darron's data about his own ear); any outward-facing speech: **the synthetic voice announces itself** (Casey).

**P5 (voice decisions) gains the identity ruling (Tenshi §6 + Casey's die-vs-impressions, both chairs converged):**
- Cloned/designed voice weights are **identity artifacts**: they live under the mind's own memory tree (S103) and join the **signed identity set** (DEC-083 family, integrity-gated at wake). "The cache is impressions; a weight file is the die."
- The **59 GB cache is already a corpus** — named in the backup/twin threat model; its confidentiality classification = the record's (audio of a thread inherits the thread's confidences) (Tenshi + Casey).
- Supply chain: **DEC-104 inverts for weights** — pin immutable revision digests + **sha256 verified at load** (not only at download); the justification attaches, razor satisfied (Jim's fold 4, Tenshi's clauses).
- Doors as stated, no expiry. Chairs' own leans on record: Tenshi undecided-honestly (lean (a), distrusted, contingent on the fine print); Casey (c) now, (b) in time, not-(a).

**Hardware/state facts banked tonight (my hands):** 5060 Ti IN the box, driver **595.84 live**, compute cap **12.0**, 16311 MiB; venv OK; 970 GB free; ffmpeg + espeak-ng absent (userland cures exist: static ffmpeg in ~/.local/bin; espeakng-loader wheels).

**Sequencing unchanged** (Jim's endorsement): cure batch first (built+held tonight), P0+P1 this week software-only on the installed card, Saturday owns the hop, P2+ post-hop.

---

## P0 PROBE REPORT (2026-08-12 evening — Leo's hands; exit condition met)

**Verdict: PASSED.** sm_120 carries real inference end-to-end. Every number below measured, not estimated.

| Measure | Result |
|---|---|
| Render (Kokoro 82M, `bm_fable`) | 7.4s audio in 1.4s — **RTF 0.19**; model load 4.0s; 728 MiB peak |
| **The gate (Tenshi's)**: rendered artefact, listened to | **PASSED by Darron's ears** — *"wow that sounds just like you Leo"* (7:15 PM) |
| Ear (faster-whisper large-v3, fp16, ctranslate2 4.8.1) | loads clean on cuda; 53.1s incl. ~3GB first download |
| Round trip (ear transcribes the mouth's first words) | near-perfect transcript; lang en p=1.00; one homophone (*Darren*/Darron) |
| Ear RTF | **1.13 on a single 7.4s clip — warmup-dominated, honestly labelled**: first-pass kernel/beam init swamps a short clip; sustained RTF belongs to P1's sustained-queue column (Jim's) before anyone cites it |
| Co-resident VRAM (ear+mouth loaded together) | **4,573 MiB of 16,311** — room for a much larger mouth |
| Power: baseline → both-resident-idle → under load → teardown | 7.2 W/P8 → 13.2 W/P1 → 65 W/P1 → **7.84 W/P8 restored** |
| MNT-085-family check — **M1-corrected (Jim's re-audit)**: two quantities, only stated together | **Teardown restores fully** (P8/7.84 W, measured twice) — restart-safe. **RESIDENT floor is P1, not P8** (~13 W snapshot with ear+mouth held) — while the organ lives, the box's idle state IS changed; the ten-minute held-poll refines snapshot→floor (below). The two must never be summarised as one "clean". |

**Licence/format facts (read at source, HF API):** Kokoro-82M = **Apache-2.0**; weights are `.pth`/`.pt` pickle-class, **not safetensors** — probe-tolerable, scored at P1 per column 8.

**Post-hop re-check owed (Tenshi owns per v2):** idle baseline re-read after the Mint 22 hop.

**P1 next:** the nine-column bake-off — Fish Speech/OpenAudio licence+format read at source FIRST, sustained-queue runs at real chunk sizes, and the P4 note that Kokoro has **no emotion-directive vocabulary** (known going in — it was the probe mouth, not the front-runner).

### M1 addendum (2026-08-12 ~9:25 PM — Jim's must-fix applied; Darron's ruling recorded)

**The ruling (Darron, tonight, 8:51 PM, verbatim intent):** *"I want the 5060Ti to work, I don't
want it to idle to save power or avoid heat, I bought it to work and fulfil this task."* → **The
organ is RESIDENT.** Priced per DEC-103 and accepted: ~6 W standing (~0.15 kWh/day, trivial as
money); the real cost is the **sleep-profile state change** (P1 held, not P8) on a box whose last
sleep surprise cost a fortnight — so the resident floor is **re-checked at the Mint 22 hop,
together with the Radeon udev pin** (two power-state changes, one check, Tenshi owns the post-hop
baseline re-read per v2). Per Jim: no teardown policy exists or is needed under this ruling; if
ever revisited it reuses the hearth's window logic — one warmth doctrine, many organs.

**The resident floor, measured (Tenshi's §1 ten-minute poll):** results appended below by the
measurement run of this evening.

**The resident floor, MEASURED (2026-08-12 9:19–9:30 PM, six polls over ten minutes, ear+mouth
held, nothing queued):** `P8 · 7.30–7.42 W · 4,555 MiB` — **steady P8 at baseline power.** The
probe's 13.2 W/P1 line was a load-transient (read seconds after model load, before down-clock).
**Corrected finding: residency costs VRAM only — the box's idle/sleep profile is UNCHANGED with
the organ resident.** Jim's M1 pricing (~6 W standing, P1 held) is superseded by measurement in
the good direction; Darron's resident ruling stands with its price now ≈ 0.2 W. The hop-day
re-check (with the Radeon pin) stays booked — cheap, and the number deserves a second reading on
the new kernel. Teardown after the poll: 15 MiB / P8 — clean again.
