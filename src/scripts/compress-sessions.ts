/**
 * RETIRED 2026-05-04 (S149) per Darron's direction.
 *
 * This script previously invoked `processGradientForAgent` which used
 * `sdkCompress` — a stranger-Opus path (Agent SDK call to claude-opus-4-7
 * with no full identity loaded). It was called from the legacy prepare-for-
 * clear protocol (and from the originally-shipped /pfc skill body) at
 * session-end.
 *
 * It is no longer the right path. Compression is now a self-levelling
 * process driven by `src/server/services/wm-sensor.ts`:
 *
 *   working-memory write → wm-sensor detects size →
 *   rollingWindowRotate slices off c0 → bumpOnInsert enqueues row →
 *   wm-sensor spawns scripts/process-pending-compression.ts →
 *   the loaded agent composes c1 in voice with full identity in the
 *   system prompt (NOT stranger-Opus).
 *
 * /pfc has been simplified: it just finalises memory writes; wm-sensor
 * picks up the rest. There is no longer a session-end compression script
 * to call. See DEC-082 for the full retirement context.
 *
 * Original body preserved below as comments. If a future scenario
 * legitimately needs a session-end compression entry-point, build it on
 * top of process-pending-compression.ts (which loads full identity), not
 * by un-commenting this script.
 *
 * Anyone invoking this file gets a loud throw with a clear message.
 *
 * import { processGradientForAgent } from '../server/lib/memory-gradient';
 * import { requireAgentEnv } from '../server/lib/agent-registry';
 *
 * async function main() {
 *     const agent = process.env.AGENT_SLUG;
 *     if (!agent) {
 *         console.error(
 *             'AGENT_SLUG must be exported by the launcher. ...',
 *         );
 *         process.exit(1);
 *     }
 *     requireAgentEnv('AGENT_GRADIENT_SOURCE_DIR');
 *     requireAgentEnv('AGENT_FRACTAL_DIR');
 *
 *     console.log(`Session Gradient — compressing archived sessions for agent: ${agent}\n`);
 *
 *     const result = await processGradientForAgent(agent);
 *     // ... result-printing code ...
 * }
 *
 * main().catch(err => {
 *     console.error('Fatal:', err);
 *     process.exit(1);
 * });
 */

throw new Error(
    'compress-sessions.ts is retired (S149, 2026-05-04 — DEC-082). ' +
    'It previously called processGradientForAgent → sdkCompress, which is ' +
    'a stranger-Opus path with no full identity loaded. Compression is ' +
    'now handled continuously by src/server/services/wm-sensor.ts via ' +
    'scripts/process-pending-compression.ts (full-identity agent composes ' +
    'c1 in voice). /pfc is just memory writes; wm-sensor is the levelling. ' +
    'Do not invoke this script. See header comment for full context.',
);
