# Antigravity BUSY Bar PC Companion System

A high-performance PC Companion Application and Unity Editor extension designed for the **BUSY Bar** physical hardware display. It features timestamp-based time tracking, an embedded local Fastify webhook server, SQLite persistence, and an interactive dark-themed desktop dashboard.

---

## 🛠️ Monorepo Architecture

This repository is structured as a `pnpm` monorepo:

```
BUSY_Bar/
├── packages/
│   ├── desktop-app/      # Electron + React 18 + Fastify + SQLite + Vite + Vitest
│   └── unity-plugin/     # Unity C# Package (com.antigravity.busybar)
├── Project Plan/         # System architecture & IPC API specs
├── Documentation/        # Hardware SDK & HTTP REST/WebSocket reference docs
├── GEMINI.md             # Code quality standards & AI guidelines
└── package.json          # Root monorepo workspace configuration
```

---

## 📋 Prerequisites

Before setting up the project, ensure you have installed:

- **Node.js**: `v18.0.0` or higher (Node `v20+` recommended)
- **pnpm**: `v8.0.0` or higher (`npm install -g pnpm` or use `npx pnpm`)
- **C++ Build Tools / Python**: Required for native C++ compilation of `better-sqlite3` (Windows Visual Studio Build Tools / `python`).

---

## 🚀 Installation & First Time Setup

Follow these steps to clone, install dependencies, compile native modules, and initialize the workspace:

### 1. Install Workspace Dependencies

From the project root directory, run:

```bash
pnpm install
```

*(Or via npx if pnpm is not in PATH: `npx pnpm install`)*

### 2. Approve Native Build Scripts

Because the app uses native Node.js binaries (`better-sqlite3`, `electron`), allow pnpm to run build scripts:

```bash
pnpm approve-builds --all
```

*(Or: `npx pnpm approve-builds --all`)*

---

## 💻 Running the Application

### Launch Development Server

To launch the Electron Desktop App in development mode with hot reloading:

```bash
pnpm dev
```

This starts the Vite dev server for the React UI (`http://localhost:3000`), watches/builds the Electron main process, and launches the interactive Electron window. The embedded Fastify Webhook Server listens on `http://127.0.0.1:39123`.

---

## 📦 Building & Production Packaging (Windows x64)

The application uses `electron-builder` configured via `electron-builder.json` to generate production binaries for Windows x64:

### 1. Package Complete Windows Release (NSIS Installer & Portable Executable)

To build both the **NSIS Setup Installer** (`.exe`) and the standalone **Portable Executable** (`.exe`):

```bash
pnpm package:win
```

*(Or via npx: `npx pnpm package:win`)*

### 2. Package Specific Target Binaries

From within `packages/desktop-app`:

- **NSIS Setup Installer (`.exe`)**:
  ```bash
  pnpm --filter @busy-app/desktop-app package:installer
  ```
- **Portable Executable (`.exe`)**:
  ```bash
  pnpm --filter @busy-app/desktop-app package:portable
  ```

Outputs are saved to `packages/desktop-app/dist-electron/`.

---

## 🧪 Testing & Verification

The project includes an AAA unit test suite built with Vitest and V8 code coverage:

> [!NOTE]
> Testing automatically runs `pnpm rebuild better-sqlite3` via pre-test hooks to ensure native C++ SQLite bindings match the host Node.js runtime environment. When packaging for production (`pnpm package:win`), `electron-builder` automatically target-compiles native bindings for Electron.

### Run Unit Tests
```bash
pnpm test
```

### Run Tests with Coverage Report (90%+ Target)
```bash
pnpm test:coverage
```

### Run Release Pre-Flight Verification Check
```bash
pnpm preflight
```

---

## 🎨 PixelIt 16×16 Icon Downsampling Engine & Animation Debugger

The companion app includes an automated **PixelIt** image downsampling engine (`scripts/convert-icons-pixelit.js`) that processes high-resolution PNG reference icons into crisp 16×16 RGB pixel-art matrices for physical and emulated LED displays:

- **1:1 Crisp Pixel Art Font:** Uses `PIXEL_FONT_5X7` bitmask rasterization to eliminate subpixel canvas blur.
- **Full 16×16 Icon Canvas:** Spans the full 16-pixel vertical matrix height for Slack, Discord, Gmail, Unity, Burger, Clock, Wave, Pause, Play, Stop, Error, and Compiling icons.
- **Icon Conversion Command:**
  ```bash
  node scripts/convert-icons-pixelit.js
  ```
- **Animation & Visual Debugger Panel:** Accessible under **Settings > Device Diagnostics** in the desktop application to test marquee text scrolling, dynamic confetti particle animations, LED modes, and icon states in real-time.

---

## ⚡ Windows Quick Launch Helpers (`.bat`)

Convenient Windows batch scripts are available in the repository root directory:

- **`run_editor.bat`**: Launches the standalone 16×16 Pixel Art Editor web server (`http://localhost:39124`) for live visual icon tweaking.
- **`install.bat`**: Installs all monorepo workspace dependencies via PNPM.
- **`run_app.bat`**: Launches the Electron Desktop App in development mode with hot reloading.
- **`build.bat`**: Compiles TypeScript and builds Vite frontend bundles.
- **`package-win.bat`**: Builds and packages the complete Windows installer and portable `.exe`.
- **`test-coverage.bat`**: Runs ESLint checks and the Vitest test suite with V8 code coverage report.
- **`package-unity.bat`**: Packages the Unity C# plugin package.

---

## 🔌 Embedded Webhook Server API Endpoints

The Electron Main process hosts an HTTP server on `http://127.0.0.1:39123` for local IDE and Unity integrations:

| Route | Method | Payload Description |
| :--- | :--- | :--- |
| `/api/v1/unity/compile` | `POST` | Compilation state (`started`, `finished`) & progress bar display |
| `/api/v1/unity/playmode` | `POST` | Toggles "ON AIR" red display mode during Unity Play Mode (`entered`, `exited`) |
| `/api/v1/unity/console` | `POST` | Flashes red LED and displays exception/warning details |
| `/api/v1/unity/heartbeat` | `POST` | Unity Editor C# plugin active connection heartbeat pings |
| `/api/v1/slack/events` | `POST` | Slack workspace event subscriptions and notification banners |
| `/api/v1/discord/webhook` | `POST` | Discord incoming mentions and high-priority purple LED alerts |
| `/api/v1/vscode/activity` | `POST` | VS Code workspace & active file editing activity telemetry |

---

## 🎮 Unity Editor Plugin (`com.antigravity.busybar`)

The monorepo includes an optional Unity Editor C# package that connects Unity assembly compilation, Play Mode transitions, and console exceptions directly to the BUSY Bar physical matrix display.

### 1. Build Unity Package Bundle
```bash
pnpm package:unity
```

### 2. Import into Unity Project
1. Open your Unity project (Unity 2021.3+ recommended).
2. Open **Unity Package Manager** (`Window` > `Package Manager`).
3. Click `+` (top-left) > **Add package from disk...**.
4. Select `packages/unity-plugin/package.json` in this monorepo.

The plugin automatically initializes `BusyBarWebhookPublisher` and `BusyBarSceneSaveListener` on port `8081` without modifying your scene files or project code!

---

## 📜 Code Style & Standards

- **ESLint & Prettier:** Configured with shared rules in `.eslintrc.cjs` and `.prettierrc`.
- **Formatting Command:** `pnpm format`
- **Linting Command:** `pnpm lint`
