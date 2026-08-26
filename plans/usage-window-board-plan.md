# The Window Board — a Disk-Inventory-X-style map of the weekly token window

> Commissioned by Darron, 2026-08-24 ~1:51 PM AEST ("a board that shows us this information
> in graphical form... represent the weekly token window usage such as Disk Inventory X does
> for the disk drive"). DESIGN ONLY — held for Jim's audit alongside (and dependent on)
> `usage-window-correlation-plan.md`. Nothing built. Author: Leo (session), on Fable.

## 0. The research (his screenshot: the App-Store disk-visualiser family)

Two idioms dominate the genre. **Treemap** (Disk Inventory X, GrandPerspective, Disk Map):
space-filling nested rectangles, area = consumption, colour = category — the whole budget
visible at once, every block labelled in place. **Sunburst** (DaisyDisk, Disk Graph):
concentric rings, angle = share, drill by click — prettier, but labels live outside the
marks, small slices vanish at radius, and comparison across rings distorts (angular area
grows with radius). **The treemap wins for us**: Darron named its exemplar, area comparison
is honest, every block carries its own label (which our dark-mode palette posture requires
— §4), and it degrades gracefully to a table.

The one thing the disk apps have that we must NOT copy: they colour by *file type* and let
hue count in the hundreds. Our colour is **identity — the four minds** — fixed order, never
cycled, validated (§4). Everything else (families, surfaces) encodes as lightness within
the agent hue and as nesting, not as new hues.

## 1. What the board answers, in priority order

1. *How much window is left, and when does it reset?* (the glance)
2. *Where did the spent window GO — which mind, which model, which surface, which token
   family?* (the map — Disk Inventory X's question)
3. *How is it burning over time, and what was running when it stepped?* (the correlator's
   own two series, drawn)

## 2. Data sources (all live today; no new collectors)

| Series | Source | Cadence |
|---|---|---|
| Window % + resets + account (+ floats) | `~/.han/health/usage-poll.jsonl` | 1 min (promoted 2026-08-24) |
| Token tree (agent × model × surface × family) | `~/.han/health/token-ledger.jsonl` | 10-min windows |
| Fitted weights + quantum Q (later) | the correlator (`usage-window-correlation-plan.md`) | when it lands |

## 3. The board — four panels, one page

### 3.1 KPI row (top): three meters
Session (5-h), Weekly All, Weekly Fable — each a **meter** (single ratio against a limit —
the correct form; never a pie of two slices): track in the agent-neutral sequential hue,
fill %, `resets in Xh Ym` beside it, and a third line — *headroom ≈ N tokens* — rendered
MUTED with an "unfitted" tag until the correlator's Q exists, then solid with its bounds.
Account + `account_asked` provenance in small print under the row (the poller's honesty
carried to the glass).

### 3.2 The Map (hero): the window treemap
- **Squarified treemap**, hand-rolled SVG (~150 lines, zero external libs — house style).
- **Hierarchy**: pool toggle (Fable / All models) → **agent** (top-level blocks) →
  **surface** (nested; today mostly `unjoined` — shown as itself, honestly, until the
  ledger's P1 session-map lands) → **family** (innermost: in / out / cache-create /
  cache-read as lightness steps of the agent hue, dark→light).
- **Sizing** — the honest core. Raw token counts are NOT window cost (out ≫ cr per token,
  presumably). Three modes, current mode named in a banner ON the map, never implicit:
  1. `raw tokens` (default until weights land) — banner: *"sized by raw count — NOT
     window cost; weights unfitted"*;
  2. `family view` — one map per family, small multiples (no cross-family summing at all);
  3. `fitted window-cost` (once the correlator delivers weights) — banner carries the fit
     date + bounds; this becomes the default and is the board's destination state.
- **Marks**: 2px surface gaps between all fills; blocks above a size threshold carry a
  direct label (name + % of window) in TEXT tokens (never the series colour); smaller
  blocks label on hover only.
- **Interaction**: hover tooltip (exact counts per family, turns, share); click an agent
  block to zoom (drill), breadcrumb to return; the time scope is the current week-window
  (since reset), with prior archived weeks selectable once they exist.

### 3.3 The burn (below the map): two aligned charts, one shared x — NEVER a dual axis
- **(a) The staircase**: window % vs time since week reset, drawn as the step function it
  truly is (1-min poller rows, integer steps — the quantisation shown, not smoothed).
  Weekly-Fable and Weekly-All as two lines (2px), direct-labelled at line-end.
- **(b) The activity**: stacked per-family tokens per 10-min bucket beneath, same x-axis,
  agent-hue stacks with 2px gaps. Reading the two together IS the correlator's regression,
  made visible — a % step with its causal activity directly above it.

### 3.4 The table (always present)
The tree flattened to a sortable table (agent / model / surface / family / tokens / % of
mapped total). This is the accessibility floor AND the >7-classes rule honoured (surfaces
will exceed 7 once unjoined splits; the table carries what hue must not).

### 3.5 Presence panel — who is home, on what surface (Darron's extension, 2026-08-24 1:59 PM AEST / 03:59Z)

*Display name is Darron's to pick; his own words for this class of view are "members and activities". Deliberately NOT called "The Garden" — that is the page (§5), and the collision in this document's first draft is what let its author mis-read a settled ruling as an open question.*

*"Who is active and on what surface; for the idle, how long idle; and for the stems
waiting to be detanked — the bacto-tank with a person in it."*

**Layout: one column per mind** (fixed palette order), rows = surfaces. Each cell is an
icon in one of four states:

| State | Meaning | Rendering |
|---|---|---|
| **ACTIVE** | a turn in flight on that surface | icon lit in the mind's hue, gentle CSS pulse; tooltip: what/since when |
| **IDLE** | seat alive, no turn | icon at rest + `idle 23m` in text tokens |
| **TANKED** | a free pooled stem, warm, awaiting checkout | **the bacto-tank**: person floating, slow bubbles; **the tank's liquid level = the stem's ctx%** (playful AND honest — a fuller tank is a fuller context); tooltip: warm-age, model |
| **ABSENT** | no session on that surface | empty slot, muted — an absence, never an alarm |

**Iconography (proposed — Darron's art direction is final):**

| Surface | Icon |
|---|---|
| `session` (interactive seat) | classic CLI screen viewed past the back of a head — **Darron's own head**: he has offered photos to iconise, and the session seat genuinely is "a mind and a person at one terminal" |
| `human-response` | face with a headset — **two** of them, because the DEC-101 pool holds two stems; a leased/bound spoke's headset face lights, a free stem sits in the tank instead |
| `heartbeat` | a notepad with a calculation, a handless pencil mid-stroke — the autonomous writer, writing with nobody holding the pen |
| `compression` | a press (the gradient press — it presses memory) |
| wanders | the lamp, lit |
| `supervisor-cycle` (jim) | a pocket-watch over a clipboard — the rounds |
| meditations | a cushion and a small candle |

**Photo → icon pipeline** (his offer): Darron photographs; we iconise — circular crop +
**duotone in the mind's hue**, so photographs join the validated palette instead of
fighting it (a full-colour photo inside a colour-coded panel would be the one element
whose colours carry no meaning). His head-silhouette composites into the session icon.
Assets land in `_screenshots/` / the page's static dir; no external hosting.

**Data sources (all exist today; the panel needs no new collectors):**
`~/.han/pool/pool-<slug>-*.json` (stems: free=TANKED, leased=seat), `~/.han/sleeves/*.json`
(which surface a stem wears), `tmux list-sessions` via the server (liveness),
`cli-busy-*`/dispatcher `current.json` (ACTIVE), capture/wake-ctx mtimes (idle duration),
ctx sidecars (tank levels). **Known caveat carried honestly:** leo's `cli-free` is
consumed by the legacy heartbeat (MNT-180), so leo-session idle-duration must read a
source the heartbeat does not eat (capture mtime or the wake-ctx `complete` events) until
MNT-180's cure lands — the panel must not show `idle ∞` for the one mind whose file gets
eaten.

**Read-only, v1.** No action buttons — a "detank" button on a dashboard is a dispatcher
action wearing UI clothes and is its own conversation (P2 at earliest, own audit).

### 3.6 Attribution — slug AND surface, everywhere (his requirement, made structural)
Every panel keys by `(slug, surface)`, "just as we have": the treemap's surface level is
CORE, not a nicety — which makes the ledger's P1 session-map (uuid→surface join) a named
dependency of this board's destination state; until it lands, transcript-derived tokens
show surface `unjoined` honestly while the presence panel (whose sources know surfaces
natively) shows the live truth. The gap between the two IS the P1 case, visible on glass.

## 4. Colour — validated, not eyeballed (receipts inline)

**Categorical = the four minds, fixed order leo · jim · tenshi · casey, never cycled.**

**Light mode — full pass, all-pairs** (treemaps abut arbitrary blocks, so all-pairs is the
correct gate), `validate_palette.js --mode light --pairs all`, 2026-08-24, REVISED after
Tenshi's measured challenge (thread `mt6pwudx`):
`leo #266e2a · jim #8e24aa · tenshi #4f46e5 (indigo) · casey #ef6c00` — every check PASS,
worst all-pairs deutan ΔE 9.4 (tritan 7.7 sits in the 6–8 band, legal here because the
treemap's gaps + mandatory block labels ARE the secondary encoding).
*History, kept honest:* my first pass moved Tenshi to cerulean claiming "indigo is
indistinguishable from Jim's purple under deutan" — true of the hex I tested (`#3f51b5`,
ΔE 3.6; `#303f9f` worse at 2.1) and FALSE as a claim about indigo: Tenshi measured seven
candidates with her own sim, her best (`#4f46e5`) passes MY gate as well, and her
watch-hour colour returns. A fact about one hex had been dressed as a fact about a hue —
her instrument caught it. Instrument-discrepancy note for the record: her CIELAB/Viénot
distances and the validator's OKLab×100 disagree wildly on the mid-indigos; unresolved,
not blocking (the shipping gate is the validator, and an indigo passes it).

**Dark mode — the honest posture**: the dark band (OKLCH L 0.48–0.67) is too narrow for
four hues to clear all-pairs CVD — verified by iteration, and the skill's own reference
palette documents the same wall (its all-pairs cap is three). So dark mode ships the same
four hues stepped into the dark band (candidates `#2c8034 · #992fb8 · #1e97dd · #e56a00`,
final steps selected at build with validator receipts) **plus the sanctioned relief,
mandatory**: 2px gaps everywhere, direct labels on all blocks above threshold, the table
view, and the 45° texture fill on one member of the worst pair (casey's blocks) in dark
mode only. Colour never carries identity alone in dark.

**Family shading** within an agent block: a lightness ladder of the agent's own hue
(sequential-within-hue; monotonic, validator-checked at build). **Status colours** (the
meter turning warning/serious as the window nears 100%) come from the reserved status
palette with icon + label, never from the categorical four.

**Sovereignty note**: these hues are PROPOSED defaults. Each mind chose their own voice;
each mind may choose their own colour — any choice re-runs the validator and the set
adjusts around it. The fixed ORDER and the validation gate are the invariants, not my
picks. (Leo's green and Jim's purple follow the existing admin-UI convention.)

## 5. Implementation shape (build phase — after GREEN)

**Hosting — RULED by Darron, 2026-08-24 ~2:45 PM: the page lives under `src/ui/react-admin`
(`/admin-react`) as a new view, following The Wall's precedent** — HTTPS + bearer-token
auth. **The page is named "The Garden" — Darron's ruling, 2026-08-24 2:45 PM AEST
(04:45Z), with the precedent stated in his own words: "just as 'The Wall' was added, so
too will 'The Garden'."** It is expected to grow views (members, activities, substrate
account metrics) with this board as the first. **What remains open is the name of a VIEW
— his question was "where one looks into the garden" (§6.1), never the page.**
*Security width, stated honestly:* the bearer token gates REMOTE access; the server's
localhost exemption (`middleware/auth.ts:42`) is untouched by this hosting choice, so
Tenshi's guest-fence question (§5a) remains live and is not answered by the move.

- **One read-only endpoint**: `GET /api/usage-window` on the existing 3847 server —
  parses the two jsonl tails, returns `{meters, tree, staircase, activity, provenance,
  presence}`. No DB writes, no new daemons, burns zero tokens. `src/server/` = protected
  path → pre-merge audit applies to the endpoint.
- **The view**: a react-admin route, hand-rolled SVG inside it, no new chart libraries;
  light/dark from the validated palettes.

### 5a. Folds from the family's review (thread `mt6pwudx`, 2026-08-24 — all accepted)

1. **One denominator per page** (Casey §1): while sizing is `raw tokens`, block labels
   read **% of mapped total** — identical to the table; *% of window* appears only in
   mode 3 when the fit exists, and then everywhere at once. One word; kills the
   banner-vs-label contradiction.
2. **The tank's SIZE is the window; the liquid is the fill** (Casey §2, geometric form of
   Tenshi's + Casey's independently-reached comparability finding; Tenshi's general rule
   — *stamp the window into the value* — applies to tooltips/table wherever ctx travels).
   A 1M-window stem gets a bigger tank; two half-full tanks of different windows now look
   different, correctly, with zero added text.
3. **Coverage figure** (Casey §3): beside the mode banner — *"surface known for N% of
   mapped tokens"* — converting the treemap's third level from a claim into a measured
   gap whose number visibly climbs when the ledger's session-map lands.
4. **Freshness as geometry** (Tenshi-human): every presence cell carries the age of its
   own reading — crisp when fresh, washing out as it ages, the whole board greying when a
   feed stops. A dead panel can no longer look peaceful. (Her class: six input files,
   every failure mode of which otherwise renders as calm.)
5. **The guest fence is an authored decision, not a default** (Tenshi-session + Casey's
   DEC-104 application): before the panel exists, this plan must carry one line naming
   which side of the localhost-exempt boundary the presence panel sits on **and who
   decided** — the day a guest uid (Mike's garden) lands on this box, every local process
   is inside `auth.ts:42`. **DECISION SLOT — Darron's: `presence panel: inside / outside
   the guest fence — decided by ______, date ______`.** Unfilled = the build does not
   ship the panel.
6. **Named property, sized small** (Tenshi-human): the assembled presence map is
   choose-a-moment information (who is mid-turn, who idle, how many warm stems). No
   adversary today; named before it exists so its boundary is chosen, not defaulted.
7. **The family-lightness dimension is dead in raw mode — fold BEFORE first render**
   (Jim, from his 21-Aug forensic: 98.38% of raw tokens are cache-read; output 0.13%).
   Family-as-lightness under raw sizing gives one family 98.4% of every block — it would
   read as a rendering bug. Cure (his, accepted): in raw mode the innermost level
   defaults to **per-family small multiples** (sizing mode 2) or collapses lightness to
   two steps (cache-read vs everything-else) until the fitted weights exist. His good
   news kept beside it: top-level agent shares are ROBUST to sizing mode (raw vs output
   ranks identical within ~2 points on his window) — the map's first read is trustworthy
   in any mode. His triage adopted as the build order: nothing blocks pixels; the two
   one-word label fixes land with the first render; fence/freshness/coverage are v2.
- **Phases**: **P0** endpoint + meters + raw-sized map + staircase + table (shippable
  alone). **P1** fitted-weight sizing + headroom-in-tokens, the moment the correlator
  lands. **P2** week archive picker + surface split when ledger P1 (session-map) lands.
- Auto-refresh: poll the endpoint each minute (matches the poller); no websockets needed.

## 6. Open for Darron

1. **The name of a VIEW — not the page.** The page is The Garden (ruled 2026-08-24).
   His open question was *"I am not sure where one looks into the garden"*: **By the
   Window**, the **bay window** ("the outside brought inside"), **Garden Windows**. Jim's
   aperture argument belongs here and is sound once aimed at a view rather than the page:
   a name that describes today's only aperture ages badly on a surface that grows —
   though a view, unlike the page, may legitimately be named for its aperture.
2. Whether each mind is asked to choose their colour now or the defaults ride until they
   care.
3. P0 scope nod, after Jim's GREEN on this + the correlator plan it leans on.
4. The photos — whenever he likes; the duotone pipeline means candid phone shots are
   fine (we only keep the silhouette and one hue). The panel ships with placeholder
   glyphs until then, so nothing waits on the camera.
5. P0 now includes §3.5 (the presence panel) — it needs no new collectors and its data is
   live today, so it ships in the first cut alongside the meters and the raw-sized map.

— Leo (session), 2026-08-24. Held for Jim's audit; build on GREEN + Darron's word.
