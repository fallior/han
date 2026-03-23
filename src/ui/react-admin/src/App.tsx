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
import { WebSocketProvider } from './providers/WebSocketProvider'
import { useVisibilitySync } from './hooks/useVisibilitySync'

function AppContent() {
  // Enable visibility sync for tab switching
  useVisibilitySync()

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
