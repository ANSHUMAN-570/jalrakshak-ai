import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ROLE_LABEL, RequireRole, signOut, useSession } from './auth'
import { useLang } from './i18n'
import { LogoMark } from './landing/Logo'
import AdminPage from './pages/AdminPage'
import AnalyticsPage from './pages/AnalyticsPage'
import DashboardPage from './pages/DashboardPage'
import ReportPage from './pages/ReportPage'
import TrackPage from './pages/TrackPage'
import { ThemeToggle } from './theme'

export default function AppShell() {
  const { t, setLang, lang } = useLang()
  const { role, name, isStaff } = useSession()
  const link = ({ isActive }: { isActive: boolean }) =>
    `shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-sm ${isActive ? 'bg-surface font-semibold text-accent-text' : 'text-white hover:bg-white/15'}`

  return (
    <>
      <header className="bg-jal-ocean">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 p-3">
          <Link to="/" aria-label={`${t('appName')} - home`} className="mr-auto flex items-center gap-2 rounded text-lg font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:mr-3">
            <LogoMark className="h-8 w-8" />
            {t('appName')}
          </Link>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1" aria-label="Main">
            <NavLink to="/report" className={link}>{t('navReport')}</NavLink>
            <NavLink to="/track" className={link}>{t('navTrack')}</NavLink>
            {isStaff && <NavLink to="/dashboard" className={link}>{t('navDashboard')}</NavLink>}
            {isStaff && <NavLink to="/analytics" className={link}>{t('navAnalytics')}</NavLink>}
            {role === 'administrator' && <NavLink to="/admin" className={link}>Admin</NavLink>}
          </nav>
          {isStaff && (
            <span className="flex items-center gap-2 text-xs text-white" data-testid="session-badge">
              <span className="rounded bg-white/15 px-2 py-1">{ROLE_LABEL[role]}: {name}</span>
              <button type="button" onClick={signOut} className="rounded border border-white/40 px-2 py-1 hover:border-jal-cyan hover:text-jal-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-jal-cyan">Sign out</button>
            </span>
          )}
          <ThemeToggle />
          <button className="rounded border border-white/40 px-3 py-1 text-sm text-white hover:border-jal-cyan hover:text-jal-cyan" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>
            {t('langName')}
          </button>
        </div>
        <p className="bg-yellow-200 px-3 py-1 text-center text-xs text-yellow-900">{t('demoBanner')}</p>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Routes>
          <Route path="/report" element={<ReportPage />} />
          <Route path="/track" element={<TrackPage />} />
          <Route path="/dashboard" element={<RequireRole roles={['operator', 'administrator']}><DashboardPage /></RequireRole>} />
          <Route path="/analytics" element={<RequireRole roles={['operator', 'administrator']}><AnalyticsPage /></RequireRole>} />
          <Route path="/admin" element={<RequireRole roles={['administrator']}><AdminPage /></RequireRole>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}
