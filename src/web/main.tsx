import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import Home from './pages/Home'
import Join from './pages/Join'
import RoomShell from './pages/RoomShell'
import Lobby from './pages/Lobby'
import Config from './pages/Config'
import Live from './pages/Live'
import Teams from './pages/Teams'
import Players from './pages/Players'
import Trades from './pages/Trades'
import History from './pages/History'
import Host from './pages/Host'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/r/:code" element={<RoomShell />}>
          <Route index element={<Navigate to="lobby" replace />} />
          <Route path="lobby" element={<Lobby />} />
          <Route path="config" element={<Config />} />
          <Route path="live" element={<Live />} />
          <Route path="teams" element={<Teams />} />
          <Route path="teams/:team" element={<Teams />} />
          <Route path="players" element={<Players />} />
          <Route path="trades" element={<Trades />} />
          <Route path="history" element={<History />} />
          <Route path="host" element={<Host />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
