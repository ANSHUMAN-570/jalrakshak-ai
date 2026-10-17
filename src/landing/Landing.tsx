import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { APP_ROUTE, REPORT_ROUTE, SECTIONS } from './config'
import HeroVisual from './HeroVisual'
import { Icon, type IconName } from './icons'
import { useInView } from './hooks'
import { Logo } from './Logo'
import Nav, { useScrollTo } from './Nav'

function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition duration-700 motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none ${seen ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'} ${className}`}
    >
      {children}
    </div>
  )
}

const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-jal-aqua px-6 py-3 font-semibold text-jal-navy shadow-lg shadow-jal-aqua/20 transition hover:bg-jal-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'
const btnGhostDark = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/40 px-6 py-3 font-semibold text-white transition hover:border-jal-cyan hover:text-jal-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jal-cyan'

function Heading({ id, eyebrow, title, children, dark = false }: { id?: string; eyebrow: string; title: string; children?: ReactNode; dark?: boolean }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className={`text-sm font-semibold uppercase tracking-widest ${dark ? 'text-jal-cyan' : 'text-accent-text'}`}>{eyebrow}</p>
      <h2 id={id} className={`mt-2 text-3xl font-bold tracking-tight sm:text-4xl ${dark ? 'text-white' : 'text-fg'}`}>{title}</h2>
      {children && <p className={`mt-4 text-lg leading-relaxed ${dark ? 'text-jal-mist' : 'text-muted'}`}>{children}</p>}
    </div>
  )
}

function Hero() {
  const scrollTo = useScrollTo()
  return (
    <section id="home" className="relative overflow-hidden bg-jal-navy pt-16 text-white" aria-labelledby="hero-title">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true" style={{ background: 'radial-gradient(60% 50% at 75% 40%, rgba(0,194,209,.18), transparent 70%), radial-gradient(50% 40% at 10% 100%, rgba(11,53,88,.9), transparent 70%)' }} />
      <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-2 lg:py-16">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-jal-aqua/40 px-3 py-1 text-xs font-medium text-jal-cyan">
            <span className="h-2 w-2 rounded-full bg-jal-leaf" aria-hidden="true" /> Working prototype · demo data
          </p>
          <h1 id="hero-title" className="text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            Every Drop Matters.{' '}
            <br />
            <span className="text-jal-cyan">Every Leak Counts.</span>
          </h1>
          <p className="mt-3 text-lg font-medium text-jal-aqua">Smarter Water Management. Stronger Communities.</p>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-jal-mist">
            An intelligent platform to report water leaks, map incidents, prioritize investigations, and track repair progress — all in one place.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to={APP_ROUTE} className={btnPrimary}>
              Explore the Platform <Icon name="arrow" className="h-5 w-5" />
            </Link>
            <a href="#how-it-works" onClick={(e) => { e.preventDefault(); scrollTo('how-it-works') }} className={btnGhostDark}>
              See How It Works
            </a>
          </div>
          <ul className="mt-8 grid gap-x-6 gap-y-2 text-sm text-jal-mist sm:grid-cols-2" aria-label="Highlights">
            {['Hindi and English reporting', 'Interactive map (OpenStreetMap)', 'Explainable priority scores', 'Evidence-based closure'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Icon name="shield" className="h-4 w-4 shrink-0 text-jal-aqua" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <HeroVisual />
      </div>
    </section>
  )
}

function About() {
  return (
    <section id="about" className="scroll-mt-16 bg-canvas py-20" aria-labelledby="about-title">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 lg:grid-cols-2">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-widest text-muted">About</p>
          <h2 id="about-title" className="mt-2 text-3xl font-bold tracking-tight text-fg sm:text-4xl">Turning Water Reports Into Action</h2>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Water leaks can waste valuable resources and disrupt local water supply. Reports may arrive through different channels, making it difficult to identify duplicate incidents, prioritize inspections, and track whether problems have been resolved.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            JalRakshak AI connects citizen reporting, location intelligence, incident prioritization, and repair evidence in one workflow.
          </p>
          <p className="mt-4 rounded-lg border-l-4 border-jal-aqua bg-surface p-4 text-sm text-muted">
            A citizen report is a <strong>suspected</strong> leak. It is not treated as a confirmed leak until a person inspects it and records evidence.
          </p>
        </Reveal>
        <Reveal delay={150}>
          <figure>
            <svg viewBox="0 0 480 320" className="w-full rounded-2xl bg-jal-navy shadow-xl" role="img" aria-label="Illustration: scattered report points on a map grid connect into one grouped incident">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#0B3558" strokeWidth="1" /></pattern>
              </defs>
              <rect width="480" height="320" fill="url(#grid)" />
              <path d="M-10 250C80 200 130 290 220 230S380 150 490 190" fill="none" stroke="#00C2D1" strokeOpacity=".5" strokeWidth="6" strokeLinecap="round" strokeDasharray="14 10" className="motion-safe:animate-jal-flow" />
              {[[70, 70], [120, 110], [350, 80], [400, 250], [90, 240]].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="6" fill="#91A9B9" />
              ))}
              {[[250, 120], [272, 138], [236, 146]].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="7" fill="#45E6E0" />
              ))}
              <circle cx="250" cy="135" r="38" fill="none" stroke="#38B878" strokeWidth="3" strokeDasharray="6 5" />
              <text x="250" y="195" textAnchor="middle" fill="#EAFBFC" fontSize="13" fontFamily="sans-serif">3 reports, 1 incident</text>
            </svg>
            <figcaption className="mt-2 text-center text-xs text-muted">Illustration only</figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  )
}

