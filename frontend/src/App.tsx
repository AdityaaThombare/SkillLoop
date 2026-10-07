import { useEffect, useMemo, useState, type PointerEvent } from 'react'
import './App.css'

type Health = { status?: string; service?: string; model?: string; timestamp?: string }
type Product = 'evoloop' | 'skillloop'
const evolutionTabs = [
  { id: 'overview', label: 'Overview', path: '/evolution' },
  { id: 'observe', label: 'Observe', path: '/evolution/observe' },
  { id: 'repairs', label: 'Repairs', path: '/evolution/repairs' },
  { id: 'history', label: 'History', path: '/evolution/history' },
]
const skillRoutes = [
  { label: 'Home', path: '/skillloop' }, { label: 'Skills', path: '/skills' },
  { label: 'Network', path: '/network' }, { label: 'Trade loops', path: '/trade-loops' },
  { label: 'Teams', path: '/teams' }, { label: 'Leaderboard', path: '/leaderboard' },
  { label: 'Profile', path: '/profile' },
]

function routeState(path: string): { product: Product; tab: string; landing: boolean } {
  if (path === '/') return { product: 'evoloop', tab: 'overview', landing: true }
  if (path.startsWith('/evolution')) {
    const tail = path.split('/').filter(Boolean)[1] || 'overview'
    return { product: 'evoloop', tab: evolutionTabs.some((item) => item.id === tail) ? tail : 'overview', landing: false }
  }
  return { product: 'skillloop', tab: 'skillloop', landing: false }
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = (to: string) => {
    if (to !== window.location.pathname) window.history.pushState({}, '', to)
    setPath(to)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  return { path, navigate }
}

function Header({ product, navigate, signedIn }: { product: Product; navigate: (to: string) => void; signedIn: boolean | null }) {
  return <header className="app-header">
    <a className="wordmark" href="/" onClick={(event) => { event.preventDefault(); navigate('/') }} aria-label="EvoLoop home"><span className="wordmark-icon">E</span><span>EvoLoop</span></a>
    <nav className="product-switch" aria-label="Product navigation">
      <a href="/evolution" className={product === 'evoloop' ? 'selected' : ''} onClick={(event) => { event.preventDefault(); navigate('/evolution') }}>EvoLoop <small>EVOLUTION AGENT</small></a>
      <a href="/skillloop" className={product === 'skillloop' ? 'selected' : ''} onClick={(event) => { event.preventDefault(); navigate('/skillloop') }}>SkillLoop <small>SKILL EXCHANGE</small></a>
    </nav>
    {signedIn ? <a className="profile-button" href="/profile" onClick={(event) => { event.preventDefault(); navigate('/profile') }}><span className="profile-dot">↗</span><span>Profile</span></a> : <a className="profile-button" href={product === 'evoloop' ? '/evoloop/login' : '/login'}><span className="profile-dot">↗</span><span>Login</span></a>}
  </header>
}

function AsciiLaptop() {
  const [frame, setFrame] = useState(0)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const art = useMemo(() => {
    const glow = frame % 2 === 0
    return [
      '        .----------------------------------------------.',
      '       /  E V O L O O P   //   AGENT CONSOLE          /|',
      '      /----------------------------------------------/ |',
      '     |  [01] OBSERVE  ->  [02] DECIDE  ->  [03] VERIFY| |',
      '     |                                                | |',
      `     |  > evidence   ${glow ? '●' : '○'} registered target          | |`,
      `     |  > choice     ${glow ? '◈' : '◇'} typed and validated         | |`,
      '     |  > policy     risk gate / human directed       | |',
      '     |                                                | |',
      '     |  { route: "/app", candidates: [ ... ] }       | |',
      '     |________________________________________________|/',
      '         \\______________________________________/     ',
      '           \\________________________________//       ',
    ].join('\n')
  }, [frame])
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const box = event.currentTarget.getBoundingClientRect()
    setTilt({ x: ((event.clientX - box.left) / box.width - 0.5) * 5, y: ((event.clientY - box.top) / box.height - 0.5) * -4 })
  }
  return <div className="ascii-stage" onPointerMove={onPointerMove} onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
    <div className="ascii-orbit orbit-large"/><div className="ascii-orbit orbit-small"/>
    <button className="ascii-device" onClick={() => setFrame((value) => value + 1)} aria-label="Animate the EvoLoop ASCII laptop visualization" style={{ transform: `perspective(950px) rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)` }}>
      <span className="ascii-label">INTERACTIVE TERMINAL / CLICK TO CYCLE FRAME</span><pre aria-live="polite">{art}</pre><span className="ascii-device-base"/>
    </button>
    <span className="ascii-float float-top"><i>01</i> FOCUSED EVIDENCE</span><span className="ascii-float float-bottom"><i>✓</i> REGISTERED ACTIONS</span>
    <span className="ascii-cross cross-a">+</span><span className="ascii-cross cross-b">×</span>
    <span className="stage-caption">EVOLOOP / SYSTEM PREVIEW — ILLUSTRATIVE, NOT LIVE STATUS</span>
  </div>
}

