/**
 * Sleeve-state resolver + writer (R2 P-R2.1, DEC-099 stem-sleeve / Fork A).
 *
 * THE PROBLEM (why Fork A). A surface's identity-keyed state (sentinel, ctx-sidecar, swap,
 * cli-busy, the wm-flush/memory-guard/wake-ctx hooks) is keyed by `$AGENT_SURFACE`. But env is
 * FROZEN at launch (P-R2.0 probe + MNT-013's live receipt): once a `claude` process is running,
 * `tmux set-environment` does NOT reach it or its hook children. So when R2 SLEEVES a pre-warmed
 * stem onto a surface (assigns it a hat at checkout) we cannot re-export `$AGENT_SURFACE` into the
 * already-running process. Fork B (env re-export) is dead.
 *
 * FORK A — a sleeve-state FILE. The dispatcher writes `~/.han/sleeves/<HAN_SESSION>.json =
 * {slug, surface}` at sleeve-time; every surface-keyed resolver reads the sleeve-surface by the
 * STABLE `$HAN_SESSION` (which IS readable from the frozen launch env — a hook/script always
 * inherits it), falling back to `$AGENT_SURFACE` when the file is absent. The fallback is what
 * keeps this INERT: today's launches (no sleeve-state written, or written == the launched
 * surface) resolve byte-for-byte to today's behaviour.
 *
 * This is the .ts half of the resolver; `src/hooks/sleeve-surface.sh` is the .sh twin for hooks
 * (kept in lockstep — see the cross-ref comment there). NOT shelling tsx from a hot-path hook.
 *
 * P-R2.1 scope: this primitive + the wake-ctx logger as the first consumer. P-R2.2 migrates the
 * other facets (wm-flush / memory-guard / sentinel / swap) onto it; P-R2.3 wires the writer at
 * stem-checkout. Until then: written only at launch (= the launched surface) ⇒ inert.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** `~/.han/sleeves/` — reserved in HAN-FILESYSTEM.md for exactly this. */
export function sleevesDir(): string {
    return path.join(os.homedir(), '.han', 'sleeves');
}

function sleevePath(hanSession: string): string {
    return path.join(sleevesDir(), `${hanSession}.json`);
}

/**
 * Resolve the surface for a session: the sleeve-state file's `surface` keyed by `hanSession`
 * (default `$HAN_SESSION`), else the `fallback` (default `$AGENT_SURFACE`, then `session`).
 * NEVER throws — any read/parse problem falls back (fail-soft; a resolver must not break a turn).
 */
export function sleeveSurface(
    hanSession: string | undefined = process.env.HAN_SESSION,
    fallback: string | undefined = process.env.AGENT_SURFACE,
): string {
    const fb = fallback || 'session';
    if (!hanSession) return fb;
    try {
        const raw = fs.readFileSync(sleevePath(hanSession), 'utf-8');
        const surface = JSON.parse(raw)?.surface;
        return (typeof surface === 'string' && surface) ? surface : fb;
    } catch {
        return fb; // absent / unreadable / malformed → today's behaviour
    }
}

/** Resolve the slug the same way (sleeve-state `slug`, else `$AGENT_SLUG`). Fail-soft. */
export function sleeveSlug(
    hanSession: string | undefined = process.env.HAN_SESSION,
    fallback: string | undefined = process.env.AGENT_SLUG,
): string {
    const fb = fallback || 'unknown';
    if (!hanSession) return fb;
    try {
        const slug = JSON.parse(fs.readFileSync(sleevePath(hanSession), 'utf-8'))?.slug;
        return (typeof slug === 'string' && slug) ? slug : fb;
    } catch {
        return fb;
    }
}

/**
 * Write the sleeve-state for a session ATOMICALLY (temp + rename — a concurrent reader never
 * sees a half-file; the no-split-brain requirement). Called by the dispatcher at sleeve-time
 * (today: launch-time). Fail-soft: a write problem is logged by the caller, never throws a turn
 * down — an absent file just means the resolver falls back to `$AGENT_SURFACE`.
 */
export function writeSleeveState(hanSession: string, slug: string, surface: string): void {
    const dir = sleevesDir();
    fs.mkdirSync(dir, { recursive: true });
    const dest = sleevePath(hanSession);
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ slug, surface }) + '\n', 'utf-8');
    fs.renameSync(tmp, dest); // atomic on the same filesystem
}
