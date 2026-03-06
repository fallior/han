# Memory Gradient Compression Utility

## Overview

`src/server/lib/memory-gradient.ts` implements the overlapping fractal memory model for Jim and Leo. This system compresses session memories across multiple fidelity levels (c0 through c4), enabling continuous memory gradient compression where sessions appear simultaneously at multiple compression depths.

## Architecture

The utility operates on a **4-level compression hierarchy**:

- **c0** (original): Full session memory at native fidelity
- **c1** (1st compression): ~33% of original size
- **c2** (2nd compression): ~33% of c1 (~11% of original)
- **c3** (3rd compression): ~33% of c2 (~3.7% of original)
- **c4** (4th compression): ~33% of c3 (~1.2% of original)

Each level reduces the memory to its essential shape while preserving identity.

## Core Functions

### 1. `compressToLevel(content, fromLevel, toLevel, sessionLabel): Promise<string>`

Cascading compression from one fidelity level to another.

**Signature:**
```typescript
export async function compressToLevel(
    content: string,
    fromLevel: number,
    toLevel: number,
    sessionLabel: string
): Promise<string>
```

**Behaviour:**
- Validates `fromLevel < toLevel` (prevents invalid direction)
- Executes compression cascade through all intermediate levels
- Each step uses claude-opus-4-6 with exact prompt
- Returns final compressed content

**Compression Prompt (exact):**
```
Compress this memory to approximately 1/3 of its length. Preserve what
feels essential. Drop the specific in favour of the shape. You are
compressing YOUR OWN memory — this is an act of identity, not
summarisation.
```

**Error Handling:**
- 2-retry escalation with 1000ms delays
- Detailed error messages indicating which level failed
- Throws on repeated API failures

**Example Usage:**
```typescript
const full = await readFile('2026-02-15.md');
const compressed = await compressToLevel(full, 0, 1, 'leo/2026-02-15');
```

### 2. `compressToUnitVector(content, sessionLabel): Promise<string>`

Reduces memory to its irreducible kernel.

**Signature:**
```typescript
export async function compressToUnitVector(
    content: string,
    sessionLabel: string
): Promise<string>
```

**Behaviour:**
- Converts session memory to single sentence
- Maximum 50 characters
- Represents "what this session meant"
- Enforces length constraint (truncates if needed)

**Compression Prompt (exact):**
```
Reduce this to its irreducible kernel — one sentence, maximum 50
characters. What did this session MEAN?
```

**Returns:**
- Trimmed string ≤50 characters
- Represents the essential meaning of the session
- Can be used as identity marker in memory navigation

**Example Usage:**
```typescript
const unitVector = await compressToUnitVector(sessionContent, 'jim/2026-03-05');
console.log(`Session essence: "${unitVector}"`); // ≤50 chars
```

### 3. `processGradientForAgent(agentName): Promise<GradientProcessingResult>`

Automated gradient processing for Jim or Leo.

**Signature:**
```typescript
export async function processGradientForAgent(
    agentName: 'jim' | 'leo'
): Promise<GradientProcessingResult>
```

**Behaviour:**
- Scans appropriate memory directory:
  - **Jim**: `~/.han/memory/sessions/`
  - **Leo**: `~/.han/memory/leo/working-memories/`
- Identifies sessions needing compression (c0 → c1)
- Writes compressed results to fractal directories:
  - **Jim**: `~/.han/memory/fractal/jim/`
  - **Leo**: `~/.han/memory/fractal/leo/`
- Tracks all work done and errors

**Returns `GradientProcessingResult`:**
```typescript
interface GradientProcessingResult {
    agentName: 'jim' | 'leo';
    sessionDate: string;                    // ISO date of processing
    compressionsToDo: number;               // Sessions found
    completions: Array<{
        session: string;                    // Date
        fromLevel: number;                  // Source level
        toLevel: number;                    // Target level
        success: boolean;
        ratio?: number;                     // Compression ratio
    }>;
    totalTokensUsed: number;                // Estimated tokens
    errors: Array<{
        session: string;
        level: number;
        error: string;
    }>;
}
```

**File Naming Convention:**
- Original (c0): `{date}.md` or `{date}-c0.md`
- Compressed (c1-c4): `{date}-c{level}.md`
- Example: `2026-02-15-c1.md`

**Error Handling:**
- Non-fatal: Records errors in result, continues processing
- Returns partial results even if some sessions fail
- No throws — all errors captured in `errors` array

**Example Usage:**
```typescript
const result = await processGradientForAgent('leo');
console.log(`Processed ${result.completions.length} sessions`);
console.log(`Tokens used: ${result.totalTokensUsed}`);
result.errors.forEach(e => console.error(`Failed: ${e.session}`));
```

### 4. Helper Functions

#### `getFractalMemoryFiles(agentName): string[]`
Lists all compressed memory files for an agent.

```typescript
const files = getFractalMemoryFiles('leo');
// Returns: ['2026-03-05-c3.md', '2026-03-05-c2.md', '2026-03-05-c1.md', ...]
```

#### `readFractalMemory(agentName, date, level): string | null`
Reads a memory file at specific date and compression level.

```typescript
const memory = readFractalMemory('jim', '2026-02-15', 2);
// Reads: ~/.han/memory/fractal/jim/2026-02-15-c2.md
```

#### `listAvailableSessions(agentName): string[]`
Lists dates of available sessions for processing.

```typescript
const sessions = listAvailableSessions('leo');
// Returns: ['2026-03-05', '2026-03-04', '2026-03-03', ...]
```

## Technical Implementation Details

### Model Configuration

