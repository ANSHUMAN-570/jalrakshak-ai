import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useLang } from './i18n'
import AnalyticsPage from './pages/AnalyticsPage'
import DashboardPage from './pages/DashboardPage'
import ReportPage from './pages/ReportPage'
import TrackPage from './pages/TrackPage'

export default function App() {
  const { t, setLang, lang } = useLang()
  const link = ({ isActive }: { isActive: boolean }) =>
    `shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-sm ${isActive ? 'bg-white text-water-700 font-semibold' : 'text-white hover:bg-water-600'}`

  return (
    <BrowserRouter>
      <header className="bg-water-700">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 p-3">
          <span className="mr-auto text-lg font-bold text-white sm:mr-3">{t('appName')}</span>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1" aria-label="Main">
            <NavLink to="/report" className={link}>{t('navReport')}</NavLink>
            <NavLink to="/track" className={link}>{t('navTrack')}</NavLink>
            <NavLink to="/dashboard" className={link}>{t('navDashboard')}</NavLink>
            <NavLink to="/analytics" className={link}>{t('navAnalytics')}</NavLink>
          </nav>
          <button className="rounded border border-white px-3 py-1 text-sm text-white" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>
            {t('langName')}
          </button>
        </div>
        <p className="bg-yellow-200 px-3 py-1 text-center text-xs text-yellow-900">{t('demoBanner')}</p>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/track" element={<TrackPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
