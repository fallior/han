/**
 * Tailscale API Routes
 * Programmatic management of the tailnet — devices, invitations, ACLs, auth keys.
 * Protected by authMiddleware (applied to all /api/* routes in server.ts).
 */

import { Router, Request, Response } from 'express';
import {
    listDevices, getDevice, deleteDevice, authoriseDevice,
    inviteUser, listUserInvites,
    shareDevice,
    createAuthKey, listAuthKeys,
    getACLs, updateACLs,
    getDNSNameservers, getDNSPreferences,
} from '../services/tailscale';

const router = Router();

// ── Devices ─────────────────────────────────────────────────

router.get('/devices', async (_req: Request, res: Response) => {
    try {
        const data = await listDevices();
        res.json({ success: true, ...data });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/devices/:id', async (req: Request, res: Response) => {
    try {
        const device = await getDevice(req.params.id);
        res.json({ success: true, device });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/devices/:id', async (req: Request, res: Response) => {
    try {
        await deleteDevice(req.params.id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/devices/:id/authorise', async (req: Request, res: Response) => {
    try {
        await authoriseDevice(req.params.id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Device sharing ──────────────────────────────────────────

router.post('/devices/:id/share', async (req: Request, res: Response) => {
    try {
        const invite = await shareDevice(req.params.id);
        res.json({ success: true, invite });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── User invitations ────────────────────────────────────────

router.get('/invites', async (_req: Request, res: Response) => {
    try {
        const data = await listUserInvites();
        res.json({ success: true, ...data });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/invite', async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'email is required' });
        }
        const invite = await inviteUser(email);
        res.json({ success: true, invite });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Auth keys ───────────────────────────────────────────────

router.get('/keys', async (_req: Request, res: Response) => {
    try {
        const data = await listAuthKeys();
        res.json({ success: true, ...data });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/keys', async (req: Request, res: Response) => {
    try {
        const key = await createAuthKey(req.body);
        res.json({ success: true, key });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── ACLs ────────────────────────────────────────────────────

router.get('/acls', async (_req: Request, res: Response) => {
    try {
        const acl = await getACLs();
        res.json({ success: true, acl });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/acls', async (req: Request, res: Response) => {
    try {
        const result = await updateACLs(req.body);
        res.json({ success: true, result });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── DNS ─────────────────────────────────────────────────────

router.get('/dns', async (_req: Request, res: Response) => {
    try {
        const [nameservers, preferences] = await Promise.all([
            getDNSNameservers(),
            getDNSPreferences(),
        ]);
        res.json({ success: true, nameservers, preferences });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
