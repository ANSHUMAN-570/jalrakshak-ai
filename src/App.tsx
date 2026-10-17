import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Landing from './landing/Landing'

// The application (header + report/track/dashboard/analytics pages) is a separate chunk,
// so visitors who only see the landing page never download it.
const AppShell = lazy(() => import('./AppShell'))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="*"
          element={
            <Suspense fallback={<div className="flex h-screen items-center justify-center bg-jal-navy text-jal-mist" role="status">Loading JalRakshak AI...</div>}>
              <AppShell />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
