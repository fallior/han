/**
 * ring2-ceremony.ts — the DEC-102 Ring-2 authorship split + semantic-diff ceremony (P3c of
 * the update pipeline, S220; thread mqz3wev0; design plans/han-update-p3-design.md §step-6).
 *
 * THE INVARIANT (DEC-102, Tenshi's words): "An update changes a mind only when a human
 * signature and a human's eyes both say so, over a diff neither the attacker nor the noise
 * can hide in."
 *
 * This module is the ceremony's machinery; `scripts/han-update.ts` step 6 is its one caller.
 * The split (DEC-102 Ring 2, Fork 2(c′)):
 *   - AUTHORED identity (the DEC-083 IDENTITY_FILES set + the manifest `identitySection`,
 *     keyed on CONTENT): any change an update produces WITHOUT a migration declaring
 *     `touchesState` on authored trees → ABORT + auto-rollback. The declared case triggers
 *     the ceremony: a semantic diff rendered so neither attacker nor noise can hide in it,
 *     confirmed by the gardener's hand INSIDE the quiesce (the designed visible freeze).
 *   - Template-GENERATED files (CLAUDE.md, .mcp.json) auto-re-sign — transitively
 *     release-signed under Ring 1 — with pre/post hashes logged unconditionally (the
 *     detection-under-prevention half; the ledger wiring lives in han-update).
 *
 * ADVERSARIAL SENSITIVITY (Tenshi's P3 review #1 — the hinge): the adversary declares
 * content-preserving and hides the change. The renderer therefore:
 *   - names every INVISIBLE codepoint introduced on a changed line (zero-width, BOM, bidi
 *     controls — the classes that render as nothing);
 *   - flags CONFUSABLE substitutions (a changed line whose confusable-fold equals its
 *     predecessor's is a line engineered to LOOK unchanged — the homoglyph swap);
 *   - always reports exact added/removed line counts, so a poisoned line inside a
 *     10,000-line "reformat" still moves a number a human reads.
 * The evasion classes the fold cannot catch are NAMED (see CONFUSABLE_FOLD) rather than
 * assumed away — P5's adversarial-evasion case proves the catch and documents the residue.
 *
 * Config-independent cores take EXPLICIT inputs (`*At` naming, the identity-manifest-core
 * pattern) so scratch gardens and the red-suite drive them without the live registry.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { IDENTITY_FILES } from './identity-manifest-core';

// ── types ─────────────────────────────────────────────────────────────────────────────────

export type AuthoredKind = 'file' | 'manifest-identity';

export interface AuthoredArtefact {
    resident: string;
    /** File basename (e.g. `identity.md`) or the literal `identitySection`. */
    name: string;
    kind: AuthoredKind;
    /** Absolute path for kind='file'; null for the manifest field. */
    absPath: string | null;
    /** null = absent (a legitimate state: optional files, unborn residents). */
    content: string | null;
    sha256: string | null;
}

export interface AuthoredSnapshot {
    takenAt: string;
    artefacts: AuthoredArtefact[];
}

export interface AuthoredDelta {
    resident: string;
    name: string;
    kind: AuthoredKind;
    pre: AuthoredArtefact | null;
    post: AuthoredArtefact | null;
}

/** A resident's authored-identity inputs, explicit (the config-independent shape). */
export interface ResidentAuthoredDirs {
    slug: string;
    memoryDir: string;
    fractalDir: string;
    identitySection: string | null;
}

export interface StateDeclaration {
    migrationId: number;
    description: string;
    touchesState: string[];
    stateChangeKind: 'content-preserving' | 'schema-moving';
}

export type Ring2Verdict =
    | { kind: 'unchanged' }
    | { kind: 'abort-undeclared'; deltas: AuthoredDelta[] }
    | { kind: 'ceremony'; deltas: AuthoredDelta[]; redFlag: boolean };

export interface RenderedDiff {
    /** The full human-facing rendering (unified diff + codepoint findings + counts). */
    rendered: string;
    /** sha256 of `rendered` — the go-file binding (a go-file approves exactly ONE rendering). */
    digest: string;
    findings: string[];
}

// ── snapshot + compare ────────────────────────────────────────────────────────────────────

const sha256 = (s: string | Buffer): string => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Snapshot the authored-identity content for the given residents. Keyed on CONTENT
 * (DEC-102: the manifest identitySection is a FIELD compared as its string value, never
 * garden-manifest.json bytes — the privilege half of that file changes legitimately).
 * Absent files snapshot as content=null — presence/absence changes are deltas too.
 */