const STEPS: { n: number; title: string; text: string; icon: IconName }[] = [
  { n: 1, title: 'Report', text: 'Citizens submit a suspected leak with a photo, description, and selected location.', icon: 'camera' },
  { n: 2, title: 'Analyze', text: 'The platform organizes incident details and identifies reports that may refer to the same event.', icon: 'layers' },
  { n: 3, title: 'Prioritize', text: 'An explainable priority score helps operators decide which incidents need investigation first.', icon: 'scale' },
  { n: 4, title: 'Track Resolution', text: 'Authorized operators track inspection and repair progress, with evidence recorded for review.', icon: 'clipboard' },
]

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 bg-jal-navy py-20" aria-labelledby="how-title">
      <div className="mx-auto max-w-6xl px-4">
        <Heading id="how-title" eyebrow="How it works" title="From a report to a recorded resolution" dark>Four connected steps, each one visible in the working application.</Heading>
        <div className="relative mt-14">
          <svg className="pointer-events-none absolute left-0 top-9 hidden h-8 w-full lg:block" viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true">
            <path d="M60 16C150 -4 200 36 290 16S440 -4 520 16 650 36 740 16 880 -4 940 16" fill="none" stroke="#00C2D1" strokeOpacity=".55" strokeWidth="3" strokeDasharray="10 8" className="motion-safe:animate-jal-flow" />
          </svg>
          <ol className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.n}>
                <Reveal delay={i * 120} className="h-full">
                  <div className="h-full rounded-2xl border border-white/10 bg-jal-ocean/60 p-6 shadow-lg shadow-black/20">
                    <div className="flex items-center gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-jal-aqua text-jal-navy ring-4 ring-jal-navy"><Icon name={s.icon} /></span>
                      <span className="text-sm font-semibold text-jal-cyan">Step {s.n}</span>
                    </div>
                    <h3 className="mt-4 text-xl font-bold text-white">{s.title}</h3>
                    <p className="mt-2 leading-relaxed text-jal-mist">{s.text}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

// Only capabilities that exist in the app today, plus one clearly-labelled planned item.
const FEATURES: { icon: IconName; title: string; text: string; planned?: boolean }[] = [
  { icon: 'map', title: 'Interactive GIS Map', text: 'View incident locations on an OpenStreetMap map and explore where reports cluster.' },
  { icon: 'camera', title: 'Citizen Leak Reporting', text: 'Submit a report with a description, a photograph, and a location you choose on the map.' },
  { icon: 'layers', title: 'Smart Duplicate Detection', text: 'Likely related reports (nearby, close in time, similar wording) are grouped into one incident.' },
  { icon: 'scale', title: 'Explainable Prioritization', text: 'Every priority score shows its four factors, so operators can see why one incident ranks first.' },
  { icon: 'pin', title: 'Automatic or Manual Address', text: 'Review an address detected from the map point, search for a place, or type the address yourself.' },
  { icon: 'clipboard', title: 'Repair Evidence & Case Tracking', text: 'Cases move through inspection and repair. Closure needs a note, photos, and a named verifier.' },
  { icon: 'chart', title: 'Analytics Dashboard', text: 'Report counts, duplicates consolidated, response times, and evidence completeness from the case data.' },
  { icon: 'globe', title: 'Hindi and English', text: 'Describe the problem in Hindi or English and confirm what the platform understood before submitting.' },
  { icon: 'database', title: 'Shared Database & Operator Sign-in', text: 'A database schema with access rules is prepared; connecting the app to it is not done yet.', planned: true },
]

