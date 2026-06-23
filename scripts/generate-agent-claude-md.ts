/**
 * generate-agent-claude-md — the ONE render path from `templates/CLAUDE.template.md`
 * to an agent's per-agent CLAUDE.md (S199 P4+P5, DEC-073→config). Supersedes the
 * per-launcher bash `generate_claude_md` + envsubst (the duplicated heredoc/allowlist
 * in each `han<agent>`). Both the interactive launchers (step 3) and the serverless
 * spoke launcher (step 5) call this so identity flows from the Garden Manifest, one source.
 *
 * Why .ts (not the .sh Jim's plan named): the identity prose is MULTI-LINE and full of
 * backticks — exporting it through bash env/heredoc to `envsubst` is escaping-fragile and
 * injection-prone. Rendering in-process (explicit ${VAR} substitution over the manifest map)
 * is byte-deterministic and needs no shell allowlist. FLAGGED for Jim's audit — the spirit
 * (single shared render path, identity-as-config, fail-loud) is preserved; only the language moved.
 *
 * Substitution semantics match `envsubst "$ALLOWLIST"`: a ${VAR} present in the contract is
 * replaced; any other ${...} is left literal. The template references exactly the 19 contract
 * vars (grep-verified), so all expand — INCLUDING ${AGENT_PRONOUN_OBJ}, which the old launcher
 * allowlists omitted (the long-standing unexpanded-var gap, now closed).
 *
 * Usage (run from src/server so imports resolve, like manifest-get.ts):
 *   npx tsx ../../scripts/generate-agent-claude-md.ts <slug> [surface] [--stdout]
 *     default surface = 'session'; --stdout prints instead of writing the agent-dir file
 *     (used by the build's byte-equivalence proof).
 */

import * as fs from 'fs';
import * as path from 'path';
import { agentTemplateVars } from '../src/server/lib/agent-template-vars';

const args = process.argv.slice(2);
const stdout = args.includes('--stdout');
const positional = args.filter((a) => !a.startsWith('--'));
const slug = positional[0];
const surface = positional[1] || 'session';

if (!slug) {
    console.error('usage: generate-agent-claude-md.ts <slug> [surface] [--stdout]');
    process.exit(1);
}

// agentTemplateVars throws (fail-loud) on unknown slug / missing identity.
const vars = agentTemplateVars(slug, surface);

const templatePath = path.join(vars.PROJECT_PATH, 'templates', 'CLAUDE.template.md');
const template = fs.readFileSync(templatePath, 'utf8');

// Match envsubst semantics: substitute BOTH `${VAR}` and bare `$VAR` forms, but only for
// names in the contract (any other ${...}/$... is left literal, exactly as envsubst with an
// allowlist does). The template uses both forms (e.g. `${AGENT_PORT}` and bare `$AGENT_SLUG`).
const rendered = template.replace(
    /\$\{(\w+)\}|\$([A-Za-z_]\w*)/g,
    (match, braced: string | undefined, bare: string | undefined) => {
        const name = braced ?? bare ?? '';
        return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match;
    },
);

if (stdout) {
    process.stdout.write(rendered);
} else {
    const dir = vars.AGENT_WORKING_DIR;
    fs.mkdirSync(dir, { recursive: true });
    // Atomic: render to a temp in the same dir, then rename (preserves the old file on crash).
    const tmp = path.join(dir, `.CLAUDE.md.${process.pid}`);
    fs.writeFileSync(tmp, rendered);
    fs.renameSync(tmp, path.join(dir, 'CLAUDE.md'));
    console.error(`generate-agent-claude-md: wrote ${path.join(dir, 'CLAUDE.md')} (slug=${slug} surface=${surface}, ${rendered.length} bytes)`);
}