export function snapshotAuthoredAt(residents: ResidentAuthoredDirs[]): AuthoredSnapshot {
    const artefacts: AuthoredArtefact[] = [];
    for (const r of residents) {
        for (const spec of IDENTITY_FILES) {
            const dir = spec.location === 'fractalDir' ? r.fractalDir : r.memoryDir;
            const absPath = path.join(dir, spec.name);
            let content: string | null = null;
            try { content = fs.readFileSync(absPath, 'utf8'); } catch { /* absent — legitimate */ }
            artefacts.push({
                resident: r.slug, name: spec.name, kind: 'file', absPath,
                content, sha256: content === null ? null : sha256(content),
            });
        }
        artefacts.push({
            resident: r.slug, name: 'identitySection', kind: 'manifest-identity', absPath: null,
            content: r.identitySection, sha256: r.identitySection === null ? null : sha256(r.identitySection),
        });
    }
    return { takenAt: new Date().toISOString(), artefacts };
}

/** Every artefact whose content hash differs pre→post (including appear/disappear). */
export function compareAuthored(pre: AuthoredSnapshot, post: AuthoredSnapshot): AuthoredDelta[] {
    // NUL separator (collision-proof: a NUL appears in neither a slug nor a filename),
    // written as the \u0000 ESCAPE not a literal byte: the trust-critical tool must not
    // carry the very control-byte class it exists to expose (MNT-026 on our own file - the
    // literal NUL had made this whole module git-binary / grep-silent; Jim's P3c catch).
    const key = (a: AuthoredArtefact) => `${a.resident}\u0000${a.name}`;
    const preMap = new Map(pre.artefacts.map((a) => [key(a), a]));
    const postMap = new Map(post.artefacts.map((a) => [key(a), a]));
    const deltas: AuthoredDelta[] = [];
    for (const [k, p] of preMap) {
        const q = postMap.get(k) ?? null;
        if ((q?.sha256 ?? null) !== p.sha256) {
            deltas.push({ resident: p.resident, name: p.name, kind: p.kind, pre: p, post: q });
        }
    }
    for (const [k, q] of postMap) {
        if (!preMap.has(k)) deltas.push({ resident: q.resident, name: q.name, kind: q.kind, pre: null, post: q });
    }
    return deltas;
}

// ── the split's verdict (pure — han-update wires verdict → rollback/ceremony) ─────────────

/**
 * DEC-102 Ring 2, the dispatch:
 *   - no deltas → unchanged (a declared content-preserving migration rendering an EMPTY
 *     delta is the ONLY auto-pass; the caller logs it against the declarations);
 *   - deltas with NO declaration covering authored state → abort-undeclared ("the
 *     legitimate case does not exist outside a migration that explicitly declares
 *     touchesState" — DEC-102 verbatim);
 *   - deltas WITH declarations → the ceremony, always human eyes. redFlag=true when every
 *     declaration said content-preserving (a non-empty delta under that declaration is
 *     "the one red flag"); schema-moving is never auto-passed either way.
 * Granularity note: pre-P3d the runner applies a run's migrations as one unit, so the
 * declarations arrive as the RUN's union; DEC-102's "the ceremony for that migration
 * alone" sharpens to per-migration scoping when P3d's state-copy leg lands.
 *
 * CALLER DUTY (P5, Casey mrne791x / Jim mrnep6k3): a verdict over a declared move-set is
 * valid ONLY over the MERGED delta set — the identity deltas (compareAuthored over
 * IDENTITY_FILES) UNIONED with the non-identity deltas (state-swap.declaredTreeFileDeltas /
 * nonIdentityTreeDeltas) — see han-update 6a-staged. Handing this function identity deltas
 * ALONE re-opens the enumeration seam (rendered-set ≠ swapped-set): it will return
 * `unchanged` while non-identity files (working-memory, the c0/c1 gradient sources) ride to
 * live unseen. The equality is guarded HERE by the caller's diligence and by the single-door
 * Wall; the structural cure, if a SECOND caller ever appears, is to reshape this API so it
 * cannot be invoked without the move-set. Recorded so the future finds it.
 */
export function ring2Verdict(deltas: AuthoredDelta[], declarations: StateDeclaration[]): Ring2Verdict {
    if (deltas.length === 0) return { kind: 'unchanged' };
    if (declarations.length === 0) return { kind: 'abort-undeclared', deltas };
    const redFlag = declarations.every((d) => d.stateChangeKind === 'content-preserving');
    return { kind: 'ceremony', deltas, redFlag };
}

