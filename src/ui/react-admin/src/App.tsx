import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import AuthGuard from './components/AuthGuard'
import OverviewPage from './pages/OverviewPage'
import ProjectsPage from './pages/ProjectsPage'
import WorkPage from './pages/WorkPage'
import WorkshopPage from './pages/WorkshopPage'
import SupervisorPage from './pages/SupervisorPage'
import ReportsPage from './pages/ReportsPage'
import ConversationsPage from './pages/ConversationsPage'
import MemoryPage from './pages/MemoryPage'
import ProductsPage from './pages/ProductsPage'

function App() {
  return (
    <AuthGuard>
      <Layout>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/work" element={<WorkPage />} />
          <Route path="/workshop" element={<WorkshopPage />} />
          <Route path="/supervisor" element={<SupervisorPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/conversations" element={<ConversationsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/products" element={<ProductsPage />} />
        </Routes>
      </Layout>
    </AuthGuard>
  )
}

export default App
