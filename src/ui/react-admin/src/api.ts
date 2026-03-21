/**
 * API fetch wrapper with authentication
 * Ported from admin.js fetch override logic
 */

export const API_BASE = '';

/**
 * Configured fetch wrapper that:
 * - Prepends API_BASE to relative paths
 * - Attaches Bearer token from localStorage ('han-auth-token')
 * - Emits custom event on 401 for auth prompt handling
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('han-auth-token');

  // Build headers with optional Bearer token
  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Make request
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  // Emit event on 401 for auth prompt handling
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:required'));
  }

  return response;
}
