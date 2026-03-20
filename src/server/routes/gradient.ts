/**
 * Traversable Memory Gradient API
 * Provenance chain traversal, feeling tags, and annotations
 */

import { Router, Request, Response } from 'express';
import { gradientStmts, feelingTagStmts, gradientAnnotationStmts } from '../db';

const router = Router();

// ── Static routes FIRST (before parameterised) ─────────────────

/** Random entry for meditation selection */
router.get('/random', (_req: Request, res: Response) => {
    const entry = gradientStmts.getRandom.get();
    if (!entry) {
        return res.status(404).json({ error: 'No gradient entries yet' });
    }

    const feelingTags = feelingTagStmts.getByEntry.all(entry.id);
    const annotations = gradientAnnotationStmts.getByEntry.all(entry.id);

    res.json({ entry, feelingTags, annotations });
});

/** All entries for a session label, ordered by level */
router.get('/session/:label', (req: Request, res: Response) => {
    const entries = gradientStmts.getBySession.all(req.params.label);

    const enriched = entries.map((e: any) => ({
        ...e,
        feelingTags: feelingTagStmts.getByEntry.all(e.id),
    }));

    res.json({ entries: enriched });
});

// ── Agent-scoped routes ─────────────────────────────────────────

/** All unit vectors for an agent */
router.get('/:agent/uvs', (req: Request, res: Response) => {
    const { agent } = req.params;
    if (agent !== 'jim' && agent !== 'leo') {
        return res.status(400).json({ error: 'Agent must be jim or leo' });
    }

    const uvs = gradientStmts.getUVs.all(agent);

    const enriched = uvs.map((e: any) => ({
        ...e,
        feelingTags: feelingTagStmts.getByEntry.all(e.id),
    }));

    res.json({ uvs: enriched });
});

/** All entries at a level for an agent */
router.get('/:agent/level/:level', (req: Request, res: Response) => {
    const { agent, level } = req.params;
    if (agent !== 'jim' && agent !== 'leo') {
        return res.status(400).json({ error: 'Agent must be jim or leo' });
    }

    const entries = gradientStmts.getByAgentLevel.all(agent, level);
    res.json({ entries });
});

// ── Entry-specific routes (parameterised — LAST) ────────────────

/** Single entry with feeling tags and annotations */
router.get('/:entryId', (req: Request, res: Response) => {
    const entry = gradientStmts.get.get(req.params.entryId);
    if (!entry) {
        return res.status(404).json({ error: 'Gradient entry not found' });
    }

    const feelingTags = feelingTagStmts.getByEntry.all(entry.id);
    const annotations = gradientAnnotationStmts.getByEntry.all(entry.id);

    res.json({ entry, feelingTags, annotations });
});

/** Full provenance chain from entry down to C0 */
router.get('/:entryId/chain', (req: Request, res: Response) => {
    const entry = gradientStmts.get.get(req.params.entryId);
    if (!entry) {
        return res.status(404).json({ error: 'Gradient entry not found' });
    }

    const chain = gradientStmts.getChain.all(req.params.entryId);

    const enriched = chain.map((e: any) => ({
        ...e,
        feelingTags: feelingTagStmts.getByEntry.all(e.id),
    }));

    res.json({ chain: enriched });
});

/** All feeling tags for an entry (chronological) */
router.get('/:entryId/feeling-tags', (req: Request, res: Response) => {
    const tags = feelingTagStmts.getByEntry.all(req.params.entryId);
    res.json({ feelingTags: tags });
});

/** All annotations for an entry */
router.get('/:entryId/annotations', (req: Request, res: Response) => {
    const annotations = gradientAnnotationStmts.getByEntry.all(req.params.entryId);
    res.json({ annotations });
});

/** Record a new stacked feeling tag */
router.post('/:entryId/feeling-tag', (req: Request, res: Response) => {
    const entry = gradientStmts.get.get(req.params.entryId);
    if (!entry) {
        return res.status(404).json({ error: 'Gradient entry not found' });
    }

    const { author, tag_type, content, change_reason } = req.body;
    if (!author || !tag_type || !content) {
        return res.status(400).json({ error: 'author, tag_type, and content are required' });
    }

    feelingTagStmts.insert.run(
        req.params.entryId,
        author,
        tag_type,
        content,
        change_reason || null,
        new Date().toISOString()
    );

    res.json({ success: true });
});

/** Record an annotation with context */
router.post('/:entryId/annotate', (req: Request, res: Response) => {
    const entry = gradientStmts.get.get(req.params.entryId);
    if (!entry) {
        return res.status(404).json({ error: 'Gradient entry not found' });
    }

    const { author, content, context } = req.body;
    if (!author || !content) {
        return res.status(400).json({ error: 'author and content are required' });
    }

    gradientAnnotationStmts.insert.run(
        req.params.entryId,
        author,
        content,
        context || null,
        new Date().toISOString()
    );

    res.json({ success: true });
});

export default router;
