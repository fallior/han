import { type ReactNode, useState } from 'react';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  const toggleCollapse = () => {
    setCollapsed(!collapsed);
  };

  return (
    <div className={`admin-layout ${collapsed ? 'collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      <main className="main">
        <header className="main-header">
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