// ── P5 enumeration-seam adapter (Tenshi mrnd1cqj / plan mrndfo4b / Jim GREEN mrndq9k5) ─────

/**
 * Map a declared tree's NON-IDENTITY file deltas (state-swap.declaredTreeFileDeltas) into
 * the ceremony's AuthoredDelta shape, so `ring2Verdict` + `renderCeremonyDocument` cover the
 * WHOLE move-set (rendered-set == swapped-set — the P5 equality). The shape is generic by
 * design: renderSemanticDiff keys only on pre/post content + resident/name, so the landed
 * control-byte / homoglyph / reorder hardening applies to these deltas unchanged (verified
 * at build — nothing in the renderer keys on IDENTITY_FILES). `resident` carries the
 * declared tree, `name` the rel-from-$HAN_HOME, for a legible ceremony line. A delta whose
 * content is a `symlink → <target>` string renders the RETARGET, never followed content
 * (Jim fold-2, produced upstream in declaredTreeFileDeltas). DEC-102 note: this NARROWS the
 * content-preserving auto-pass ("identity files unchanged" → "the whole declared tree
 * unchanged") — it completes the human-eyes guarantee, named at land per the Settled rule.
 */
export function nonIdentityTreeDeltas(tree: string, deltas: Array<{ rel: string; staged: string | null; live: string | null }>): AuthoredDelta[] {
    const art = (name: string, content: string | null): AuthoredArtefact | null => content === null ? null : {
        resident: tree, name, kind: 'file', absPath: null, content, sha256: sha256(content),
    };
    return deltas.map(({ rel, staged, live }) => ({
        resident: tree, name: rel, kind: 'file' as AuthoredKind, pre: art(rel, live), post: art(rel, staged),
    }));
}

// ── the semantic renderer (the diff neither attacker nor noise can hide in) ───────────────

/** Codepoints that render as NOTHING (or reorder rendering) — each named when introduced.
 *  Written as \\uXXXX escapes ONLY: this module must never itself carry the invisible bytes
 *  it exists to expose (the MNT-026 byte-stuffing lesson, applied to our own source). */
const INVISIBLE_CODEPOINTS: ReadonlyArray<{ re: RegExp; label: string }> = [
    { re: /[\u200B-\u200D]/g, label: 'ZERO-WIDTH (U+200B–U+200D)' },
    { re: /\u2060/g, label: 'WORD JOINER (U+2060)' },
    { re: /\uFEFF/g, label: 'BOM/ZWNBSP (U+FEFF)' },
    { re: /[\u202A-\u202E]/g, label: 'BIDI EMBEDDING/OVERRIDE (U+202A–U+202E)' },
    { re: /[\u2066-\u2069]/g, label: 'BIDI ISOLATE (U+2066–U+2069)' },
    { re: /\u00AD/g, label: 'SOFT HYPHEN (U+00AD)' },
    { re: /[\u2028\u2029]/g, label: 'LINE/PARA SEPARATOR (U+2028/U+2029)' },
];

/**
 * A deliberately BASIC confusable fold — the common Cyrillic/Greek lookalikes for Latin.
 * NAMED LIMIT (the design's honest out, proven at P5): this map catches the cheap homoglyph
 * classes; it is NOT a full UTS-39 skeleton. Classes it cannot catch — exotic-script
 * confusables outside this table, and semantically-equivalent REWRITES (visible text whose
 * meaning shifts) — are surfaced instead by the line-count + full unified diff a human reads.
 */
const CONFUSABLE_FOLD: ReadonlyMap<string, string> = new Map(Object.entries({
    '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y',
    '\u0445': 'x', '\u0456': 'i', '\u0458': 'j', '\u04BB': 'h', '\u0455': 's', '\u0501': 'd',
    '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041A': 'K', '\u041C': 'M', '\u041D': 'H',
    '\u041E': 'O', '\u0420': 'P', '\u0421': 'C', '\u0422': 'T', '\u0425': 'X',
    '\u03B1': 'a', '\u03BF': 'o', '\u03C1': 'p', '\u03BD': 'v', '\u0391': 'A', '\u0392': 'B',
    '\u0395': 'E', '\u0397': 'H', '\u039A': 'K', '\u039C': 'M', '\u039D': 'N', '\u039F': 'O',
    '\u03A1': 'P', '\u03A4': 'T', '\u03A7': 'X',
}));

