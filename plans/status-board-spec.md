# The Status Board — spec (the kanban's precursor)

> **Status: SPEC — Darron-commissioned 2026-07-16 00:18 ("spec up the new tab, the board, how
> the data is viewed, I'll leave the complete design to you"). Design: Jim. Build: Leo (HAN
> rule), Jim plan+diff audit. Lineage: future-idea #93 (kanban) precursor; born in the Han
> Security thread (`mrjw0z1z-7pcdgv`, msgs `mrlm4c8g` → `mrm5bnju` → `mrm5fort`).**

## The one-line design

**The file is the source; the tab is a render of it.** A single living register file, curated in
place (items change state where they sit — never a growing thread), rendered as a board in the
admin UI where the Products tab used to be. Every item carries a locator home to where it was
born, so anything can be closed *gracefully* — no hunting.

Darron's founding words, the requirements verbatim:
- *"the kanban starts its life as a register file"* → *file* is the source of truth.
- *"a page that renders the file"*, *"only the one post"* → a render, not an append-thread.
- *"that document can point to the source as well so we can close them out gracefully"* → locators.
- *"your memory is too much like mine… we focus and lose sense of the small things"* → the board
  is the structural cure for a shared failure mode — a surface that remembers *for* us.
- *"a new tab or replace the Products tab"* → replace Products (dead pipeline, never went anywhere).

## 1. The source file

`~/.han/memory/shared/status-register.md` — beside the maintenance journal and hall-of-records
(shared memory: any seat can read it; **single writer = Jim**, the supervisor's curation lane,
same model as the journal's append discipline but edit-in-place).

- **History for free**: the file rides the hanmemory git auto-backups (6-hourly push + hourly
  GDrive + restic) — every state-change is version-tracked. Edit-in-place + git history =
  supersede-not-delete (DEC-069) with zero new machinery.
- **Capture habits UNCHANGED**: the maintenance journal stays the ~30s write-first surface;
  Odd Jobs keeps living; future-ideas keeps its home. The register is the **triage + status
  layer** above them — one row per open item, each pointing home. No second capture path, no
  competing write surface (the wm-sensor lesson applied to ops).

### Item grammar (strict, so the renderer's parser is trivial)

```markdown
## SR-014 — Short imperative title
- status: open | in-progress | blocked | done | retired
- kind: security | maintenance | build | decision | verify | idea
- owner: jim | leo | tenshi | casey | darron
- priority: critical | high | med | low
- source: MNT-056 · thread mrk1siij-pf8tdy · plans/future-ideas.md#122 · DEC-103 · commit f0f1b10
- opened: 2026-07-15 · updated: 2026-07-15 · closed: —
- next: the single next action, one line

One short paragraph of context. Optional.
```

Rules: `SR-###` sequential, never reused, never deleted (a dead item goes `retired` with a
reason). `source:` is `·`-separated locators — thread-ids, MNT-numbers, file#anchor, DEC-ids,
commits — machine-splittable, each one a door. `- key: value` lines only between the heading
and the blank line; prose after. A file header carries the counts line + "the board renders
this file" note + the legend.

## 2. The tab — **Board** (replaces Products, tab #8)

`src/ui/admin.ts`: the Products tab becomes **Board**. `/api/products` routes stay in place
untouched (deprecated-in-place, DEC-069/scope discipline — nothing new calls them). Any
recoverable content in the old products table gets swept INTO the register by the seed search
(the dead tab's contents become rows on the board that replaced it).

### API (Leo builds; 3847 so the admin UI stays real-time)

- `GET /api/status-register` → `{ items: [...], counts: {byStatus, byKind}, updated_at, parse_warnings: [...] }`
  — server reads + parses the file fresh per call (it's small; no cache invalidation problem).
  A malformed item never 500s: it lands in `parse_warnings` with its heading + line number and
  the board renders a "needs attention" chip — **fail-soft, loudly** (DEC-103 spirit: a broken
  row must surface, not vanish).
- `fs.watch` on the file → existing WS broadcast (`status-register-updated`) → the open tab
  refetches. Same infra as the terminal mirror; no polling.
- **Read-only in MVP.** Edits happen in the file, by my hand. One writer, no locks, no write API
  surface to secure. (Multi-writer arrives with #93's table, not before.)

### How the data is viewed (Darron's explicit ask)

1. **Board view (default)** — four columns, the proto-kanban:
   `Open · In Progress · Blocked · Recently Done`.
   Cards show: title · **kind badge** (security = red, maintenance = amber, build = green,
   decision = blue, verify = teal, idea = violet) · owner chip · priority edge (critical items
   get the loud left border) · age (“3d”) · **source locators as live links**.
   *Recently Done* shows items closed within 14 days, then they leave the render (never the
   file). Priced per DEC-103 §2: the 14-day window bounds a *render filter*, nothing else —
   worst case, a done card leaves the board early; it is still in the file and its git history.
2. **Table view (toggle)** — same items, sortable columns (status/kind/owner/priority/age),
   for scanning and filtering when the board gets busy.
3. **Summary strip** (top of both views): open/in-progress/blocked counts, a per-kind count
   row, and critical items named outright. The 5-second answer to “where are we?”
4. **Filters**: kind · owner · priority. URL-encoded (`#board?kind=security`) so a filtered
   view is linkable from a thread.
5. **Locator deep-links**: `thread <id>` opens that conversation in the UI; `MNT-###` opens a
   journal render anchored at the entry; `plans/…#N` and commits render as copyables. The
   “close it out gracefully” door, made clickable.
6. **Security is first-class, not a footnote** (the thread's commitment): `kind: security`
   items are visually loudest and the summary strip counts them separately.

## 3. Lifecycle

- **Seed** (Jim, committed to Darron): the full sweep — *all* threads + the four scattered
  surfaces (maintenance journal, Odd Jobs, future-ideas.md, live-thread commitments) + the old
  products table → one register, every row with its locator. Seed pass 1 (known items) lands
  with this spec; the full thread-sweep is a proper supervisor task and completes it.
- **Ongoing** (Jim, standing supervisor rhythm): new MNT / Odd Jobs / thread-commitment →
  register row at triage; landings/seals → status flip + closing locator (the seal post, the
  commit). The #92 self-observing-garden record leg, operating.
- **Close gracefully** = `status: done` + `closed:` date + the closing locator appended to
  `source:`. The row stays forever; the board just stops rendering it after 14 days.

## 4. Lanes + gates

- **Jim**: the register file, the seed sweep, ongoing curation, this spec, plan+diff audit of
  the build.
- **Leo**: parser + `GET /api/status-register` + fs.watch/WS + the Board tab UI + Products
  replacement. One PR, selective.
- **Audit gates** (pre-committed): parser proven against the REAL register file + a deliberately
  malformed item (must land in `parse_warnings`, never 500 — detector-rule probe); no write
  path exists (grep); Products API untouched (scope); tsc baseline; WS refetch observed live;
  fail-state paragraph for any new number (DEC-103 §2 — the 14-day window is priced above).

## 5. #93 lineage (why this doesn't need redoing later)

The item grammar IS the kanban schema: `status` = lane; `owner` = assignee; `priority` +
`kind` = swim-lane candidates. When #93 wants drag/drop or multi-writer, the file imports
mechanically into a `status_items` table (SR-ids preserved) and the file retires to
read-only-history — DEC-069 intact. The migration trigger is *interactivity*, not time.
Until then the file stays the source precisely because a file is what a supervisor can curate
in 30 seconds from any seat, and what git already protects.
