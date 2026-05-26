<div align="center">

# monitc

**A modern, cross-platform server monitoring & DevOps management desktop application**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron)](https://electronjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://typescriptlang.org)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#)

[**Download**](#-download) · [**Features**](#-features) · [**Screenshots**](#-screenshots) · [**Getting Started**](#-getting-started) · [**Contributing**](#-contributing)

</div>

---

## ✨ Features

### 🖥️ Server Monitoring
- **SSH-based monitoring** — connect to any Linux/macOS server over SSH (password or private key)
- **Real-time metrics** — CPU, RAM, Disk, Network I/O, Load Average, Uptime with live charts
- **Multi-server support** — monitor unlimited servers simultaneously from one dashboard
- **Persistent SSH connection** — single multiplexed SSH connection per server (max 6 concurrent channels); no new connection per poll cycle
- **Automatic reconnection** — exponential backoff with jitter (1.5s → 60s), SSH-level keepalives every 15s, active health check every 30s

### 📊 Metrics History
- **SQLite-backed history** — CPU, RAM, Disk, Network readings stored locally with timestamps
- **7-day retention** — automatic purge of data older than 7 days
- **Query by time range** — retrieve last 1h / 6h / 24h / 48h / 7d of metrics for any server

### 📄 Report Export
- **PDF & PNG export** — export a full server performance report for any time range
- **Professional layout** — summary cards (avg/peak CPU & RAM), area charts, disk bar chart, network interface table, header/footer with server info
- Two-step flow: choose time range + format → preview → download

### ☁️ AWS Integration
- **EC2 management** — list instances with state badges, start/stop/reboot, full details (security groups, IAM role, volumes)
- **EKS management** — list clusters, describe details, node groups with scaling config, generate kubeconfig YAML
- **CloudWatch metrics** — historical time-series for CPUUtilization, NetworkIn/Out, DiskReadOps/WriteOps
- **Credential validation** — STS GetCallerIdentity to verify access keys before saving
- **Security** — region whitelist (29 regions), credentials masked in UI, all API calls in main process only

### 🐳 Docker Management
- Live container list with status, resource usage, and port mappings
- Start / Stop / Restart / Remove containers directly from the UI
- Live log streaming per container with xterm.js terminal
- Images, Networks, and Volumes inventory

### ☸️ Kubernetes Management
- Pod, Service, Deployment, and Event monitoring
- **K8s Management panel** — create/delete Namespaces, Secrets (generic, docker-registry, TLS), Service Accounts
- **Kubeconfig generator** — export a CI/CD-ready Base64 kubeconfig (localhost replaced with server IP)
- Full support for K3s, K8s, and standard kubeadm clusters

### 💻 SSH Terminal
- **Multi-tab terminal** — open multiple interactive SSH shell sessions simultaneously
- **Full xterm.js terminal** — true 256-color terminal with resize support
- **Server picker modal** — select any configured server from a list, with live connection status

### 🖥️ Servers Overview
- Dedicated **Servers** page listing all configured servers as cards
- Live **connection status**, CPU and RAM gauges per server at a glance

### 🔁 CI/CD & Deployments
- **GitHub Actions** — browse repos and workflows, trigger `workflow_dispatch` events, monitor run status and job steps
- **GitLab CI/CD** — browse projects and pipelines, trigger new pipelines, monitor job status
- **Deploy panel** — link a server path + repo + K8s deployment; one-click Git Pull, CI/CD trigger, and Rollout Restart/Undo/Scale/SetImage

### 🔔 Alerts
- Configurable threshold rules: CPU > X%, RAM > X%, Disk > X% for N consecutive minutes
- Multi-channel notifications: **Email (SMTP)**, **WhatsApp** (Twilio / custom API), **Telegram Bot**
- Cooldown periods to prevent alert flooding

### 🌍 Internationalization
- 7 languages: **English**, **Turkish**, **German**, **French**, **Spanish**, **Italian**, **Arabic** (RTL)
- Language switcher in Settings → General

---

## 📸 Screenshots

<table>
  <tr>
    <td width="50%">
      <img src=".github/assets/dashboard.png" alt="Server Dashboard" />
      <p align="center"><sub>Server Dashboard — live CPU, RAM, Disk & Network charts</sub></p>
    </td>
    <td width="50%">
      <img src=".github/assets/k8s.png" alt="Kubernetes Monitor" />
      <p align="center"><sub>Kubernetes — Pod, Service & Deployment monitoring</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src=".github/assets/cicd.png" alt="CI/CD" />
      <p align="center"><sub>CI/CD — GitHub Actions workflow triggering & run history</sub></p>
    </td>
    <td width="50%">
      <img src=".github/assets/k3s.png" alt="K8s Management" />
      <p align="center"><sub>K8s Management — Namespace, Secret & Service Account panel</sub></p>
    </td>
  </tr>
</table>

---

## 📥 Download

Pre-built releases are available on the [GitHub Releases](../../releases) page.

| Platform | Format | Architecture |
|----------|--------|--------------|
| macOS | `.dmg` | Universal (Apple Silicon + Intel) |
| Windows | `.exe` NSIS Installer | x64 |
| Linux | `.AppImage` | arm64 |

### macOS (Homebrew)

```bash
brew tap Rampesna/tap
brew install --cask monitc
```

### macOS (Direct download)

Download `monitc-1.1.0-universal.dmg` from [Releases](../../releases), open it and drag **monitc.app** to `/Applications`.

### Windows

Download `monitc-Setup-1.1.0.exe` from [Releases](../../releases) and run the installer.

### Linux (AppImage)

```bash
chmod +x monitc-1.1.0-arm64.AppImage
./monitc-1.1.0-arm64.AppImage
```

---

## 🚀 Getting Started

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| npm | ≥ 9 |

### Development

```bash
# Clone the repository
git clone https://github.com/Rampesna/monitc.git
cd monitc

# Install dependencies
npm install

# Start in development mode (hot reload)
npm run dev
```

### Production Build

```bash
# Build for current platform
npm run build

# Package for macOS (creates dist/monitc-*.dmg)
npm run build:mac

# Package for Windows (creates dist/monitc-*.exe)
npm run build:win

# Package for Linux (creates dist/monitc-*.AppImage)
npm run build:linux
```

---

## 🔧 Adding a Server

1. Open **Settings → Servers**
2. Click **Add Server**
3. Fill in: Host/IP, port (default 22), username, auth method
4. Click **Test Connection** — if it succeeds, click **Save**
5. Monitoring starts automatically

### SSH Key Authentication

You can provide either:
- **PEM key content** — paste the full `-----BEGIN OPENSSH PRIVATE KEY-----` block
- **Key file path** — absolute path to your private key file (e.g. `~/.ssh/id_rsa`)

---

## 💻 Using the SSH Terminal

1. Click **Terminal** in the sidebar
2. Click **+ New Session** and select a server from the modal
3. The terminal connects and opens an interactive shell session
4. Open multiple tabs for different servers simultaneously
5. Use the **×** button on a tab to close the session

---

## ☁️ Connecting AWS

1. Open **Settings → Cloud Providers**
2. Click **Add AWS Account**
3. Enter a label, Access Key ID, Secret Access Key, and region
4. Click **Test Credentials** — validates via STS GetCallerIdentity
5. Save — EC2 instances, EKS clusters, and CloudWatch metrics are now accessible

---

## 📄 Exporting Reports

1. Open any **Server Dashboard**
2. Click **Export** in the top-right
3. Choose time range (1h / 6h / 24h / 48h / 7d) and format (PDF or PNG)
4. Click **Preview Report** to load data
5. Click **Download** — report is saved to your Downloads folder

---

## 🔔 Setting Up Alerts

1. Go to **Settings → Integrations** and configure your notification channel (SMTP / WhatsApp / Telegram)
2. Go to **Alerts** and click **Add Rule**
3. Choose metric, operator, threshold, and duration
4. Select the notification channel
5. Save — the alert engine evaluates metrics in real time

---

## 🚢 CI/CD Integration

### GitHub Actions

1. **Settings → Git** — enter your GitHub Personal Access Token (`repo`, `workflow`, `secrets` scopes)
2. Go to **CI/CD** and select a repository
3. Choose a workflow from the dropdown and click **▶ Run**

### GitLab CI/CD

1. **Settings → Git** — enter your GitLab PAT (`api` scope), optionally a self-hosted base URL
2. Go to **CI/CD → GitLab**, select a project
3. Enter branch/tag and click **▶ Run**

### Kubeconfig for CI/CD

1. Go to **K8s Management → Kubeconfig**
2. Click **Generate CI/CD Kubeconfig** — it replaces `localhost` with your server's actual IP
3. Copy the Base64 string and add it as a secret (`KUBECONFIG_BASE64`) in your GitHub/GitLab project

---

## 🏗️ Architecture

```
src/
├── main/                   # Electron main process (Node.js)
│   ├── store/              # Plain JSON persistence (monitc-data.json)
│   ├── ssh/                # Persistent multiplexed SSH connection pool
│   │   ├── ssh-manager.ts          # Single Client per server, channel queue, health check
│   │   ├── ssh-commands.ts
│   │   ├── ssh-terminal-manager.ts
│   │   ├── k8s-management-commands.ts
│   │   ├── rollout-commands.ts
│   │   └── git-commands.ts
│   ├── monitors/           # System / Docker / Kubernetes pollers + log streamer
│   │   └── metrics-db.ts           # SQLite history (better-sqlite3, WAL mode)
│   ├── aws/                # AWS SDK v3 clients (EC2, EKS, CloudWatch, STS)
│   │   ├── aws-manager.ts
│   │   ├── ec2-commands.ts
│   │   ├── eks-commands.ts
│   │   └── cloudwatch-commands.ts
│   ├── alerts/             # Alert engine + SMTP / WhatsApp / Telegram channels
│   ├── ci/                 # GitHub & GitLab REST API clients
│   └── ipc/                # IPC handler registration
├── preload/                # Context bridge (window.monitcAPI)
└── renderer/               # React 19 + TailwindCSS 4 SPA
    └── src/
        ├── i18n/           # i18next + 7 locale files
        ├── context/        # AppContext (global state + IPC listeners)
        ├── components/
        │   └── export/     # ExportReportModal + ReportCanvas (html2canvas + jsPDF)
        ├── pages/          # Dashboard, Servers, Terminal, Docker, K8s, CI/CD, Alerts, …
        └── hooks/          # useMetricsHistory and other custom hooks
```

### IPC Channel Map

| Channel | Direction | Description |
|---------|-----------|-------------|
| `servers:list/add/update/remove/test` | Renderer → Main | SSH server CRUD |
| `monitor:start/stop/status` | Renderer → Main | Start/stop metric polling |
| `metrics:update` | Main → Renderer | Live metric push |
| `metrics:history` | Renderer → Main | SQLite history query |
| `docker:action/inspect` | Renderer → Main | Docker container operations |
| `kubernetes:update` | Main → Renderer | K8s state push |
| `k8s:namespaces:*` / `k8s:secrets:*` / `k8s:serviceaccounts:*` | Renderer → Main | K8s management |
| `k8s:kubeconfig:get/cicd` | Renderer → Main | Kubeconfig export |
| `rollout:restart/undo/scale/setImage` | Renderer → Main | K8s rollout control |
| `git:pull/status/lastCommit/branches` | Renderer → Main | Git operations over SSH |
| `github:*` / `gitlab:*` | Renderer → Main | CI/CD API calls |
| `projects:list/add/update/remove` | Renderer → Main | Project link CRUD |
| `alerts:list/add/update/remove` | Renderer → Main | Alert rule CRUD |
| `settings:get/save` | Renderer → Main | Integration config |
| `preferences:get/save` | Renderer → Main | App preferences |
| `terminal:open/write/resize/close` | Renderer → Main | SSH terminal session management |
| `terminal:data` | Main → Renderer | Live shell output stream |
| `aws:accounts:list/add/update/remove/test` | Renderer → Main | AWS account CRUD |
| `aws:ec2:instances:list` / `aws:ec2:instance:*` | Renderer → Main | EC2 operations |
| `aws:eks:clusters:list` / `aws:eks:*` | Renderer → Main | EKS operations |
| `aws:cloudwatch:ec2:metrics` | Renderer → Main | CloudWatch time-series |

---

## 🤝 Contributing

Contributions are very welcome! Please open an issue first if you plan a larger change.

```bash
# Fork and clone
git clone https://github.com/<you>/monitc.git
cd monitc
npm install

# Create a feature branch
git checkout -b feat/my-feature

# Make your changes and run the dev server
npm run dev

# Submit a pull request
```

### Adding a New Language

1. Copy `src/renderer/src/i18n/locales/en.json` to `<code>.json`
2. Translate all values (keep keys unchanged)
3. Import and register the locale in `src/renderer/src/i18n/index.ts`
4. Add an entry to the `LANGUAGES` array

---

## 📄 License

MIT © [Talha Can Rampesna](https://github.com/Rampesna)

---

<div align="center">
  <sub>Built with Electron · React · TypeScript · TailwindCSS · node-ssh2 · xterm.js · Recharts · better-sqlite3 · AWS SDK v3</sub>
</div>
