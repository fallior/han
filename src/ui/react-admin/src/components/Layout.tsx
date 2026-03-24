import { type ReactNode, useState } from 'react';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapse = () => {
    setCollapsed(!collapsed);
  };

  const toggleMobile = () => {
    setMobileOpen(!mobileOpen);
  };

  const closeMobile = () => {
    setMobileOpen(false);
  };

  return (
    <div className={`admin-layout ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-sidebar-open' : ''}`}>
      {/* Mobile overlay */}
      {mobileOpen && <div className="mobile-sidebar-overlay" onClick={closeMobile} />}
      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} onNavigate={closeMobile} />
      <main className="main">
        <header className="main-header">
          <button className="mobile-menu-btn" onClick={toggleMobile} aria-label="Toggle menu">
            <svg viewBox="0 0 20 20" width="20" height="20">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
            </svg>
          </button>
          <h1 id="moduleTitle">Overview</h1>
          <div className="main-header-actions" id="moduleActions"></div>
        </header>
        <div className="main-content">
          {children}
        </div>
      </main>
      <StatusBar />
    </div>
  );
}
