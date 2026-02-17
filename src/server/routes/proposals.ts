import { Router, Request, Response } from 'express';
import { proposalStmts } from '../db';
import { writeLearning, writeDecision } from '../services/proposals';
import { broadcastProposalUpdate } from '../ws';

const router = Router();

/**
 * GET /api/proposals -- List knowledge proposals
 */
router.get('/api/proposals', (req: Request, res: Response) => {
    try {
        const proposals = req.query.status
            ? proposalStmts.listByStatus.all(req.query.status as string)
            : proposalStmts.list.all();
        const enriched = proposals.map((p: any) => ({
            ...p,
            parsed_data: JSON.parse(p.parsed_data)
        }));
        res.json({ success: true, proposals: enriched });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/proposals/:id/approve -- Approve and write to official files
 */
router.post('/api/proposals/:id/approve', (req: Request<{ id: string }>, res: Response) => {
    try {
        const proposal = proposalStmts.get.get(req.params.id);
        if (!proposal) return res.status(404).json({ success: false, error: 'Proposal not found' });
        if (proposal.status !== 'pending') {
            return res.status(400).json({ success: false, error: `Proposal already ${proposal.status}` });
        }

        const data = JSON.parse(proposal.parsed_data);
        let writtenTo = '';

        if (proposal.type === 'learning') {
            writtenTo = writeLearning(data, proposal.project_path);
        } else if (proposal.type === 'decision') {
            writtenTo = writeDecision(data, proposal.project_path);
        }

        proposalStmts.updateStatus.run('approved', new Date().toISOString(), writtenTo, proposal.id);
        broadcastProposalUpdate();
        res.json({ success: true, written_to: writtenTo });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/proposals/:id/reject -- Reject a proposal
 */
router.post('/api/proposals/:id/reject', (req: Request<{ id: string }>, res: Response) => {
    try {
        const proposal = proposalStmts.get.get(req.params.id);
        if (!proposal) return res.status(404).json({ success: false, error: 'Proposal not found' });
        if (proposal.status !== 'pending') {
            return res.status(400).json({ success: false, error: `Proposal already ${proposal.status}` });
        }

        proposalStmts.updateStatus.run('rejected', new Date().toISOString(), null, proposal.id);
        broadcastProposalUpdate();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