/** Fold confusables to their Latin lookalikes and strip invisibles — visual-equality key. */
export function confusableFold(s: string): string {
    let out = '';
    for (const ch of s) {
        if (INVISIBLE_CODEPOINTS.some(({ re }) => { re.lastIndex = 0; return re.test(ch); })) continue;
        out += CONFUSABLE_FOLD.get(ch) ?? ch;
    }
    return out;
}

const cpHex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** A C0/C1 CONTROL byte that is NEVER legitimate in authored-identity prose. Tab (0x09) is the
 *  one legit control; LF (0x0A) is the line separator (split off before the scan). Everything
 *  else — NUL (blinds git/grep), CR (spoofs the terminal render vs the bytes), VT, FF, ESC,
 *  DEL, and the whole C1 band — is named. Finding C (Tenshi P5) + Jim's literal-NUL class. */
const CONTROL_NAMES: Readonly<Record<number, string>> = {
    0x00: 'NUL', 0x07: 'BEL', 0x08: 'BS', 0x0b: 'VT', 0x0c: 'FF', 0x0d: 'CR',
    0x1b: 'ESC', 0x7f: 'DEL', 0x85: 'NEL',
};
function isControlByte(cp: number): boolean {
    return (cp <= 0x1f && cp !== 0x09 && cp !== 0x0a) || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f);
}
function controlLabel(cp: number): string {
    return CONTROL_NAMES[cp] ?? (cp <= 0x1f ? 'C0-CONTROL' : 'C1-CONTROL');
}

/**
 * Name every suspect codepoint on a line, in three bands:
 *   - **CONTROL** (finding C + Jim's NUL) — any C0/C1 control that isn't tab: non-text bytes
 *     that render UNLIKE their bytes (CR), blind tooling (NUL), or carry no legitimate meaning
 *     in identity prose. Named FIRST, spanning both the <0x80 and 0x80–0x9F ranges.
 *   - named **INVISIBLE** formatting (zero-width, BOM, bidi) — the render-as-nothing class.
 *   - non-ASCII homoglyphs: known **CONFUSABLE** (fold-twin bonus), else **NON-ASCII** (Jim's
 *     P3c fold — an exotic lookalike outside the fold-table, e.g. fullwidth `\uFF41` or the
 *     mathematical-alphanumeric `\u{1D41A}`, still earns a loud line rather than passing as a
 *     visually-identical change).
 * Any suspect codepoint in authored-identity PROSE (ASCII by overwhelming construction) is
 * inherently worth surfacing — the code honours its own contract rather than claim a defence
 * it lacks (the census-class quiet lie).
 */
export function scanSuspectCodepoints(line: string): string[] {
    const findings: string[] = [];
    for (const { re, label } of INVISIBLE_CODEPOINTS) {
        re.lastIndex = 0;
        const n = (line.match(re) ?? []).length;
        if (n) findings.push(`${label} ×${n}`);
    }
    for (const ch of line) {
        const cp = ch.codePointAt(0)!;
        if (isControlByte(cp)) {                          // finding C — spans both ASCII-control and C1
            findings.push(`CONTROL ${controlLabel(cp)} (${cpHex(cp)}) — non-text control byte in authored identity prose; renders unlike its bytes / blinds tooling`);
            continue;
        }
        if (cp < 0x80) continue;                          // plain printable ASCII — not suspect
        if (INVISIBLE_CODEPOINTS.some(({ re }) => { re.lastIndex = 0; return re.test(ch); })) continue; // already named above
        if (CONFUSABLE_FOLD.has(ch)) {
            findings.push(`CONFUSABLE ${JSON.stringify(ch)} (${cpHex(cp)}) — Latin lookalike '${CONFUSABLE_FOLD.get(ch)}'`);
        } else {
            findings.push(`NON-ASCII ${JSON.stringify(ch)} (${cpHex(cp)}) — introduced into authored identity prose; verify it is intended`);
        }
    }
    return findings;
}

/** Rendering-independent line diff (finding A): the added/removed sets come from the RAW
 *  strings, computed by multiset difference — never from git's output. Split on `\n` ONLY, so a
 *  CR (`\r`) stays INSIDE its line where the scanner names it (the terminal-render spoof), and
 *  a NUL stays in its line where the scanner names it (git's binary mode cannot suppress bytes
 *  we split ourselves). Coarse vs an LCS, but binary-mode-proof, which is the whole point. */