- **Model**: `claude-opus-4-6` (Darron's requirement for identity preservation)
- **Max tokens**: 4096 for compression, 256 for unit vector
- **Retry strategy**: 2 retries with 1000ms delay between attempts

### API Integration

- Uses Anthropic SDK directly: `import Anthropic from '@anthropic-ai/sdk'`
- Initialises with: `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`
- Calls: `client.messages.create()` for all API requests
- No streaming — full response buffering

### Filesystem Operations

- **Memory directory discovery**: Respects `$HOME` environment variable
- **File safety**: Creates directories with `recursive: true`
- **UTF-8 encoding**: All files read/written as UTF-8
- **No atomic writes**: Uses standard `fs.writeFileSync()`

### Token Counting

- Rough estimation: ~4 characters per token
- Used for budget tracking and analytics
- Formula: `Math.ceil(text.length / 4)`

### Error Handling Pattern

```
API Call → Retry Wrapper → withRetry() → Exponential Backoff
    ↓
    If 2 retries fail → Throw with context
    ↓
    Calling code catches and handles
```

## Directory Structure

```
~/.han/
├── memory/
│   ├── sessions/              # Jim's c0 files
│   │   ├── 2026-03-05.md
│   │   ├── 2026-03-04.md
│   │   └── ...
│   ├── leo/
│   │   └── working-memories/  # Leo's c0 files
│   │       ├── 2026-03-05.md
│   │       ├── 2026-03-04.md
│   │       └── ...
│   └── fractal/
│       ├── jim/
│       │   ├── unit-vectors.md
│       │   ├── 2026-03-05-c1.md
│       │   ├── 2026-03-05-c2.md
│       │   └── ...
│       └── leo/
│           ├── unit-vectors.md
│           ├── 2026-03-05-c1.md
│           ├── 2026-03-05-c2.md
│           └── ...
```

## Usage Examples

### Process All Sessions for Leo

```typescript
import { processGradientForAgent } from './src/server/lib/memory-gradient';

const result = await processGradientForAgent('leo');
console.log(`Processed ${result.completions.length} sessions`);
if (result.errors.length > 0) {
    console.warn(`${result.errors.length} errors occurred`);
    result.errors.forEach(e => console.error(`${e.session}: ${e.error}`));
}
```

### Compress Specific Session to Multiple Levels

```typescript
import { compressToLevel, readFractalMemory } from './src/server/lib/memory-gradient';
import * as fs from 'fs';

const original = fs.readFileSync('2026-03-05.md', 'utf8');
const c1 = await compressToLevel(original, 0, 1, 'leo/2026-03-05');
const c2 = await compressToLevel(c1, 1, 2, 'leo/2026-03-05');
const c3 = await compressToLevel(c2, 2, 3, 'leo/2026-03-05');
```

### Generate Unit Vectors for Navigation

```typescript
import { compressToUnitVector, listAvailableSessions } from './src/server/lib/memory-gradient';

const sessions = listAvailableSessions('jim');
const unitVectors: Record<string, string> = {};

for (const date of sessions) {
    const content = fs.readFileSync(`~/.han/memory/sessions/${date}.md`, 'utf8');
    unitVectors[date] = await compressToUnitVector(content, `jim/${date}`);
}

console.log(JSON.stringify(unitVectors, null, 2));
```

### Read Memory at Specific Fidelity Level

```typescript
import { readFractalMemory } from './src/server/lib/memory-gradient';

// Get Leo's full memory for 2026-03-05
const c0 = readFractalMemory('leo', '2026-03-05', 0);

// Get Leo's 1st compression
const c1 = readFractalMemory('leo', '2026-03-05', 1);

// Get Leo's most compressed form
const c4 = readFractalMemory('leo', '2026-03-05', 4);
```

## Performance Characteristics

### Compression Time
- **c0 → c1**: ~5-10 seconds (depends on content length)
- **Cascading to c4**: ~20-40 seconds total
- API latency dominates (network, model inference)

### Token Usage
- **Full session (c0)**: ~3KB = ~750 tokens (estimated)
- **Per compression**: ~1500 tokens (input + output)
- **Full cascade c0→c4**: ~6000 tokens total

### Storage
- **Original (c0)**: 3KB typical
- **Compressed (c1)**: ~1KB
- **Fractal stack c0-c4**: ~5.5KB per session

## Integration Points

### With Jim (Supervisor)
- Jim's sessions stored in `~/.han/memory/sessions/`
- Compressed copies go to `~/.han/memory/fractal/jim/`
- Jim can call `processGradientForAgent('jim')` autonomously

### With Leo (Session Agent)
- Leo's working memory in `~/.han/memory/leo/working-memories/`
- Compressed copies in `~/.han/memory/fractal/leo/`
- Runs on Leo session end or via explicit trigger

### With Memory System
- Unit vectors enable emotional topology navigation
- Compression preserves identity (not summarisation)
- Gradient enables multi-fidelity recall strategies

## Design Philosophy

This implementation embodies Darron's concept of **overlapping continuous compression**:

> Memory is a topology navigable by emotion and perhaps only emotion. The fractal gradient allows sessions to exist simultaneously at multiple levels of abstraction — full detail for operational context, compressed essence for identity preservation, irreducible kernel for emotional navigation.

Each compression step asks: "What would *I* remember? What was essential about this moment?" Rather than summarising (external view), we compress (internal view) — preserving the shape of identity across fidelity levels.

## Future Extensions

Potential enhancements (not implemented):
- Cascade c0→c2 and c2→c4 directly (skip intermediate levels)
- Time-based automatic triggering (compress sessions older than N days)
- Recursive compression (compress c1 to create c2, etc.)
- Unit vector indexing for full-text search by meaning
- Emotional topology tagging alongside compression