function Features() {
  return (
    <section id="features" className="scroll-mt-16 bg-canvas py-20" aria-labelledby="features-title">
      <div className="mx-auto max-w-6xl px-4">
        <Heading id="features-title" eyebrow="Features" title="What the platform does today">Everything marked below is in the working prototype. The last card is planned and labelled as such.</Heading>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <li key={f.title}>
              <Reveal delay={(i % 3) * 100} className="h-full">
                <article className={`group h-full rounded-2xl border bg-surface p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${f.planned ? 'border-dashed border-line' : 'border-accent/25'}`}>
                  <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${f.planned ? 'bg-slate-100 text-jal-ocean' : 'bg-jal-navy text-jal-cyan'}`}><Icon name={f.icon} /></span>
                  <h3 className="mt-4 flex flex-wrap items-center gap-2 text-lg font-bold text-fg">
                    {f.title}
                    {f.planned && <span className="rounded bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn-fg">Planned</span>}
                  </h3>
                  <p className="mt-2 leading-relaxed text-muted">{f.text}</p>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Preview() {
  return (
    <section id="preview" className="scroll-mt-16 bg-surface py-20" aria-labelledby="preview-title">
      <div className="mx-auto max-w-6xl px-4">
        <Heading id="preview-title" eyebrow="Inside the app" title="See the working prototype">These are screenshots of the real application running on clearly labelled demo data. No incident shown here is real.</Heading>
        <Reveal className="mt-12">
          <div className="grid items-end gap-6 lg:grid-cols-[1fr_220px]">
            <figure className="overflow-hidden rounded-2xl border border-jal-ocean/20 bg-jal-navy p-2 shadow-2xl">
              <img src="/preview-dashboard.jpg" width={1280} height={800} loading="lazy" decoding="async" alt="JalRakshak AI operator dashboard: a map of sample incidents, a ranked investigation queue with addresses, and a selected case showing its priority score breakdown" className="h-auto w-full rounded-xl" />
              <figcaption className="px-2 pb-1 pt-2 text-center text-xs text-jal-mist">Operator dashboard · demo data</figcaption>
            </figure>
            <figure className="mx-auto w-48 overflow-hidden rounded-[1.6rem] border-4 border-jal-navy bg-jal-navy shadow-xl lg:w-full">
              <img src="/preview-report.jpg" width={390} height={844} loading="lazy" decoding="async" alt="JalRakshak AI citizen report form on a phone: location search, map with a draggable marker, and the detected address" className="h-auto w-full" />
              <figcaption className="bg-jal-navy px-2 py-1 text-center text-[11px] text-jal-mist">Citizen report form</figcaption>
            </figure>
          </div>
        </Reveal>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to={APP_ROUTE} className={btnPrimary}>Launch JalRakshak AI <Icon name="arrow" className="h-5 w-5" /></Link>
          <Link to={REPORT_ROUTE} className="inline-flex items-center justify-center rounded-lg border border-line px-6 py-3 font-semibold text-fg transition hover:border-accent hover:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Try reporting a leak
          </Link>
        </div>
      </div>
    </section>
  )
}

const IMPACT: { icon: IconName; title: string; text: string }[] = [
  { icon: 'layers', title: 'Better organized reports', text: 'Scattered citizen reports become structured, location-aware incidents.' },
  { icon: 'scale', title: 'Informed prioritization', text: 'Inspection order is guided by a transparent score instead of guesswork.' },
  { icon: 'eye', title: 'Visibility into open cases', text: 'Unresolved incidents and high-priority cases are easy to see.' },
  { icon: 'trace', title: 'Traceable repairs', text: 'Inspection notes and before/after evidence are recorded with every closure.' },
  { icon: 'database', title: 'Data for the future', text: 'Consistent records can support later water-management improvements.' },
]

function Impact() {
  return (
    <section id="impact" className="scroll-mt-16 bg-canvas py-20" aria-labelledby="impact-title">
      <div className="mx-auto max-w-6xl px-4">
        <Heading id="impact-title" eyebrow="Impact" title="Technology With a Purpose">The intended benefits, described plainly. Measuring real outcomes would need a pilot with a water utility.</Heading>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {IMPACT.map((c, i) => (
            <li key={c.title}>
              <Reveal delay={(i % 3) * 100} className="h-full">
                <div className="flex h-full gap-4 rounded-2xl bg-surface p-5 shadow-sm">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ok-bg text-ok"><Icon name={c.icon} /></span>
                  <div>
                    <h3 className="font-bold text-fg">{c.title}</h3>
                    <p className="mt-1 text-muted">{c.text}</p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted">This page shows no usage or water-savings figures because the prototype runs on demo data and has not been piloted.</p>
      </div>
    </section>
  )
}

function FinalCta() {
  const scrollTo = useScrollTo()
  return (
    <section className="relative overflow-hidden bg-jal-navy py-24 text-center" aria-labelledby="cta-title">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true" style={{ background: 'radial-gradient(50% 70% at 50% 110%, rgba(0,194,209,.28), transparent 70%)' }} />
      <svg className="pointer-events-none absolute -bottom-px left-0 w-full" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 50C240 90 480 10 720 45S1200 85 1440 35V90H0Z" fill="#0B3558" fillOpacity=".7" />
        <path d="M0 65C300 30 520 90 780 60S1200 30 1440 70V90H0Z" fill="#00C2D1" fillOpacity=".25" />
      </svg>
      <div className="relative mx-auto max-w-3xl px-4">
        <h2 id="cta-title" className="text-3xl font-extrabold tracking-tight text-white sm:text-5xl">Let's Make Every Drop Count.</h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-jal-mist">
          Explore how location intelligence and responsible AI can help communities manage reported water leaks more effectively.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to={APP_ROUTE} className={btnPrimary}>Open JalRakshak AI <Icon name="arrow" className="h-5 w-5" /></Link>
          <a href="#how-it-works" onClick={(e) => { e.preventDefault(); scrollTo('how-it-works') }} className={btnGhostDark}>Explore the Workflow</a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const scrollTo = useScrollTo()
  const year = new Date().getFullYear()
  return (
    <footer className="bg-[#04111d] pt-12 text-jal-mist">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-10 md:grid-cols-3">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm leading-relaxed">A civic-tech prototype that turns water-leak reports into prioritized, evidence-backed investigations.</p>
        </div>
        <nav aria-label="Footer">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-white">Explore</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}><a className="hover:text-jal-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-jal-cyan" href={`#${s.id}`} onClick={(e) => { e.preventDefault(); scrollTo(s.id) }}>{s.label}</a></li>
            ))}
            <li><Link className="hover:text-jal-cyan" to={APP_ROUTE}>Open Dashboard</Link></li>
            <li><Link className="hover:text-jal-cyan" to={REPORT_ROUTE}>Report a leak</Link></li>
          </ul>
        </nav>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-white">Built with</h2>
          <p className="mt-3 text-sm leading-relaxed">React, Vite, Tailwind CSS, Leaflet, Three.js, and map data © OpenStreetMap contributors.</p>
        </div>
      </div>
      <div className="border-t border-white/10 py-6">
        <div className="mx-auto max-w-6xl space-y-2 px-4 text-xs">
          <p>Reported incidents are suspected leaks and require appropriate verification by qualified personnel. This prototype uses demo data and is not connected to any government department or water utility.</p>
          <p>© {year} JalRakshak AI</p>
        </div>
      </div>
    </footer>
  )
}

export default function Landing() {
  useEffect(() => {
    const prev = document.title
    document.title = 'JalRakshak AI — Every Drop Matters. Every Leak Counts.'
    // Land on the requested section when opened with a hash (e.g. /#features)
    const id = location.hash.slice(1)
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView())
    return () => { document.title = prev }
  }, [])
  return (
    <div className="font-sans text-fg [scroll-behavior:smooth] motion-reduce:[scroll-behavior:auto]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-fg">Skip to content</a>
      <Nav />
      <main id="main">
        <Hero />
        <About />
        <HowItWorks />
        <Features />
        <Preview />
        <Impact />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
