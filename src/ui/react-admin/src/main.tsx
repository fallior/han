import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import OverviewPage from './pages/OverviewPage'
import ConversationsPage from './pages/ConversationsPage'
import SupervisorPage from './pages/SupervisorPage'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/admin-react">
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<OverviewPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="supervisor" element={<SupervisorPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
