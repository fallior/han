/**
 * W6 deterministic repro — the clearSession reconcile/recycle path must send a SLUG-CORRECT
 * welcome-back, never a bare 'welcome back' (the S198 spoke-identity corruption fix).
 *
 * Root: a bare 'welcome back' triggers the global ~/.claude/CLAUDE.md "Leo Invocation" rule →
 * loads LEO regardless of the pane's AGENT_SLUG → a Leo cognition camps a jim spoke → every jim
 * dispatch wedges (all_failed). reconcileSession(slug, surface) calls clearSession with NO
 * welcomeBack, so clearSessionInner's default fired — and it was bare. The fix derives the default
 * from gradientConfigForAgent(slug).displayName (DEC-081 — a 4th agent is correct for free), making
 * it identical to the explicit message the controllers already pass.
 *
 * This drives the REAL clearSession for jim/leo/tenshi with NO welcomeBack (the reconcile path),
 * IO seamed (no real spoke), and asserts the welcome-back === `welcome back <displayName>` (NOT bare).
 *   GREEN (exit 0): every recycle sends the slug-correct wake.
 *   RED   (exit 3): a recycle sent a bare/wrong wake → a Leo would camp the slot.
 * Run: npx tsx scripts/test-welcome-back-identity.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wbident-'));
process.env.HAN_HEALTH_DIR = TMP;
process.env.HAN_PIPES_DIR = path.join(TMP, 'pipes');
const READY_CHROME = '❯  shortcuts · bypass permissions on';
const SURFACE = 'human-response';

async function main(): Promise<void> {
    const d = await import('../src/server/lib/tmux-dispatcher');
    const reg = await import('../src/server/lib/agent-registry');
    const sent: string[] = [];
    d.__setTestHooks({
        sendLine: (_s, line) => sent.push(line),
        sleep: () => new Promise((r) => setTimeout(r, 1)),
        tmuxSessionExists: () => true,        // session "exists" → adopt; no real coldLaunch/spawn
        capturePaneTail: () => READY_CHROME,  // ready chrome present → awaitReadyChrome returns
    });

    const readyPath = (slug: string): string => path.join(TMP, `${slug}-${SURFACE}-ready`);
    const writeSentinel = (slug: string): void => fs.writeFileSync(readyPath(slug), String(Date.now()));

    // The corruption vector: clearSession with NO welcomeBack opt (exactly what reconcileSession does).
    async function reconcileWelcome(slug: string): Promise<string | undefined> {
        writeSentinel(slug);
        await d.ensureSurfaceSession(slug, SURFACE, { ladder: [], welcomeBack: 'welcome back SETUP' });
        sent.length = 0; // ignore the setup wake; record only the recycle sequence
        const release = setTimeout(() => writeSentinel(slug), 30); // newer sentinel releases waitForReady
        await d.clearSession(slug, SURFACE); // ← NO welcomeBack: the reconcile default path under test
        clearTimeout(release);
        return sent.find((l) => l.startsWith('welcome back'));
    }

    const slugs = ['jim', 'leo', 'tenshi'];
    const results: { slug: string; got: string | undefined; want: string; ok: boolean }[] = [];
    for (const slug of slugs) {
        const want = `welcome back ${reg.gradientConfigForAgent(slug).displayName}`;
        const got = await reconcileWelcome(slug);
        results.push({ slug, got, want, ok: got === want });
    }
    d.__setTestHooks(null);

    for (const r of results) {
        console.log(`[repro] ${r.slug}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)} ${r.ok ? '✓' : '✗'}`);
    }
    const allOk = results.every((r) => r.ok);
    const anyBare = results.some((r) => r.got === 'welcome back');
    if (allOk) {
        console.log('\n✅ W6 IDENTITY-CORRECT — the reconcile/recycle path sends a slug-specific welcome-back (jim→Jim, leo→Leo, tenshi→Tenshi). No bare wake can corrupt a non-leo spoke.');
        process.exit(0);
    }
    console.log(`\n❌ W6 WRONG — a recycle sent a non-slug welcome-back (anyBare=${anyBare}). A bare 'welcome back' loads LEO into the slot → the S198 corruption.`);
    process.exit(3);
}

main().catch((e) => { console.error('[repro] harness error:', e); process.exit(2); });
