/**
 * src/server/lib/token-counter.ts
 *
 * Single source of truth for token counting across the gradient engine.
 *
 * Phase A of the token-only refactor (2026-04-30, S145 cont.). Per Darron's
 * S145 ruling: the engine must operate in tokens, never chars or bytes, and
 * the conversation must always speak in tokens. This helper is THE place
 * where text → token count happens.
 *
 * Implementation: chars ÷ 4 approximation, ceiling. Cheap, offline, no
 * dependencies. Heuristic accuracy ±10-20% depending on content type
 * (denser for code/numbers, looser for prose). Good enough for slicer
 * thresholds and 1/3-length compression targets where structural decisions
 * matter more than exact billing-grade precision.
 *
 * Upgrade path: when billing-grade precision becomes important (e.g., for
 * cost attribution to specific compressions), swap the implementation here
 * for a real tokenizer (`gpt-tokenizer` offline, or Anthropic's
 * `client.messages.countTokens(...)` API for billing-grade exact counts
 * against the actual tokenizer Claude uses). All consumers call
 * `countTokens(text)` — they don't change.
 *
 * Why chars and not bytes: real tokenizers count by chars (or sub-char
 * BPE pieces); raw bytes penalise multi-byte UTF-8 characters that humans
 * see as "one character" (em-dashes, smart quotes, accented letters). A
 * "character" is closer to a "token" in spirit than a "byte" is.
 */

/**
 * Count tokens in a string, Buffer, or null/undefined.
 *
 * @param text - the content to count. Strings and Buffers both supported;
 *   Buffer is converted to UTF-8 string first. null/undefined returns 0.
 * @returns ceiling of text length divided by 4 (chars/token approximation).
 */
export function countTokens(text: string | Buffer | null | undefined): number {
    if (text === null || text === undefined) return 0;
    const s = Buffer.isBuffer(text) ? text.toString('utf8') : String(text);
    if (s.length === 0) return 0;
    return Math.ceil(s.length / 4);
}

/**
 * Default ceiling for the working-memory rolling window: 50,000 tokens.
 * Composed of headTokens (retained, ~25K) + tailTokens (archived as c0, ~25K).
 * Per Darron's S111 design and his S145 mechanics restatement.
 *
 * Exposed as a constant so callers that don't read config can use the
 * design-canonical value without copying the magic number.
 */
export const DEFAULT_ROLLING_WINDOW_HEAD_TOKENS = 25_000;
export const DEFAULT_ROLLING_WINDOW_TAIL_TOKENS = 25_000;
