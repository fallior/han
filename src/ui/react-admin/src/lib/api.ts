const TOKEN_KEY = 'han-auth-token';

export const API_BASE = '';

/**
 * Fetch wrapper that automatically injects bearer token authentication.
 * Handles 401 responses by clearing token and triggering re-authentication.
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY);

  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized - clear token and reload to trigger auth prompt
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.reload();
    // Throw to prevent further processing
    throw new Error('Authentication required');
  }

  return response;
}