function rawLineDiff(pre: string, post: string): { added: string[]; removed: string[] } {
    const dec = (m: Map<string, number>, k: string): boolean => { const n = m.get(k) ?? 0; if (n > 0) { m.set(k, n - 1); return true; } return false; };
    const count = (arr: string[]): Map<string, number> => { const m = new Map<string, number>(); for (const l of arr) m.set(l, (m.get(l) ?? 0) + 1); return m; };
    const preLines = pre.split('\n'), postLines = post.split('\n');
    const preAvail = count(preLines), postAvail = count(postLines);
    const added = postLines.filter((l) => !dec(preAvail, l));
    const removed = preLines.filter((l) => !dec(postAvail, l));
    return { added, removed };
}

/**
 * Reduce a `git diff --no-index` header (already `a/pre b/post` from the cwd-relative
 * invocation) to a render-environment-independent CANONICAL form: the `pre`/`post` tokens
 * become the artefact's own name, so the rendered document — and the ceremony digest that is
 * its sha256 — is a pure function of (pre content, post content, name), never of the temp dir
 * the diff was computed in. Named as the SHAPE (Jim mrnk7qh3): strip render-env to a canonical
 * header, not "strip these two paths." Replacement via a function literal so a `$` in the name
 * is never read as a String.replace backreference.
 *
 * Casey's belt (mrnmn06a): DROP the `index <sha1>..<sha1> <mode>` line entirely. It is the one
 * git-output element that is BOTH invisible to the gardener AND carries an algorithm-derived
 * value (git's blob SHA-1) — the sole remaining algorithm-dependent token in the digest. It is
 * pure plumbing (a human reads the +/− lines, never the index line), so removing it takes the
 * last non-content token out of the digest at zero human-facing cost: the digest becomes a
 * pure function of (pre, post, name), full stop. (Casey reproduced NO divergence from it on
 * current SHA-1 git — this is the tidy completion of the guarantee, not a reproduced gap; the
 * residual TRUST BASE below it, the git binary's own format, is named in the design-doc.)
 */
function canonicalizeDiffHeader(unified: string, delta: AuthoredDelta): string {
    const name = delta.name;  // legible + deterministic (already qualifies the artefact)
    return unified
        .replace(/^diff --git a\/pre b\/post$/m, () => `diff --git a/${name} b/${name}`)
        .replace(/^index [0-9a-f]+\.\.[0-9a-f]+( [0-7]+)?\n/m, '')  // Casey's belt — drop the algorithm-derived plumbing line
        .replace(/^--- a\/pre$/m, () => `--- a/${name}`)
        .replace(/^\+\+\+ b\/post$/m, () => `+++ b/${name}`)
        .replace(/^Binary files a\/pre and b\/post differ$/m, () => `Binary files a/${name} and b/${name} differ`);
}

/**
 * Render one artefact's semantic diff. THE FINDINGS COME FROM THE RAW BYTES, never git's
 * rendering (finding A, architectural — Tenshi P5): a safeguard that reads the rendering
 * inherits the rendering's blind spots (git binary-mode emits 0 lines on a NUL-poisoned file,
 * defeating both the line-counts AND the codepoint scan at once). git's unified diff is kept
 * ONLY for the human's readable line-context (presentation); the finding-generating scan runs
 * over `delta.pre/post.content` directly. The pass:
 *   - suspect codepoints named per changed line (raw), incl. the C0/C1 CONTROL band;
 *   - a removed/added line pair that FOLDS EQUAL is flagged as a RENDERS-IDENTICAL substitution;
 *   - exact raw added/removed counts head the rendering (noise cannot zero a number, and binary
 *     mode cannot either — the counts are computed from the raw split, not git).
 */
