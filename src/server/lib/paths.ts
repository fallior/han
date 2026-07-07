/**
 * paths.ts — the ONE path resolver (P0 of the live-garden update pipeline, S218).
 *
 * Closes #101 (path-portability): the engine must carry ZERO absolute user paths, or a
 * pushed update unions OUR filesystem into another garden (Jim's opener, thread mqz3wev0).
 * Every engine file resolves locations through these functions — never a literal.
 *
 * Resolution order (each): explicit env override → derived default. On OUR box the
 * defaults resolve to today's exact values, so P0 is behaviour-identical by construction.
 *
 * The shell twin is `src/hooks/paths.sh` — keep the two aligned if the resolution
 * contract changes (the sleeve-surface.sh precedent).
 */

import * as os from 'os';
import * as path from 'path';

/** The garden's state root (config + memory + signals + health): `$HAN_HOME` → `~/.han`. */
export function hanHome(): string {
    return process.env.HAN_HOME || path.join(os.homedir(), '.han');
}

/**
 * The engine repo root: `$HAN_REPO` → derived from THIS module's own location
 * (src/server/lib/paths.ts is three levels below the root) — never a user literal,
 * so a clone anywhere self-locates.
 */
export function hanRepo(): string {
    return process.env.HAN_REPO || path.resolve(__dirname, '..', '..', '..');
}

/** The projects workspace: `$HAN_PROJECTS` → `~/Projects`. */
export function projectsDir(): string {
    return process.env.HAN_PROJECTS || path.join(os.homedir(), 'Projects');
}

export function agentsDir(): string { return path.join(hanHome(), 'agents'); }
export function healthDir(): string { return path.join(hanHome(), 'health'); }
export function signalsDir(): string { return path.join(hanHome(), 'signals'); }
export function sleevesDir(): string { return path.join(hanHome(), 'sleeves'); }
export function memoryDir(): string { return path.join(hanHome(), 'memory'); }
export function poolDir(): string { return path.join(hanHome(), 'pool'); }
export function logsDir(): string { return path.join(hanHome(), 'logs'); }
export function serverDir(): string { return path.join(hanRepo(), 'src', 'server'); }
export function scriptsDir(): string { return path.join(hanRepo(), 'scripts'); }
export function hooksDir(): string { return path.join(hanRepo(), 'src', 'hooks'); }
export function templatesDir(): string { return path.join(hanRepo(), 'templates'); }
