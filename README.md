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

### ✦ Soft DevOps Workspace
- **Focused command center** — a 2×2 live cockpit combines CPU/RAM/Disk gauges, resource history, running containers, and a quick terminal summary
- **Compact icon rail** — every monitoring and management surface stays one click away without sacrificing working space
- **Consistent visual system** — graphite surfaces, low-contrast borders, soft depth, and purple/cyan/green status accents are shared across Dashboard, Servers, Docker, Kubernetes, Terminal, SFTP, CI/CD, Deploy, Logs, Alerts, and Settings
- **Live context everywhere** — the active server and global connection health remain visible in the title bar while navigating

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

### 📁 SFTP File Manager
- **Remote file browser** — navigate any connected server with breadcrumbs, folder search, multi-select, and familiar double-click navigation
- **Complete file operations** — create files/folders, rename, recursively copy/cut/paste, recursively delete, and update Unix permissions
- **Built-in text editor** — open, edit, and save remote UTF-8 text files without leaving monitc (5 MB editor safety limit)
- **Upload & download** — choose local files with the native system dialog and transfer them through SFTP
- **Keyboard workflow** — `Ctrl/Cmd+A`, `Ctrl/Cmd+C/X/V`, `F2`, `Delete`, and `Backspace` shortcuts
- **Connection-aware transfers** — SFTP reuses the monitored server's persistent SSH connection and shared channel queue

### 🖥️ Servers Overview
- Dedicated **Servers** page listing all configured servers as cards
- Live **connection status**, CPU, RAM, and Disk gauges per server at a glance
- Add a server directly from the Servers page without opening Settings
- Open a server's SFTP files directly from its card

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
      <p align="center"><sub>Command center — resources, activity, containers & quick terminal</sub></p>
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

**One-click in-app updates:** Packaged builds check the official `monitc.talhacan.com` update feed shortly after launch and every 4 hours. When an update is available, a persistent banner shows the new version and release notes. Click **Update & restart** once; monitc downloads the signed package, verifies it, installs it, and restarts automatically. You can also check manually from **Settings → General → Application updates**.

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

Download the latest universal `.dmg` from [Releases](../../releases), open it and drag **monitc.app** to `/Applications`.

### Windows

Download the latest NSIS installer (`.exe`) from [Releases](../../releases) and run it.

### Linux (AppImage)

```bash
chmod +x monitc-*.AppImage
./monitc-*.AppImage
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

## 🚀 Publishing an Update

Stable updates are published automatically by [`.github/workflows/release.yml`](.github/workflows/release.yml) whenever a version tag such as `v1.3.0` is pushed. The workflow:

1. verifies that the tag matches both `package.json` and `package-lock.json`
2. requires the tag commit to be on `main`
3. builds all application bundles before packaging
4. signs and notarizes the universal macOS app
5. creates the macOS ZIP required by Squirrel.Mac in addition to the DMG
6. builds Windows NSIS/portable and Linux AppImage/deb packages
7. validates `latest.yml`, `latest-mac.yml`, and `latest-linux.yml` against the generated packages
8. publishes all packages, blockmaps, and updater metadata in one GitHub Release
9. uploads the verified stable release to `https://monitc.talhacan.com/updates`, which is the production feed used by installed applications

### Required GitHub secrets

Configure these in **Repository Settings → Secrets and variables → Actions** before publishing a tag:

| Secret | Purpose |
|--------|---------|
| `MAC_CSC_LINK` | Base64-encoded Developer ID Application `.p12` certificate |
| `MAC_CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password created at appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID |
| `WIN_CSC_LINK` | Optional base64 Windows signing certificate (`.pfx`) |
| `WIN_CSC_KEY_PASSWORD` | Optional Windows certificate password |
| `UPDATE_SERVER_URL` | Production website origin: `https://monitc.talhacan.com` |
| `UPDATE_ADMIN_TOKEN` | Long random token shared with the protected release upload API |

The release workflow deliberately fails instead of publishing an unsigned macOS update when required signing secrets are missing.

### Release commands

For the already prepared `1.3.0` release after merging to `main`:

```bash
npm run release:verify -- v1.3.0
git tag -a v1.3.0 -m "monitc v1.3.0"
git push origin v1.3.0
```

For later patch releases, `npm version` updates both package files, creates the release commit, and creates the tag:

```bash
npm version patch
npm run release:verify -- "$(git describe --tags --exact-match)"
git push origin main --follow-tags
```

CI checks every pull request with [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Production updater logs are written to Electron's platform-specific logs directory as `updater.log`.

The Dockerized React landing page and release service live in [`website/`](website/). It serves the public website, the protected `/admin` release panel, and the static `/updates` feed from one container on port `9119`. Release files persist in `website/data` and are not committed to Git.

---

## 🔧 Adding a Server

1. Open **Servers** from the sidebar (or use **Settings → Servers**)
2. Click **Add Server**
3. Fill in: Host/IP, port (default 22), username, auth method
4. Click **Test Connection** — if it succeeds, click **Save**
5. Monitoring starts automatically

### SSH Key Authentication

Paste the full private key content (for example, a `-----BEGIN OPENSSH PRIVATE KEY-----` block). If the key is encrypted, enter its passphrase in the separate field.

---

## 📁 Managing Files with SFTP

1. Click **Files** in the sidebar, or click the folder icon on a server card
2. Select the target server from the picker; monitc connects automatically if needed
3. Double-click folders to navigate and files to open the built-in editor
4. Use the toolbar for create, upload/download, copy/cut/paste, rename, permissions, and delete
5. Multi-select with `Ctrl/Cmd+click` or the checkboxes; use the breadcrumb to jump to a parent folder

Copy and delete operations support non-empty directories recursively. Downloads currently target individual files, while uploads support selecting multiple local files. Remote editor reads are limited to 5 MB to keep the desktop UI responsive.

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
│   │   ├── sftp-manager.ts         # Remote file CRUD, recursive copy/delete, transfer helpers
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
        │   ├── export/     # ExportReportModal + ReportCanvas (html2canvas + jsPDF)
        │   └── servers/    # Reusable add/edit server form
        ├── pages/          # Dashboard, Servers, Terminal, Docker, K8s, CI/CD, Alerts, …
        └── hooks/          # useMetricsHistory and other custom hooks
```

### IPC Channel Map

| Channel | Direction | Description |
|---------|-----------|-------------|
| `servers:list/add/update/remove/test` | Renderer → Main | SSH server CRUD |
| `sftp:list/read/write/mkdir/rename/remove/paste/chmod` | Renderer → Main | SFTP file management |
| `sftp:upload/download` | Renderer → Main | Native-dialog SFTP transfers |
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