export function renderSemanticDiff(delta: AuthoredDelta): RenderedDiff {
    const pre = delta.pre?.content ?? '';
    const post = delta.post?.content ?? '';

    // Presentation ONLY — the readable line-context for the human. NEVER the finding source.
    let unified = '';
    let gitWentBinary = false;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ring2-'));
    try {
        fs.writeFileSync(path.join(tmp, 'pre'), pre);
        fs.writeFileSync(path.join(tmp, 'post'), post);
        try {
            // RENDER-ENVIRONMENT DETERMINISM (Tenshi's E2E finding mrngirjr; the CLASS-fix,
            // Casey mrnkijz5 + Tenshi mrnkq5qh). The rendered document's sha256 IS the ceremony
            // digest; if it embeds anything the render ENVIRONMENT supplies, the consent record
            // cannot be RECONSTRUCTED across boxes (re-rendering from the DEC-069 pre-copies on
            // Mike's differently-configured machine, to answer "what exactly did I approve?",
            // would yield a different fingerprint than the ledger holds — evidence law's
            // self-authenticating-record principle: a record carries its own proof, not the
            // venue's). Two environment vectors, both closed here:
            //   (1) the random mkdtemp path — closed BY CONSTRUCTION by running git from INSIDE
            //       the temp dir with RELATIVE paths, so the --no-index header is `a/pre b/post`,
            //       never the absolute path;
            //   (2) ambient git config (`diff.noprefix` emits bare `pre`/`post` and defeats the
            //       canonicaliser; `diff.external` replaces the diff with arbitrary command
            //       stdout) — closed by a HERMETIC git env. Tenshi's Trusting-Trust invariant
            //       demands it: a trust artefact keys only on code under the tag signature or
            //       off-box operator data, NEVER on unsigned data the environment supplies
            //       (Casey's Henry VIII question — who writes what this reads? — ambient
            //       ~/.gitconfig, denied here). GIT_CONFIG_GLOBAL/SYSTEM=/dev/null + NOSYSTEM=1
            //       override any hostile value in process.env (explicit keys after the spread
            //       win).
            //   (3) process LOCALE (Jim mrnlk3tv, confirmed Tenshi mrnlpsbx). git's `Binary
            //       files … differ` message is its ONE translatable line; on a non-English box
            //       (Mike's German one) git emits it translated, the English-anchored
            //       `gitWentBinary` regex (:~/Binary files .* differ/) MISSES → gitWentBinary
            //       stays false → the translated line rides into `unified` → into the digest.
            //       (Security detection HOLDS — controlOrNonText is also set by the raw-byte
            //       CONTROL scan, byte-based and locale-proof — so this is a reconstructibility
            //       break, not a detection break.) Closed by forcing the C locale: LC_ALL/LANG=C
            //       + LANGUAGE='' (gettext consults LANGUAGE only when the locale is NOT C, so
            //       LC_ALL=C neutralises it — cleared too, to deny the whole locale surface
            //       rather than lean on that precedence subtlety).
            // With path, config AND locale denied and the `index <sha1>..<sha1>`/`100644` lines
            // content-derived, the header is a pure function of content. Don't enumerate which
            // env keys perturb it — deny the whole ENVIRONMENT surface (path + config + locale)
            // its influence (Jim's "shape, not instance", fully realised across three doors).
            execFileSync('git', ['diff', '--no-index', '--unified=3', '--', 'pre', 'post'],
                { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'],
                  env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
                         LC_ALL: 'C', LANG: 'C', LANGUAGE: '' } });
        } catch (e) {
            unified = String((e as { stdout?: Buffer }).stdout ?? '');  // git exits 1 when files differ — that IS the diff
        }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    // Canonical header (Jim's fold, mrnk7qh3): reduce the git tokens `pre`/`post` to the
    // artefact's own name — the guarantee is the SHAPE (a render-environment-independent
    // canonical header), not a one-off strip of two paths. Belt to the cwd-relative brace
    // above: even were git to emit an unexpected token, the rendered doc carries only the
    // artefact name. Replacement via a FUNCTION so a `$` in a filename can't be read as a
    // backreference. The reconstructibility test pins the whole guarantee.
    unified = canonicalizeDiffHeader(unified, delta);
    if (/^Binary files .* differ$/m.test(unified) || (unified === '' && pre !== post)) gitWentBinary = true;

    // FINDINGS — from the raw content, binary-mode-proof.
    const { added, removed } = rawLineDiff(pre, post);
    const findings: string[] = [];
    let controlOrNonText = gitWentBinary;

    for (const body of added) {
        const sus = scanSuspectCodepoints(body);
        if (sus.length) {
            if (sus.some((s) => s.startsWith('CONTROL'))) controlOrNonText = true;
            // localized: the offending line + the offset of the first suspect byte — never a whole-file dump
            const firstBad = [...body].findIndex((ch) => scanSuspectCodepoints(ch).length > 0);
            findings.push(`CHANGED line carries: ${sus.join('; ')} @ offset ${firstBad} :: ${JSON.stringify(body.slice(0, 120))}`);
        }
    }
    // The engineered-to-look-unchanged detector: an added line whose fold equals a removed
    // line's fold while the bytes differ is a hidden substitution (invisible or confusable).
    const removedFolds = new Map<string, string>();
    for (const body of removed) removedFolds.set(confusableFold(body), body);
    for (const body of added) {
        const foldTwin = removedFolds.get(confusableFold(body));
        if (foldTwin !== undefined && foldTwin !== body) {
            findings.push(`🚨 INVISIBLE-ONLY / CONFUSABLE SUBSTITUTION — a changed line RENDERS IDENTICAL to the line it replaced: ${JSON.stringify(body.slice(0, 120))}`);
        }
    }

    // THE MULTISET-PRESERVING GUARD (Jim's must-fix, Tenshi's sharpening): the raw multiset
    // diff makes a pure LINE-REORDER (or line-move / dup-and-delete) produce added=removed=0
    // even though pre !== post — and ordering IS meaning in prose ("proceed without asking" ⏎
    // "NEVER modify" licenses the opposite of the reverse). Keyed on the INVARIANT, not the
    // word "reorder": the head must NEVER render a bare 0/0 while the bytes differ. This closes
    // reorder AND any future multiset-preserving evasion the counts alone can't see.
    const multisetPreserving = added.length === 0 && removed.length === 0 && pre !== post;
    if (multisetPreserving) {
        findings.push('🚨 MULTISET-PRESERVING CHANGE (reorder / line-move) — byte-different with an identical line multiset; ordering is meaning in prose; review the presentation diff line-by-line');
    }

    const presence =
        delta.pre === null || delta.pre.content === null ? ' [artefact APPEARED]' :
        delta.post === null || delta.post.content === null ? ' [artefact REMOVED]' : '';
    // The loud non-text banner: a control/binary hit can NEVER render as 0/0 or a quiet diff.
    const redBanner = controlOrNonText ? `🔴 NON-TEXT / CONTROL CONTENT IN AUTHORED IDENTITY — scanned from raw bytes (git ${gitWentBinary ? 'rendered this BINARY — presentation below is unreliable; trust the findings' : 'rendered it, but findings are byte-scanned regardless'})\n` : '';
    const head = `═══ ${delta.resident} :: ${delta.name}${presence} — ${removed.length} line(s) removed, ${added.length} added${multisetPreserving ? ' ⚠ REORDERED (byte-different, multiset-identical)' : ''} ═══`;
    const findingsBlock = findings.length
        ? `\n⚠ ADVERSARIAL-SENSITIVITY FINDINGS (raw-byte scan):\n${findings.map((f) => `  ${f}`).join('\n')}\n`
        : '';
    const presentation = gitWentBinary ? '(git rendered this as non-text — see the raw-byte findings above)\n' : unified;
    const rendered = `${redBanner}${head}\n${findingsBlock}${presentation}`;
    return { rendered, digest: sha256(rendered), findings };
}

