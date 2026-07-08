# migrations/ — the state-migration framework (P2 of the update pipeline, S218)

Ordered, forward-only, **non-destructive** migrations for a garden's state (gradient.db +
memory-file formats). Run by `scripts/han-migrate.ts`; consumed by `han update` at P3.

## The law (DEC-069 at the framework layer)
- **Forward-only. There are NO down() migrations** — a down is destroy-and-reconstruct, the
  exact violation the garden forbids. The rollback is the byte-exact pre-copy the runner
  keeps (`gradient.db.pre-v<N>-<ts>`), superior to any reconstruction.
- Every `up()` **transforms, supersedes, or quarantines. Never DROPs a table/column that
  holds memory; never DELETEs rows.** Renaming/annotating/adding is fine; destruction is not.
- `up()` and `verify()` run against **THE COPY** — the live DB is swapped in atomically only
  after every migration in the run verifies plus the runner's generic integrity sweep passes.
- One file per version: `NNN-description.ts`, exporting a `Migration` (see
  `src/server/lib/state-schema.ts`). `id` = the version the migration RESULTS in.

## Why copies-first (the DEC-080 lesson made a framework)
The 2026-04-29 cutover was a live-garden schema migration done with hands and held breath.
This framework is that experience made repeatable for gardens we cannot see (Mike's, and
every garden after): if anything fails, the failure happened to a copy.
