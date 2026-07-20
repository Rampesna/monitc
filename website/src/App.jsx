import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Boxes,
  Check,
  ChevronRight,
  CircleCheck,
  CloudCog,
  Code2,
  Container,
  Download,
  FileCode2,
  FileUp,
  FolderOpen,
  Gauge,
  Github,
  Globe2,
  HardDrive,
  KeyRound,
  Layers3,
  LockKeyhole,
  Menu,
  MonitorCog,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  UploadCloud,
  X
} from 'lucide-react'

const GITHUB_RELEASES = 'https://github.com/Rampesna/monitc/releases/latest'
const GITHUB_REPO = 'https://github.com/Rampesna/monitc'

const features = [
  {
    icon: Gauge,
    eyebrow: 'Observe',
    title: 'Everything important, at a glance.',
    text: 'Live CPU, memory, disk, network and uptime across every server—without drowning in dashboards.',
    className: 'feature-wide feature-observe'
  },
  {
    icon: Container,
    eyebrow: 'Operate',
    title: 'Docker and Kubernetes, built in.',
    text: 'Inspect workloads, stream logs, restart services and manage cluster resources from one focused workspace.',
    className: 'feature-tall feature-containers'
  },
  {
    icon: TerminalSquare,
    eyebrow: 'Connect',
    title: 'A real terminal. Right where you need it.',
    text: 'Fast, persistent SSH sessions with tabs and native terminal behavior.',
    className: 'feature-terminal'
  },
  {
    icon: FolderOpen,
    eyebrow: 'Move',
    title: 'Remote files without the friction.',
    text: 'Browse, edit, upload, download, copy and move files over SFTP.',
    className: 'feature-files'
  },
  {
    icon: CloudCog,
    eyebrow: 'Automate',
    title: 'Ship with confidence.',
    text: 'Trigger GitHub Actions and GitLab pipelines, then follow every step without leaving monitc.',
    className: 'feature-wide feature-automate'
  }
]

const platformLabel = () => {
  const value = navigator.platform.toLowerCase()
  if (value.includes('mac')) return 'Download for macOS'
  if (value.includes('win')) return 'Download for Windows'
  if (value.includes('linux')) return 'Download for Linux'
  return 'Download monitc'
}

function Logo() {
  return (
    <a href="/" className="brand" aria-label="monitc home">
      <span className="brand-mark"><span /></span>
      <span>monitc</span>
    </a>
  )
}

function Header({ release }) {
  const [open, setOpen] = useState(false)
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Logo />
        <nav className={open ? 'nav-open' : ''} aria-label="Primary navigation">
          <a href="#features" onClick={() => setOpen(false)}>Features</a>
          <a href="#security" onClick={() => setOpen(false)}>Security</a>
          <a href="#updates" onClick={() => setOpen(false)}>Updates</a>
          <a href={GITHUB_REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a className="nav-download" href={release.downloadUrl || GITHUB_RELEASES}>
            Download <span>v{release.version}</span>
          </a>
        </nav>
        <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </header>
  )
}

function MetricRing({ value, label, tone }) {
  return (
    <div className="metric-ring-wrap">
      <div className={`metric-ring ${tone}`} style={{ '--value': `${value * 3.6}deg` }}>
        <div><strong>{value}%</strong><span>{label}</span></div>
      </div>
    </div>
  )
}