function Landing({ navigate }: { navigate: (to: string) => void }) {
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking')
  useEffect(() => {
    const abort = new AbortController()
    fetch('http://127.0.0.1:8001/health', { signal: abort.signal }).then((response) => {
      if (!response.ok) throw new Error('offline')
      return response.json() as Promise<Health>
    }).then((data) => setHealth(data.status === 'ok' ? 'online' : 'offline')).catch(() => setHealth('offline'))
    return () => abort.abort()
  }, [])
  return <main className="landing-page">
    <section className="flagship-hero">
      <div className="hero-copy reveal"><div className="eyebrow"><span className="eyebrow-pulse"/> APPLICATION EVOLUTION SYSTEM <b> / </b> LOCAL AGENT</div>
        <h1>Build it.<br/><em>Observe it.</em><br/>Evolve it.</h1>
        <p>EvoLoop turns focused interface evidence into typed decisions and carefully verified repairs. You stay in control of every boundary.</p>
        <div className="hero-actions"><button className="primary-cta" onClick={() => navigate('/evolution')}>Open Evolution dashboard <span>↗</span></button><button className="text-cta" onClick={() => navigate('/skillloop')}>Explore SkillLoop <span>→</span></button></div>
        <div className="hero-meta"><span className={`agent-state ${health}`}><i/>{health === 'checking' ? 'Checking local agent' : health === 'online' ? 'Evolution service online' : 'Evolution service offline'}</span><span className="meta-separator"/><span>PHASE 1—3 / CONTROLLED PIPELINE</span></div>
      </div>
      <div className="hero-device reveal"><AsciiLaptop/></div>
    </section>
    <section className="signal-strip reveal"><div><small>01 / OBSERVE</small><b>Evidence, not the whole page</b><span>Focused context from registered targets.</span></div><div><small>02 / DECIDE</small><b>Typed model output</b><span>Structured choices validated before use.</span></div><div><small>03 / VERIFY</small><b>Exact postconditions</b><span>Controlled actions with explicit outcomes.</span></div></section>
    <section className="architecture reveal"><div><span className="eyebrow">~/ EVOLOOP / ARCHITECTURE</span><h2>One connected evolution loop.</h2><p>SkillLoop remains the product being evolved. EvoLoop connects the Flask application to a focused TypeScript decision service and local Ollama model.</p></div><div className="architecture-flow"><span>FLASK + JINJA</span><i>→</i><span>NODE / ZOD</span><i>→</i><span>OLLAMA</span></div></section>
    <footer className="landing-footer"><span>EVOLOOP // APPLICATION EVOLUTION AGENT</span><button onClick={() => navigate('/skillloop')}>Open SkillLoop <b>↗</b></button></footer>
  </main>
}

function Workspace({ path, product, navigate }: { path: string; product: Product; navigate: (to: string) => void }) {
  const tab = routeState(path).tab
  const activeEvolution = evolutionTabs.find((item) => item.id === tab) || evolutionTabs[0]
  const framePath = product === 'evoloop' ? activeEvolution.path : (path === '/skillloop' ? '/skillloop' : path)
  const src = `${framePath}${framePath.includes('?') ? '&' : '?'}embedded=1`
  return <main className="workspace-view">
    {product === 'evoloop' ? <div className="workspace-heading"><div><div className="eyebrow"><span className="eyebrow-pulse"/> EVOLUTION AGENT / CONTROLLED PIPELINE</div><h1>Evolution workspace</h1><p>Inspect evidence, registered repairs, decisions, and verification results.</p></div><span className="workspace-tag">PHASE 1—3</span></div> : <div className="workspace-heading"><div><div className="eyebrow"><span className="eyebrow-pulse"/> COMMUNITY SKILL EXCHANGE</div><h1>SkillLoop workspace</h1><p>Trade skills, find collaboration loops, and build hackathon teams.</p></div><span className="workspace-tag">ORIGINAL APP</span></div>}
    {product === 'evoloop' ? <nav className="workspace-tabs" aria-label="Evolution sections">{evolutionTabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => navigate(item.path)}>{item.label}</button>)}</nav> : <nav className="workspace-tabs skill-tabs" aria-label="SkillLoop sections">{skillRoutes.map((item) => <button key={item.path} className={path === item.path ? 'active' : ''} onClick={() => navigate(item.path)}>{item.label}</button>)}</nav>}
    <div className="embedded-app-frame"><iframe key={src} src={src} title={product === 'evoloop' ? 'EvoLoop evolution controls' : 'SkillLoop application'} loading="eager"/></div>
  </main>
}

function App() {
  const { path, navigate } = usePath()
  const state = routeState(path)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  useEffect(() => { fetch('/api/me').then((response) => setSignedIn(response.ok)).catch(() => setSignedIn(false)) }, [])
  const openRoute = (to: string) => {
    if (to !== '/' && signedIn !== true) {
      window.location.assign(to.startsWith('/evolution') ? '/evoloop/login' : '/login')
      return
    }
    navigate(to)
  }
  return <div className="app-root"><Header product={state.product} navigate={openRoute} signedIn={signedIn}/>{state.landing ? <Landing navigate={openRoute}/> : <Workspace path={path} product={state.product} navigate={openRoute}/>}</div>
}

export default App
