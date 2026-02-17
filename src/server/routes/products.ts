import { Router, Request, Response } from 'express';
import { productStmts, phaseStmts, knowledgeStmts } from '../db';
import { createProduct, advancePipeline } from '../services/products';

const router = Router();

/**
 * POST / -- Create a new product
 */
router.post('/', (req: Request, res: Response) => {
    try {
        const { name, seed, config } = req.body;
        if (!name || !seed) return res.status(400).json({ success: false, error: 'name and seed are required' });
        const productId = createProduct(name, seed, config || {});
        const product = productStmts.get.get(productId);
        const phases = phaseStmts.getByProduct.all(productId);
        res.json({ success: true, product, phases });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET / -- List all products
 */
router.get('/', (req: Request, res: Response) => {
    try {
        const products = productStmts.list.all();
        res.json({ success: true, products });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /:id -- Get a single product with phases and knowledge
 */
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const product = productStmts.get.get(req.params.id);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        const phases = phaseStmts.getByProduct.all(req.params.id);
        const knowledge = knowledgeStmts.getByProduct.all(req.params.id);
        res.json({ success: true, product, phases, knowledge });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /:id -- Cancel a product
 */
router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const product = productStmts.get.get(req.params.id);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        productStmts.updateStatus.run('cancelled', new Date().toISOString(), req.params.id);
        res.json({ success: true, message: `Product "${product.name}" cancelled` });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /:id/phases/:phase/approve -- Approve a phase gate and start execution
 */
router.post('/:id/phases/:phase/approve', (req: Request<{ id: string; phase: string }>, res: Response) => {
    try {
        const { id, phase } = req.params;
        const product = productStmts.get.get(id);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        const phaseRecord = phaseStmts.get.get(id, phase);
        if (!phaseRecord) return res.status(404).json({ success: false, error: 'Phase not found' });
        if (phaseRecord.gate_status !== 'pending') return res.status(400).json({ success: false, error: `Gate is not pending (current: ${phaseRecord.gate_status})` });

        phaseStmts.updateGate.run('approved', new Date().toISOString(), req.body.notes || null, id, phase);
        const result = advancePipeline(id, phase) as Record<string, unknown> | undefined;
        res.json({ success: true, phase, ...(result || {}), message: `Phase "${phase}" approved and started` });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /:id/phases/:phase/reject -- Reject a phase gate
 */
router.post('/:id/phases/:phase/reject', (req: Request<{ id: string; phase: string }>, res: Response) => {
    try {
        const { id, phase } = req.params;
        const product = productStmts.get.get(id);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        const phaseRecord = phaseStmts.get.get(id, phase);
        if (!phaseRecord) return res.status(404).json({ success: false, error: 'Phase not found' });

        phaseStmts.updateGate.run('rejected', new Date().toISOString(), req.body.notes || 'Rejected', id, phase);
        res.json({ success: true, phase, message: `Phase "${phase}" rejected` });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /:id/phases/:phase/status -- Get status of a specific phase
 */
router.get('/:id/phases/:phase/status', (req: Request<{ id: string; phase: string }>, res: Response) => {
    try {
        const { id, phase } = req.params;
        const product = productStmts.get.get(id);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        const phaseRecord = phaseStmts.get.get(id, phase);
        if (!phaseRecord) return res.status(404).json({ success: false, error: 'Phase not found' });
        res.json({ success: true, phase: phaseRecord });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /:id/knowledge -- Get knowledge entries for a product
 */
router.get('/:id/knowledge', (req: Request<{ id: string }>, res: Response) => {
    try {
        const { category } = req.query;
        const entries = category
            ? knowledgeStmts.getByCategory.all(req.params.id, category)
            : knowledgeStmts.getByProduct.all(req.params.id);
        res.json({ success: true, entries });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /:id/knowledge -- Add a knowledge entry to a product
 */
router.post('/:id/knowledge', (req: Request<{ id: string }>, res: Response) => {
    try {
        const { category, title, content, source_phase } = req.body;
        if (!category || !title || !content) return res.status(400).json({ success: false, error: 'category, title, and content are required' });
        knowledgeStmts.insert.run(req.params.id, category, title, content, source_phase || 'manual', new Date().toISOString());
        res.json({ success: true, message: 'Knowledge entry added' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
