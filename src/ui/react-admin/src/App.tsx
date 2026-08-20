import { useEffect } from 'react'
import { apiFetch } from './api'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import AuthGuard from './components/AuthGuard'
import { ErrorBoundary } from './components/ErrorBoundary'
import OverviewPage from './pages/OverviewPage'
import ProjectsPage from './pages/ProjectsPage'
import WorkPage from './pages/WorkPage'
import WorkshopPage from './pages/WorkshopPage'
import SupervisorPage from './pages/SupervisorPage'
import ReportsPage from './pages/ReportsPage'
import ConversationsPage from './pages/ConversationsPage'
import MemoryPage from './pages/MemoryPage'
import ProductsPage from './pages/ProductsPage'
import KanbanPage from './pages/KanbanPage'
import { WebSocketProvider } from './providers/WebSocketProvider'
import { useStore } from './store'
import { setGardenZone } from './lib/garden-clock'

function AppContent() {
  // S151 follow-on: useVisibilitySync hook removed per Darron's "refresh
  // only on manual or someone-posts" rule. WebSocketProvider's own
  // visibilitychange handler still RECONNECTS the WS when the tab becomes
  // visible (so live updates resume after sleep) — but it no longer
  // triggers a blanket refetch.

  // Load persona registry from API on mount
  const loadPersonas = useStore((s) => s.loadPersonas)
  const personasLoaded = useStore((s) => s.personasLoaded)
  // DEC-105 P3: the garden's zone arrives from the manifest via /api/ecosystem —
  // set once at mount; every formatter renders garden time (fail-closed to UTC).
  useEffect(() => {
    apiFetch('/api/ecosystem')
      .then(res => res.json())
      .then(data => setGardenZone(data.timezone))
      .catch(() => setGardenZone(undefined)) // unreachable ⇒ honest UTC
  }, [])

  useEffect(() => {
    if (personasLoaded) return
    apiFetch('/api/village/personas')
      .then(res => res.json())
      .then(data => {
        if (data.personas) {
          loadPersonas(data.personas)
        }
      })
      .catch(err => console.warn('[App] Failed to load personas:', err.message))
  }, [loadPersonas, personasLoaded])

  return (
    <AuthGuard>
      <Layout>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<ErrorBoundary><OverviewPage /></ErrorBoundary>} />
            <Route path="/projects" element={<ErrorBoundary><ProjectsPage /></ErrorBoundary>} />
            <Route path="/work" element={<ErrorBoundary><WorkPage /></ErrorBoundary>} />
            <Route path="/workshop" element={<ErrorBoundary><WorkshopPage /></ErrorBoundary>} />
            <Route path="/supervisor" element={<ErrorBoundary><SupervisorPage /></ErrorBoundary>} />
            <Route path="/reports" element={<ErrorBoundary><ReportsPage /></ErrorBoundary>} />
            <Route path="/conversations" element={<ErrorBoundary><ConversationsPage /></ErrorBoundary>} />
            <Route path="/memory" element={<ErrorBoundary><MemoryPage /></ErrorBoundary>} />
            <Route path="/products" element={<ErrorBoundary><ProductsPage /></ErrorBoundary>} />
            <Route path="/kanban" element={<ErrorBoundary><KanbanPage /></ErrorBoundary>} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </AuthGuard>
  )
}

function App() {
  return (
    <WebSocketProvider>
      <AppContent />
    </WebSocketProvider>
  )
}

export default App
