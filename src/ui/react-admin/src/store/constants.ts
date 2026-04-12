/**
 * Workshop tab taxonomy — now built dynamically from the persona registry API.
 * Hardcoded defaults kept as fallbacks for offline resilience.
 */

export interface PersonaTabConfig {
  label: string;
  color: string;
}

export interface NestedTabConfig {
  key: string;
  label: string;
}

// ── Hardcoded fallbacks (used until API data loads) ────────

const fallbackPersonaTabs: Record<string, PersonaTabConfig> = {
  jim: { label: 'Supervisor Jim', color: 'purple' },
  leo: { label: 'Philosopher Leo', color: 'green' },
  darron: { label: 'Dreamer Darron', color: 'blue' },
  jemma: { label: 'Dispatcher Jemma', color: 'amber' },
};

const fallbackNestedTabs: Record<string, NestedTabConfig[]> = {
  jim: [
    { key: 'jim-request', label: 'Requests' },
    { key: 'jim-report', label: 'Reports' },
  ],
  leo: [
    { key: 'leo-question', label: 'Questions' },
    { key: 'leo-postulate', label: 'Postulates' },
  ],
  darron: [
    { key: 'darron-thought', label: 'Thoughts' },
    { key: 'darron-musing', label: 'Musings' },
  ],
  jemma: [
    { key: 'jemma-messages', label: 'Messages' },
    { key: 'jemma-stats', label: 'Stats' },
  ],
};

// ── Dynamic builders (from persona registry API response) ──

export interface PersonaApiEntry {
  name: string;
  display_name: string;
  kind: string;
  color: string;
  workshop_tabs_parsed?: Array<{ key: string; label: string }>;
  role_name?: string;
  active: number;
}

/**
 * Build persona tab config from API data.
 * Returns a Record<string, PersonaTabConfig> keyed by persona name.
 */
export function buildPersonaTabs(personas: PersonaApiEntry[]): Record<string, PersonaTabConfig> {
  const tabs: Record<string, PersonaTabConfig> = {};
  for (const p of personas) {
    if (!p.active) continue;
    // Only include personas that have workshop tabs
    const hasTabs = p.workshop_tabs_parsed && p.workshop_tabs_parsed.length > 0;
    if (!hasTabs && p.kind === 'gateway') {
      // Gateways (like Jemma) may have special tabs — include them
      tabs[p.name] = { label: p.display_name, color: p.color };
    } else if (hasTabs) {
      tabs[p.name] = { label: p.display_name, color: p.color };
    }
  }
  return tabs;
}

/**
 * Build nested tab config from API data.
 */
export function buildNestedTabs(personas: PersonaApiEntry[]): Record<string, NestedTabConfig[]> {
  const nested: Record<string, NestedTabConfig[]> = {};
  for (const p of personas) {
    if (!p.active || !p.workshop_tabs_parsed) continue;
    if (p.workshop_tabs_parsed.length > 0) {
      nested[p.name] = p.workshop_tabs_parsed;
    }
  }
  return nested;
}

/**
 * Build a role → display info map for MessageBubble rendering.
 * Maps role_name to {label, color}.
 */
export function buildRoleMap(personas: PersonaApiEntry[]): Record<string, { label: string; color: string }> {
  const map: Record<string, { label: string; color: string }> = {};
  for (const p of personas) {
    if (!p.active) continue;
    const roleName = p.role_name || p.name;
    map[roleName] = { label: p.display_name.split(' ').pop() || p.name, color: p.color };
  }
  return map;
}

// ── Exports (backwards compatible) ─────────────────────────

// These are the defaults — components should prefer API-loaded versions when available
export const workshopPersonaTabs = fallbackPersonaTabs;
export const workshopNestedTabs = fallbackNestedTabs;