function ProductPreview() {
  return (
    <div className="product-window">
      <div className="window-topbar">
        <div className="traffic-lights"><i /><i /><i /></div>
        <div className="window-title">monitc / production</div>
        <div className="window-live"><span /> All systems live</div>
      </div>
      <div className="app-layout">
        <aside className="app-sidebar">
          <div className="mini-brand"><span className="brand-mark"><span /></span></div>
          {[Gauge, Server, Container, Boxes, TerminalSquare, FolderOpen].map((Icon, index) => (
            <div className={`side-icon ${index === 0 ? 'active' : ''}`} key={index}><Icon size={16} /></div>
          ))}
        </aside>
        <div className="app-main">
          <div className="preview-heading">
            <div><span>INFRASTRUCTURE</span><h3>Good morning, Talha.</h3></div>
            <button><RefreshCw size={12} /> Live</button>
          </div>
          <div className="preview-grid">
            <div className="preview-card server-health">
              <div className="card-label"><span>Production core</span><b><i /> Connected</b></div>
              <div className="rings">
                <MetricRing value={28} label="CPU" tone="purple" />
                <MetricRing value={61} label="MEM" tone="cyan" />
                <MetricRing value={42} label="DISK" tone="green" />
              </div>
              <div className="server-meta"><span><Activity size={11} /> 47d uptime</span><span><Network size={11} /> 45.131.1.244</span></div>
            </div>
            <div className="preview-card chart-card">
              <div className="card-label"><span>Network activity</span><b>Last 30 min</b></div>
              <div className="chart-lines">
                <div className="chart-grid-lines" />
                <div className="line line-a" />
                <div className="line line-b" />
              </div>
              <div className="chart-legend"><span><i className="cyan-dot" /> Incoming 18.4 MB/s</span><span><i /> Outgoing 6.2 MB/s</span></div>
            </div>
            <div className="preview-card containers-card">
              <div className="card-label"><span>Containers</span><b>12 running</b></div>
              {['monitc-web', 'api-gateway', 'postgres-main'].map((name, index) => (
                <div className="container-row" key={name}>
                  <span className="container-icon"><Container size={12} /></span>
                  <span><strong>{name}</strong><small>{index === 0 ? 'healthy · 9119:9119' : 'healthy · production'}</small></span>
                  <i />
                </div>
              ))}
            </div>
            <div className="preview-card terminal-card">
              <div className="card-label"><span>Quick terminal</span><b>root@production</b></div>
              <div className="terminal-lines">
                <p><em>~</em> monitc status</p>
                <p><span>✓</span> 8 servers connected</p>
                <p><span>✓</span> all services healthy</p>
                <p><em>~</em> <i /></p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Hero({ release }) {
  return (
    <main className="hero">
      <div className="hero-glow glow-one" />
      <div className="hero-glow glow-two" />
      <div className="shell hero-content">
        <div className="hero-copy">
          <a href="#updates" className="release-pill">
            <span><Sparkles size={12} /> v{release.version} is here</span>
            {release.summary || 'SFTP, one-click updates and a sharper workflow'}
            <ChevronRight size={14} />
          </a>
          <p className="eyebrow">SERVER OPERATIONS, BEAUTIFULLY FOCUSED</p>
          <h1>Your infrastructure.<br /><span>One calm view.</span></h1>
          <p className="hero-lead">
            Monitor servers, operate containers, manage Kubernetes, open terminals and move remote files—all from one fast desktop command center.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={release.downloadUrl || GITHUB_RELEASES}>
              <Download size={17} /> {platformLabel()} <ArrowRight size={16} />
            </a>
            <a className="button button-secondary" href={GITHUB_REPO} target="_blank" rel="noreferrer">
              <Github size={17} /> View on GitHub
            </a>
          </div>
          <div className="hero-proof">
            <span><Check size={13} /> Native macOS, Windows & Linux</span>
            <span><Check size={13} /> Your credentials stay on your device</span>
          </div>
        </div>
        <ProductPreview />
      </div>
    </main>
  )
}

function FeatureCard({ feature }) {
  const Icon = feature.icon
  return (
    <article className={`feature-card ${feature.className}`}>
      <div className="feature-icon"><Icon size={20} /></div>
      <div>
        <span className="feature-eyebrow">{feature.eyebrow}</span>
        <h3>{feature.title}</h3>
        <p>{feature.text}</p>
      </div>
      {feature.className.includes('observe') && (
        <div className="feature-visual observe-visual">
          {[72, 48, 86, 63, 92, 58, 78, 66, 88, 73, 96, 82].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
        </div>
      )}
      {feature.className.includes('containers') && (
        <div className="feature-visual stack-visual"><span /><span /><span /></div>
      )}
      {feature.className.includes('terminal') && (
        <div className="mini-terminal"><p><span>~</span> ssh production</p><p className="success">Connected in 184ms</p><p><span>~</span> <i /></p></div>
      )}
      {feature.className.includes('files') && (
        <div className="file-list"><p><FolderOpen size={13} /> /var/www <span>12 items</span></p><p><FileCode2 size={13} /> docker-compose.yml <b>2.4 KB</b></p></div>
      )}
      {feature.className.includes('automate') && (
        <div className="pipeline"><span className="done"><CircleCheck size={14} /> Build</span><i /><span className="done"><CircleCheck size={14} /> Test</span><i /><span className="live"><RefreshCw size={14} /> Deploy</span></div>
      )}
    </article>
  )
}

function Features() {
  return (
    <section className="section features-section" id="features">
      <div className="shell">
        <div className="section-heading split-heading">
          <div><p className="eyebrow">ONE APP. ZERO CONTEXT SWITCHING.</p><h2>From signal to action,<br />without changing tools.</h2></div>
          <p>monitc keeps the essentials close and the noise out of your way, so you can see what changed and act before it becomes an incident.</p>
        </div>
        <div className="feature-grid">{features.map((feature) => <FeatureCard feature={feature} key={feature.title} />)}</div>
      </div>
    </section>
  )
}

function Security() {
  return (
    <section className="section security-section" id="security">
      <div className="shell security-grid">
        <div className="security-copy">
          <p className="eyebrow">LOCAL-FIRST BY DESIGN</p>
          <h2>Your servers are yours.<br />They stay that way.</h2>
          <p>monitc connects directly from your desktop. Server credentials and private keys remain on your machine—there is no monitc cloud sitting between you and your infrastructure.</p>
          <div className="security-points">
            <div><ShieldCheck size={18} /><span><strong>No telemetry pipeline</strong><small>Your infrastructure data is not collected.</small></span></div>
            <div><LockKeyhole size={18} /><span><strong>Direct encrypted connections</strong><small>SSH and SFTP connect straight to your servers.</small></span></div>
            <div><HardDrive size={18} /><span><strong>Local persistence</strong><small>Preferences and metric history live on your device.</small></span></div>
          </div>
        </div>
        <div className="security-visual">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="security-core"><ShieldCheck size={38} /><span>LOCAL<br />CONTROL</span></div>
          <div className="orbit-node node-one"><MonitorCog size={18} /><span>Your Mac</span></div>
          <div className="orbit-node node-two"><Server size={18} /><span>Servers</span></div>
          <div className="orbit-node node-three"><KeyRound size={18} /><span>Keys</span></div>
        </div>
      </div>
    </section>
  )
}

function Updates({ release }) {
  return (
    <section className="section updates-section" id="updates">
      <div className="shell update-panel">
        <div className="update-icon"><RefreshCw size={27} /></div>
        <div className="update-copy">
          <p className="eyebrow">EFFORTLESS UPDATES</p>
          <h2>New release. One click. Done.</h2>
          <p>monitc checks for signed updates in the background. Review what changed, click update, and return to work on the newest version.</p>
          <div className="update-steps">
            <span><b>01</b> A new version appears</span><i /><span><b>02</b> Click update & restart</span><i /><span><b>03</b> Continue where you left off</span>
          </div>
        </div>
        <div className="update-release-card">
          <span className="status"><i /> Latest stable</span>
          <strong>monitc {release.version}</strong>
          <small>{release.publishedAt ? new Date(release.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Ready for the next release'}</small>
          <a href={release.downloadUrl || GITHUB_RELEASES}>Get the latest version <ArrowRight size={14} /></a>
        </div>
      </div>
    </section>
  )
}

function FinalCta({ release }) {
  return (
    <section className="final-cta">
      <div className="shell final-inner">
        <div className="cta-orb"><span className="brand-mark"><span /></span></div>
        <p className="eyebrow">READY WHEN YOU ARE</p>
        <h2>Infrastructure work feels better<br />when the tool gets out of the way.</h2>
        <p>Download monitc and bring your servers into focus.</p>
        <a className="button button-primary" href={release.downloadUrl || GITHUB_RELEASES}><Download size={17} /> {platformLabel()} <ArrowRight size={16} /></a>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer><div className="shell footer-inner"><Logo /><p>Built for people who keep systems running.</p><div><a href={GITHUB_REPO}>GitHub</a><a href="/admin">Release admin</a><span>© {new Date().getFullYear()} monitc</span></div></div></footer>
  )
}

function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('monitc-admin-token') || '')
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState([])
  const [remoteFiles, setRemoteFiles] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const loadFiles = async () => {
    if (!token) return
    const response = await fetch('/api/admin/files', { headers })
    if (!response.ok) throw new Error('Admin key is invalid.')
    const data = await response.json()
    setRemoteFiles(data.files || [])
  }

  useEffect(() => { loadFiles().catch((error) => setMessage(error.message)) }, [])

  const saveToken = async (event) => {
    event.preventDefault()
    sessionStorage.setItem('monitc-admin-token', token)
    setMessage('')
    try { await loadFiles() } catch (error) { setMessage(error.message) }
  }

  const publish = async (event) => {
    event.preventDefault()
    if (!version || files.length === 0) return setMessage('Add a version and release files first.')
    setBusy(true)
    setMessage('')
    const body = new FormData()
    body.append('version', version)
    body.append('notes', notes)
    for (const file of files) body.append('files', file)
    try {
      const response = await fetch('/api/admin/releases', { method: 'POST', headers, body })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Release could not be published.')
      setMessage(`Version ${result.release.version} is live.`)
      setFiles([])
      await loadFiles()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  return (
    <div className="admin-page">
      <header className="admin-header"><Logo /><a href="/">Back to website <ArrowRight size={14} /></a></header>
      <main className="admin-shell">
        <div className="admin-intro"><p className="eyebrow">RELEASE CONTROL</p><h1>Publish a monitc update.</h1><p>Upload the packages and updater manifests from one completed release build. Files are validated before the live feed changes.</p></div>
        <section className="admin-card auth-card">
          <div className="admin-card-title"><KeyRound size={18} /><div><h2>Admin access</h2><p>The key stays in this browser tab.</p></div></div>
          <form onSubmit={saveToken} className="token-form"><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste UPDATE_ADMIN_TOKEN" /><button type="submit">Unlock</button></form>
        </section>
        <section className="admin-card">
          <div className="admin-card-title"><UploadCloud size={18} /><div><h2>New release</h2><p>Recommended: upload every platform artifact in one batch.</p></div></div>
          <form onSubmit={publish} className="release-form">
            <label><span>Version</span><input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.3.0" /></label>
            <label><span>Release notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What changed in this release?" rows="5" /></label>
            <label className="file-drop"><FileUp size={25} /><strong>{files.length ? `${files.length} files selected` : 'Choose release files'}</strong><small>latest*.yml, ZIP, DMG, EXE, AppImage, DEB and blockmaps</small><input type="file" multiple onChange={(event) => setFiles([...event.target.files])} /></label>
            <button className="publish-button" disabled={busy || !token}>{busy ? <><RefreshCw size={15} className="spin" /> Publishing…</> : <>Validate & publish <ArrowRight size={15} /></>}</button>
          </form>
          {message && <p className="admin-message">{message}</p>}
        </section>
        <section className="admin-card">
          <div className="admin-card-title"><Layers3 size={18} /><div><h2>Live update files</h2><p>{remoteFiles.length} files currently available.</p></div></div>
          <div className="remote-file-list">{remoteFiles.length ? remoteFiles.map((file) => <div key={file.name}><FileCode2 size={14} /><span>{file.name}</span><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></div>) : <p>Unlock the panel to inspect the feed.</p>}</div>
        </section>
      </main>
    </div>
  )
}

export default function App() {
  const [release, setRelease] = useState({ version: '1.3.0', summary: '', downloadUrl: '', publishedAt: null })
  useEffect(() => {
    fetch('/api/releases/latest').then((response) => response.ok ? response.json() : null).then((data) => data && setRelease(data)).catch(() => {})
  }, [])

  if (window.location.pathname.startsWith('/admin')) return <Admin />
  return <><Header release={release} /><Hero release={release} /><Features /><Security /><Updates release={release} /><FinalCta release={release} /><Footer /></>
}
