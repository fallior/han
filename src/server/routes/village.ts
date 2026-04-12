/**
 * The Village — Persona Registry API
 *
 * CRUD for personas + induction endpoint.
 * Created: S120 (2026-04-12) by Leo + Darron
 */

import { Router, Request, Response } from 'express';
import {
    getPersonas,
    getAllPersonas,
    getPersona,
    getAgentPersonas,
    getWorkshopTabs,
    getMentionPatterns,
    inductResident,
    PersonaSeed,
} from '../services/village.js';
import { personaStmts } from '../db.js';

const router = Router();

/** List all active personas */
router.get('/personas', (_req: Request, res: Response) => {
    const includeInactive = _req.query.include_inactive === 'true';
    const personas = includeInactive ? getAllPersonas() : getPersonas();

    // Parse JSON fields for convenience
    const enriched = personas.map(p => ({
        ...p,
        workshop_tabs_parsed: getWorkshopTabs(p),
        mention_patterns_parsed: getMentionPatterns(p),
    }));

    res.json({ personas: enriched });
});

/** List only agent personas (for Jemma routing) */
router.get('/personas/agents', (_req: Request, res: Response) => {
    const agents = getAgentPersonas();
    res.json({ agents });
});

/** Get a single persona by name */
router.get('/personas/:name', (req: Request, res: Response) => {
    const persona = getPersona(req.params.name);
    if (!persona) {
        return res.status(404).json({ error: `Persona '${req.params.name}' not found` });
    }

    res.json({
        persona: {
            ...persona,
            workshop_tabs_parsed: getWorkshopTabs(persona),
            mention_patterns_parsed: getMentionPatterns(persona),
        },
    });
});

/** Induct a new resident */
router.post('/induct', async (req: Request, res: Response) => {
    const seed: PersonaSeed = {
        name: req.body.name,
        displayName: req.body.displayName || req.body.display_name,
        kind: req.body.kind,
        delivery: req.body.delivery,
        deliveryConfig: req.body.deliveryConfig || req.body.delivery_config,
        identityOverride: req.body.identityOverride || req.body.identity_override,
        personalitySeed: req.body.personalitySeed || req.body.personality_seed,
        roleName: req.body.roleName || req.body.role_name,
        color: req.body.color,
        workshopTabs: req.body.workshopTabs || req.body.workshop_tabs,
        mentionPatterns: req.body.mentionPatterns || req.body.mention_patterns,
        classificationHint: req.body.classificationHint || req.body.classification_hint,
        agentPort: req.body.agentPort || req.body.agent_port,
        instance: req.body.instance,
        isLocal: req.body.isLocal ?? req.body.is_local,
    };

    if (!seed.name || !seed.displayName) {
        return res.status(400).json({ error: 'name and displayName are required' });
    }

    const result = await inductResident(seed);

    if (result.success) {
        res.status(201).json(result);
    } else {
        res.status(400).json(result);
    }
});

/** Update a persona */
router.patch('/personas/:name', (req: Request, res: Response) => {
    const persona = getPersona(req.params.name);
    if (!persona) {
        return res.status(404).json({ error: `Persona '${req.params.name}' not found` });
    }

    const updated = {
        display_name: req.body.display_name ?? persona.display_name,
        kind: req.body.kind ?? persona.kind,
        delivery: req.body.delivery ?? persona.delivery,
        delivery_config: req.body.delivery_config
            ? (typeof req.body.delivery_config === 'string'
                ? req.body.delivery_config
                : JSON.stringify(req.body.delivery_config))
            : persona.delivery_config,
        identity_override: req.body.identity_override ?? persona.identity_override,
        role_name: req.body.role_name ?? persona.role_name,
        memory_path: req.body.memory_path ?? persona.memory_path,
        fractal_path: req.body.fractal_path ?? persona.fractal_path,
        color: req.body.color ?? persona.color,
        workshop_tabs: req.body.workshop_tabs
            ? (typeof req.body.workshop_tabs === 'string'
                ? req.body.workshop_tabs
                : JSON.stringify(req.body.workshop_tabs))
            : persona.workshop_tabs,
        mention_patterns: req.body.mention_patterns
            ? (typeof req.body.mention_patterns === 'string'
                ? req.body.mention_patterns
                : JSON.stringify(req.body.mention_patterns))
            : persona.mention_patterns,
        classification_hint: req.body.classification_hint ?? persona.classification_hint,
        agent_port: req.body.agent_port ?? persona.agent_port,
        session_prefix: req.body.session_prefix ?? persona.session_prefix,
        instance: req.body.instance ?? persona.instance,
        is_local: req.body.is_local ?? persona.is_local,
        active: req.body.active ?? persona.active,
    };

    personaStmts.update.run(
        updated.display_name, updated.kind, updated.delivery, updated.delivery_config,
        updated.identity_override, updated.role_name, updated.memory_path, updated.fractal_path,
        updated.color, updated.workshop_tabs, updated.mention_patterns, updated.classification_hint,
        updated.agent_port, updated.session_prefix, updated.instance, updated.is_local, updated.active,
        req.params.name,
    );

    res.json({ success: true, persona: getPersona(req.params.name) });
});

/** Soft-delete (deactivate) a persona */
router.delete('/personas/:name', (req: Request, res: Response) => {
    const persona = getPersona(req.params.name);
    if (!persona) {
        return res.status(404).json({ error: `Persona '${req.params.name}' not found` });
    }

    personaStmts.deactivate.run(req.params.name);
    res.json({ success: true, message: `${req.params.name} deactivated` });
});

export default router;
