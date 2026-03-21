import { type ReactNode } from 'react';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="admin-layout">
      <Sidebar />
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