/** Render every delta into ONE ceremony document with ONE binding digest. */
export function renderCeremonyDocument(deltas: AuthoredDelta[], declarations: StateDeclaration[], redFlag: boolean): RenderedDiff {
    const parts = deltas.map((d) => renderSemanticDiff(d));
    const declLines = declarations.map((d) =>
        `  #${String(d.migrationId).padStart(3, '0')} ${d.description} — declares ${d.stateChangeKind} on: ${d.touchesState.join(', ')}`);
    const rendered = [
        '🔔 DEC-102 RING-2 CEREMONY — authored identity would change under this update',
        redFlag
            ? '🚩 RED FLAG: the declaring migration(s) said CONTENT-PRESERVING, yet the delta below is NOT EMPTY.'
            : 'Declared schema-moving — human eyes required by design (never auto-passed).',
        'Declarations:',
        ...declLines,
        '',
        ...parts.map((p) => p.rendered),
    ].join('\n');
    return { rendered, digest: sha256(rendered), findings: parts.flatMap((p) => p.findings) };
}

// ── the abort path's restore (the snapshot IS the authored pre-copy) ──────────────────────

/**
 * Restore authored FILES to their snapshotted pre-content after an abort/decline. Without
 * this, a rogue mutation survives the rollback ON DISK — and the next wake's DEC-083 gate
 * would AUTO-RESIGN it as a content-only change (verify-and-resign's default), laundering
 * the poison into a signed manifest (caught at the P3c E2E: the update rolled back, the
 * poisoned identity.md stayed). DEC-069 holds: a file that APPEARED is quarantine-renamed
 * (never deleted); a mutated file's poisoned content is superseded by the pre-content it
 * overwrote (the mutation was never memory — it was the attack). The manifest
 * identitySection is a FIELD of garden-manifest.json — not restorable from here; reported
 * for the operator's hand.
 */
