import { Route, Routes } from 'react-router-dom'
import Landing from './screens/Landing'
import Lobby from './screens/Lobby'
import WaitingRoom from './screens/WaitingRoom'
import Gameplay from './screens/Gameplay'
import Results from './screens/Results'
import Profile from './screens/Profile'

/** Spec §3 routing map. Exported so tests can mount it under MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/lobby" element={<Lobby />} />
      <Route path="/room/:roomId" element={<WaitingRoom />} />
      <Route path="/room/:roomId/play" element={<Gameplay />} />
      <Route path="/room/:roomId/results" element={<Results />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="*" element={<Landing />} />
    </Routes>
  )
}

export default function App() {
  return <AppRoutes />
}
