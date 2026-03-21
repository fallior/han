/**
 * Workshop tab taxonomy constants
 * Defines persona tabs, nested tabs, and UI metadata
 */

import { type WorkshopPersona } from './workshopSlice';

export interface PersonaTabConfig {
  label: string;
  color: string;
}

export interface NestedTabConfig {
  key: string;
  label: string;
}

// Persona tab configurations
export const workshopPersonaTabs: Record<WorkshopPersona, PersonaTabConfig> = {
  jim: {
    label: 'Supervisor Jim',
    color: 'purple',
  },
  leo: {
    label: 'Philosopher Leo',
    color: 'green',
  },
  darron: {
    label: 'Dreamer Darron',
    color: 'blue',
  },
  jemma: {
    label: 'Dispatcher Jemma',
    color: 'amber',
  },
};

// Nested tabs for each persona
export const workshopNestedTabs: Record<WorkshopPersona, NestedTabConfig[]> = {
  jim: [
    { key: 'jim-request', label: 'Requests' },
    { key: 'jim-report', label: 'Reports' },
  ],
  leo: [
    { key: 'leo-question', label: 'Questions' },
    { key: 'leo-insight', label: 'Insights' },
  ],
  darron: [
    { key: 'darron-exploration', label: 'Explorations' },
    { key: 'darron-dream', label: 'Dreams' },
  ],
  jemma: [
    { key: 'jemma-messages', label: 'Messages' },
    { key: 'jemma-stats', label: 'Stats' },
  ],
};
