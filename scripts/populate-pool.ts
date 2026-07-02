/** MNT-009: populate a (slug, surface) warm-stem pool via the dispatcher's single-writer
 *  prewarmAndRegister. PR-C2: per-stem sentinels → pre-warms could run concurrently, but sequential
 *  stays the operator default (gentler). Usage: populate-pool.ts <slug> <surface> <N> */
import { prewarmAndRegister } from '../src/server/lib/tmux-dispatcher';
const slug = process.argv[2] || 'leo';
const surface = process.argv[3] || 'human-response';
const N = parseInt(process.argv[4] || '2', 10);
async function main(): Promise<void> {
    for (let i = 0; i < N; i++) {
        console.log(`[populate] warming ${surface} stem ${i + 1}/${N} for ${slug}…`);
        const stem = await prewarmAndRegister(slug, surface);
        console.log(stem ? `  ✓ registered ${stem.stem_id}  c0=${stem.c0}  model=${stem.model}` : `  ✗ stem ${i + 1} FAILED`);
    }
    console.log('[populate] done.');
}
main().catch((e) => { console.error('[populate]', (e as Error).message); process.exit(1); });
