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
- **Automatic reconnection** — persistent SSH sessions with exponential backoff reconnection

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
- **Per-server tabs** — open a terminal to any configured server with one click

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
| Linux | `.AppImage` / `.deb` | x64 |

### macOS (Homebrew)

```bash
brew tap Rampesna/tap
brew install --cask monitc
```

### macOS (Direct download)

Download `monitc-1.0.0-universal.dmg` from [Releases](../../releases), open it and drag **monitc.app** to `/Applications`.

### Windows

Download `monitc-Setup-1.0.0.exe` from [Releases](../../releases) and run the installer.

### Linux (AppImage)

```bash
chmod +x monitc-1.0.0.AppImage
./monitc-1.0.0.AppImage
```

### Linux (Debian / Ubuntu)

```bash
sudo dpkg -i monitc_1.0.0_amd64.deb
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
│   ├── ssh/                # SSH connection pool + command definitions
│   │   ├── ssh-manager.ts
│   │   ├── ssh-commands.ts
│   │   ├── ssh-terminal-manager.ts
│   │   ├── k8s-management-commands.ts
│   │   ├── rollout-commands.ts
│   │   └── git-commands.ts
│   ├── monitors/           # System / Docker / Kubernetes pollers + log streamer
│   ├── alerts/             # Alert engine + SMTP / WhatsApp / Telegram channels
│   ├── ci/                 # GitHub & GitLab REST API clients
│   └── ipc/                # IPC handler registration
├── preload/                # Context bridge (window.monitcAPI)
└── renderer/               # React 19 + TailwindCSS 4 SPA
    └── src/
        ├── i18n/           # i18next + 7 locale files
        ├── context/        # AppContext (global state + IPC listeners)
        ├── pages/          # Route-level page components (Dashboard, Servers, Terminal, Docker, K8s, CI/CD, Alerts, …)
        └── components/     # Reusable UI components
```

### IPC Channel Map

| Channel | Direction | Description |
|---------|-----------|-------------|
| `servers:list/add/update/remove/test` | Renderer → Main | SSH server CRUD |
| `monitor:start/stop/status` | Renderer → Main | Start/stop metric polling |
| `metrics:update` | Main → Renderer | Live metric push |
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
  <sub>Built with Electron · React · TypeScript · TailwindCSS · node-ssh2 · xterm.js · Recharts</sub>
</div>
