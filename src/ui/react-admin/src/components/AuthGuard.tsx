import { useEffect, useState } from 'react';

const TOKEN_KEY = 'han-auth-token';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState<boolean>(false);
  const [token, setToken] = useState<string>('');

  useEffect(() => {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    const existingToken = localStorage.getItem(TOKEN_KEY);

    if (isLocalhost || existingToken) {
      setIsAuthenticated(true);
    } else {
      setShowAuthPrompt(true);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      localStorage.setItem(TOKEN_KEY, token.trim());
      window.location.reload();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  if (showAuthPrompt) {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <h2>Authentication Required</h2>
          <form onSubmit={handleSubmit}>
            <input
              type="password"
              placeholder="Bearer token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="auth-input"
            />
            <button type="submit" className="auth-button">
              Connect
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
