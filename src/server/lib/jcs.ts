/**
 * JCS (JSON Canonicalisation Scheme) — RFC 8785
 *
 * Hand-rolled implementation per Phase A.5 (DEC-083). Used to canonicalise
 * the identity-manifest JSON before signing/verification so re-serialisation
 * differences (key order, whitespace, number formatting) cannot produce
 * silent verification failures.
 *
 * **Why hand-rolled rather than a dep**: this primitive sits on the security
 * critical path. Zero supply-chain surface for a security-critical primitive
 * is the right shape (Jim's audit on threat #11 territory). The implementation
 * is small and auditable.
 *
 * Implements the subset of RFC 8785 we use for the identity manifest:
 *   - Object keys sorted by UTF-16 code-unit (per ECMAScript Array.prototype.sort default)
 *   - No whitespace between tokens
 *   - String escaping per ECMA-404
 *   - Numbers per ECMA-262 7.1.12.1 (we only emit integers in the manifest;
 *     floats would need ECMAScript Number.prototype.toString rules)
 *
 * What we do NOT support: Date objects (encode as ISO strings upstream),
 * undefined values (skip — match JSON.stringify), BigInt (manifest never holds them),
 * non-finite numbers (manifest never holds them).
 *
 * **Invariant**: for any input that JSON.parse can round-trip, canonicalise
 * produces a byte-stable representation that any compliant JCS implementation
 * would also produce. Verification on a different machine, with a different
 * Node version, with a different file-system reader, will reach byte-equality.
 */

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export function canonicalise(value: JsonValue): string {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error(`JCS: non-finite number rejected (${value})`);
        }
        // Manifest emits only integers and ISO-string fields; integers serialise
        // identically across implementations via Number.prototype.toString.
        return String(value);
    }
    if (typeof value === 'string') return encodeString(value);
    if (Array.isArray(value)) {
        return '[' + value.map(canonicalise).join(',') + ']';
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value).sort();
        const parts: string[] = [];
        for (const key of keys) {
            const v = (value as { [k: string]: JsonValue })[key];
            if (v === undefined) continue;
            parts.push(encodeString(key) + ':' + canonicalise(v));
        }
        return '{' + parts.join(',') + '}';
    }
    throw new Error(`JCS: unsupported value type (${typeof value})`);
}

function encodeString(s: string): string {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        switch (code) {
            case 0x22: out += '\\"'; break;
            case 0x5c: out += '\\\\'; break;
            case 0x08: out += '\\b'; break;
            case 0x0c: out += '\\f'; break;
            case 0x0a: out += '\\n'; break;
            case 0x0d: out += '\\r'; break;
            case 0x09: out += '\\t'; break;
            default:
                if (code < 0x20) {
                    out += '\\u' + code.toString(16).padStart(4, '0');
                } else {
                    out += s[i];
                }
        }
    }
    out += '"';
    return out;
}
