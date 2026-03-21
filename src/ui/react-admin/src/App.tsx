import { Outlet, Link, useLocation } from 'react-router-dom'
import StatusBar from './components/StatusBar'
import './App.css'

function App() {
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true
    if (path !== '/' && location.pathname.startsWith(path)) return true
    return false
  }

  return (
    <div className="app-container">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>HAN Admin</h1>
        </header>
        <nav className="sidebar-nav">
          <Link
            to="/"
            className={isActive('/') && !isActive('/conversations') && !isActive('/supervisor') ? 'active' : ''}
          >
            Overview
          </Link>
          <Link
            to="/conversations"
            className={isActive('/conversations') ? 'active' : ''}
          >
            Conversations
          </Link>
          <Link
            to="/supervisor"
            className={isActive('/supervisor') ? 'active' : ''}
          >
            Supervisor
          </Link>
        </nav>
      </aside>
      <main className="main-content">
        <StatusBar />
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default App
