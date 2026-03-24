import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import './Sidebar.css';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}

export default function Sidebar({ collapsed = false, onToggleCollapse = () => {}, onNavigate }: SidebarProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const root = document.documentElement;
    return root.classList.contains('light-mode') ? 'light' : 'dark';
  });

  const toggleTheme = () => {
    const root = document.documentElement;
    const newTheme = theme === 'dark' ? 'light' : 'dark';

    if (newTheme === 'light') {
      root.classList.add('light-mode');
    } else {
      root.classList.remove('light-mode');
    }

    setTheme(newTheme);
  };

  return (
    <nav className="sidebar" id="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">HAN</div>
        <span className="sidebar-logo-text">Hortus Arbor Nostra</span>
      </div>

      <div className="sidebar-nav">
        <NavLink to="/" className="sidebar-item" end onClick={onNavigate}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <rect x="2" y="2" width="7" height="7" rx="1.5"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5"/>
            </svg>
          </span>
          <span className="sidebar-label">Overview</span>
        </NavLink>

        <NavLink to="/projects" className="sidebar-item" onClick={onNavigate}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z"/>
            </svg>
          </span>
          <span className="sidebar-label">Projects</span>
        </NavLink>

        <NavLink to="/work" className="sidebar-item" onClick={onNavigate}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <path d="M3 4h14M3 8h14M3 12h10M3 16h6"/>
              <path d="M15 12l2 2 4-4" strokeWidth="2"/>
            </svg>
          </span>
          <span className="sidebar-label">Work</span>
        </NavLink>

        <NavLink to="/workshop" className="sidebar-item" onClick={onNavigate}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <path d="M3 6h14M5 6v8a2 2 0 002 2h6a2 2 0 002-2V6M7 6v-2a1 1 0 011-1h4a1 1 0 011 1v2M9 10h2M8 14h4"/>
            </svg>
          </span>
          <span className="sidebar-label">Workshop</span>
        </NavLink>

        <NavLink to="/supervisor" className="sidebar-item" onClick={onNavigate}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="3"/>
              <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.41 1.41M13.54 13.54l1.41 1.41M5.05 14.95l1.41-1.41M13.54 6.46l1.41-1.41"/>
            </svg>
          </span>
          <span className="sidebar-label">Supervisor</span>
        </NavLink>

        <NavLink to="/reports" className="sidebar-item" onClick={onNavigate}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <rect x="3" y="10" width="3" height="7" rx="0.5"/>
              <rect x="8.5" y="6" width="3" height="11" rx="0.5"/>
              <rect x="14" y="3" width="3" height="14" rx="0.5"/>
            </svg>
          </span>
          <span className="sidebar-label">Reports</span>
        </NavLink>

        <NavLink to="/conversations" className="sidebar-item" onClick={onNavigate}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <path d="M3 4h10a2 2 0 012 2v4a2 2 0 01-2 2H8l-3 3v-3H3a1 1 0 01-1-1V5a1 1 0 011-1z"/>
              <path d="M7 14h6a2 2 0 002-2V8" opacity="0.5"/>
            </svg>
          </span>
          <span className="sidebar-label">Conversations</span>
        </NavLink>

        <NavLink to="/memory" className="sidebar-item" onClick={onNavigate}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <path d="M10 2C6 2 3 5 3 8.5c0 2.5 1.5 4.5 3.5 5.5L6 17l2.5-2c.5.1 1 .1 1.5.1 4 0 7-3 7-6.5S14 2 10 2z"/>
              <circle cx="7" cy="8.5" r="1" fill="currentColor" stroke="none"/>
              <circle cx="10" cy="8.5" r="1" fill="currentColor" stroke="none"/>
              <circle cx="13" cy="8.5" r="1" fill="currentColor" stroke="none"/>
            </svg>
          </span>
          <span className="sidebar-label">Memory</span>
        </NavLink>

        <NavLink to="/products" className="sidebar-item" onClick={onNavigate}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <path d="M4 4h12l1 3H3l1-3zM3 7h14v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
              <path d="M8 7v-3M12 7v-3"/>
            </svg>
          </span>
          <span className="sidebar-label">Products</span>
        </NavLink>
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-item" id="collapseBtn" title="Toggle sidebar" onClick={onToggleCollapse}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              <path d={collapsed ? "M8 4l6 6-6 6" : "M12 4l-6 6 6 6"}/>
            </svg>
          </span>
          <span className="sidebar-label">Collapse</span>
        </button>
        <button className="sidebar-item" id="themeToggle" title="Toggle theme" onClick={toggleTheme}>
          <span className="sidebar-icon">
            <svg viewBox="0 0 20 20">
              {theme === 'dark' ? (
                <>
                  <circle cx="10" cy="10" r="4"/>
                  <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41"/>
                </>
              ) : (
                <path d="M17 10a7 7 0 11-14 0 7 7 0 0114 0zM10 3v14"/>
              )}
            </svg>
          </span>
          <span className="sidebar-label">Theme</span>
        </button>
      </div>
    </nav>
  );
}
