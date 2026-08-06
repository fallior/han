/**
 * verify-post-upgrade.ts — the migration acceptance harness (Mint 22 runbook, Stage 0d/4).
 *
 * READ-ONLY. Captures the box's vital signs as (name, value) facts and compares them
 * against a saved baseline, so the post-hop question is never "does it feel right?"
 * but "which lines changed, and is each change the one the runbook predicted?"
 * (The S203 law: completeness/health pinned to objective landmarks, never a feeling.)
 *
 * Modes:
 *   baseline — capture current facts to ~/.han/health/verify-post-upgrade-baseline.json
 *              (run on the KNOWN-GOOD box before the hop — Stage 0d)
 *   check    — capture fresh facts, print the table, diff against the baseline (default)
 *
 * Exit codes: 0 = ran (diffs are for reading, not failing — the human judges);
 *             1 = a vital is CATASTROPHIC (gradient.db unreadable).
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const BASELINE = path.join(os.homedir(), '.han', 'health', 'verify-post-upgrade-baseline.json');

function sh(cmd: string): string {
    try { return execSync(cmd, { encoding: 'utf-8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { return ''; }
}

function collect(): Record<string, string> {
    const f: Record<string, string> = {};
    f['kernel'] = sh('uname -r');
    f['distro'] = sh('grep -oP "DISTRIB_DESCRIPTION=\\"\\K[^\\"]+" /etc/lsb-release');
    f['python3'] = sh('python3 --version');
    // Display stack (Stage 0a/4: the DKMS inverted risk)
    f['nvidia.driver'] = sh("nvidia-smi --query-gpu=driver_version --format=csv,noheader") || 'ABSENT';
    f['nvidia.gpu'] = sh("nvidia-smi --query-gpu=name --format=csv,noheader") || 'ABSENT';
    f['dkms'] = sh('dkms status').split('\n').map((l) => l.trim()).filter(Boolean).sort().join(' | ') || 'none';
    // Stage-5 gates (B60): expected ABSENT/old on jammy — the diff shows them arriving
    f['xe.firmware'] = fs.existsSync('/lib/firmware/xe') ? `present (${fs.readdirSync('/lib/firmware/xe').length} blobs)` : 'ABSENT';
    f['mesa'] = sh("glxinfo 2>/dev/null | grep -m1 'OpenGL version'") || 'unavailable (glxinfo absent or headless)';
    // The garden's pulse
    f['garden.services'] = sh("systemctl --user list-units --state=active --plain --no-legend 'jemma.service' 'wm-sensor.service' '*-heartbeat.service' 'human-responder@*.service' | awk '{print $1}' | sort | tr '\\n' ' '").trim() || 'NONE ACTIVE';
    f['server.3847'] = sh('curl -sk -o /dev/null -w "%{http_code}" --max-time 8 https://localhost:3847/api/ecosystem') || 'no-answer';
    f['server.3848'] = sh('curl -sk -o /dev/null -w "%{http_code}" --max-time 8 https://localhost:3848/api/ecosystem') || 'no-answer';
    f['tmux.sessions'] = sh('tmux ls 2>/dev/null | wc -l');
    f['tmux.keeper'] = sh('tmux ls 2>/dev/null | grep -c "^__han_keeper"') === '1' ? 'present' : 'MISSING';
    // Memory vitals (catastrophic if unreadable)
    const counts = sh(`sqlite3 -readonly ${os.homedir()}/.han/gradient.db "SELECT (SELECT COUNT(*) FROM gradient_entries)||'/'||(SELECT COUNT(*) FROM conversations)||'/'||(SELECT COUNT(*) FROM conversation_messages);"`);
    f['gradient.counts'] = counts || 'UNREADABLE';
    f['gradient.integrity'] = sh(`sqlite3 -readonly ${os.homedir()}/.han/gradient.db "PRAGMA integrity_check;"`) || 'UNREADABLE';
    // Mounts + space
    f['mount.raid1'] = sh('findmnt -no SOURCE /mnt/raid1') || 'NOT MOUNTED';
    f['mount.scratch'] = sh('findmnt -no SOURCE /mnt/scratch') || 'NOT MOUNTED';
    f['root.free'] = sh('df -h --output=avail / | tail -1').trim();
    // Tenshi's contributing-sensor-set fingerprint (the thermal guard's world)
    f['sensors.fingerprint'] = sh('for d in /sys/class/hwmon/hwmon*; do cat $d/name 2>/dev/null; done | sort | tr "\\n" ","');
    f['sensors.fan_tachs'] = sh('ls /sys/class/hwmon/hwmon*/fan*_input 2>/dev/null | wc -l');
    return f;
}

const mode = process.argv[2] ?? 'check';
const facts = collect();

if (mode === 'baseline') {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    // Jim's fold (2026-08-06): a tired 2 AM hand typing `baseline` instead of `check`
    // post-hop must not silently destroy the known-good reference — archive first
    // (DEC-069's smallest possible application).
    if (fs.existsSync(BASELINE)) {
        fs.renameSync(BASELINE, `${BASELINE}.${Date.now()}.bak`);
    }
    fs.writeFileSync(BASELINE, JSON.stringify({ capturedAt: new Date().toISOString(), facts }, null, 1));
    console.log(`# Baseline captured → ${BASELINE}`);
    for (const [k, v] of Object.entries(facts)) console.log(`  ${k.padEnd(22)} ${v}`);
    process.exit(facts['gradient.integrity'] === 'ok' ? 0 : 1);
}

let base: { capturedAt: string; facts: Record<string, string> } | null = null;
try { base = JSON.parse(fs.readFileSync(BASELINE, 'utf-8')); } catch { /* no baseline yet */ }

console.log(`# verify-post-upgrade — ${new Date().toISOString()}`);
console.log(base ? `# baseline: ${base.capturedAt}` : '# NO BASELINE (run "baseline" on the known-good box first — Stage 0d)');
let changed = 0;
for (const [k, v] of Object.entries(facts)) {
    const b = base?.facts[k];
    const mark = base === null ? ' ' : (b === v ? '=' : '≠');
    if (mark === '≠') changed++;
    console.log(`${mark} ${k.padEnd(22)} ${v}${mark === '≠' ? `\n    (baseline: ${b})` : ''}`);
}
if (base) console.log(`\n# ${changed} line(s) differ from baseline — judge each against the runbook's predictions.`);
process.exit(facts['gradient.integrity'] === 'ok' ? 0 : 1);