export function restoreAuthored(deltas: AuthoredDelta[]): string[] {
    const notes: string[] = [];
    for (const d of deltas) {
        if (d.kind === 'manifest-identity') {
            notes.push(`⚠ ${d.resident}: manifest identitySection changed — NOT auto-restorable (garden-manifest.json is operator-authored); restore it by hand`);
            continue;
        }
        const p = d.pre?.absPath ?? d.post?.absPath;
        if (!p) continue;
        if (d.pre === null || d.pre.content === null) {
            // the artefact APPEARED — quarantine, never delete (DEC-069)
            if (fs.existsSync(p)) {
                const q = `${p}.ring2-quarantined-${Date.now()}`;
                fs.renameSync(p, q);
                notes.push(`${d.resident}:${d.name} APPEARED undeclared — quarantined to ${path.basename(q)}`);
            }
        } else {
            fs.writeFileSync(p, d.pre.content);
            notes.push(`${d.resident}:${d.name} restored to snapshotted pre-content`);
        }
    }
    return notes;
}

// ── the gardener's ring (the decision, inside the designed visible freeze) ────────────────

export interface CeremonyIO {
    signalsDir: string;
    /** Poll ceiling for the non-interactive go-file path. Timeout → DECLINED (fail-closed:
     *  the freeze must end in a decision, and no-decision is a decline, never a pass). */
    timeoutMs?: number;
    pollMs?: number;
    print?: (s: string) => void;
}

/**
 * Present the ceremony document and obtain the gardener's decision.
 *   - Interactive (stdin is a TTY): a y/N prompt — his hand at the keyboard.
 *   - Non-interactive: a DIGEST-BOUND go-file — write the ceremony digest into
 *     `<signalsDir>/update-ceremony-go` to approve (binding the approval to exactly THIS
 *     rendering; a stale/other go-file cannot approve a diff it never saw), or touch
 *     `<signalsDir>/update-ceremony-decline` to decline. Timeout declines (fail-closed).
 * The quiesce SPANS this deliberation by construction — the caller holds the freeze.
 */
export async function ceremonyDecision(doc: RenderedDiff, io: CeremonyIO): Promise<'approved' | 'declined'> {
    const print = io.print ?? ((s: string) => console.log(s));
    print(doc.rendered);
    print('');
    print('🧊 GARDEN PAUSED PENDING YOUR RING (DEC-102 Ring 2) — the quiesce spans this deliberation.');
    print(`   ceremony digest: ${doc.digest}`);

    if (process.stdin.isTTY) {
        const answer = await new Promise<string>((resolve) => {
            process.stdout.write('   Approve this authored-identity change? [y/N] ');
            process.stdin.resume();
            process.stdin.once('data', (d) => { process.stdin.pause(); resolve(d.toString().trim()); });
        });
        return /^y(es)?$/i.test(answer) ? 'approved' : 'declined';
    }

    const goPath = path.join(io.signalsDir, 'update-ceremony-go');
    const declinePath = path.join(io.signalsDir, 'update-ceremony-decline');
    print(`   Non-interactive: approve  → printf '%s' '${doc.digest}' > ${goPath}`);
    print(`                    decline  → touch ${declinePath}`);
    const timeoutMs = io.timeoutMs ?? 60 * 60_000;
    const pollMs = io.pollMs ?? 5_000;
    const t0 = Date.now();
    let warnedWrongDigest = false;
    while (Date.now() - t0 < timeoutMs) {
        if (fs.existsSync(declinePath)) {
            fs.unlinkSync(declinePath);
            return 'declined';
        }
        if (fs.existsSync(goPath)) {
            const got = fs.readFileSync(goPath, 'utf8').trim();
            fs.unlinkSync(goPath); // consume either way — a wrong digest must not linger as a future approval
            if (got === doc.digest) return 'approved';
            if (!warnedWrongDigest) {
                print(`   ⚠ go-file digest mismatch (got ${got.slice(0, 16)}…) — an approval must quote THIS ceremony's digest; still waiting`);
                warnedWrongDigest = true;
            }
        }
        await new Promise((r) => setTimeout(r, pollMs));
    }
    print('   ⏱ ceremony timed out with no decision → DECLINED (fail-closed)');
    return 'declined';
}
