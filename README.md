# Antigravity BUSY Bar PC Companion System

A high-performance PC Companion Application and Unity Editor extension designed for the **BUSY Bar** physical dual-display hardware system. It features timestamp-based time tracking, OpenProject task provider integration, an embedded local Fastify webhook server, SQLite persistence, Windows Action Center notification listening with dynamic priority preemption, Unity Engine telemetry, and an interactive dark-themed desktop dashboard with a dual hardware display emulator.

---

## 🛠️ Monorepo Architecture

This repository is structured as a `pnpm` workspace monorepo:

```
BUSY_Bar/
├── packages/
│   ├── desktop-app/      # Electron + React 18 + Fastify + SQLite + Vite + Vitest + Tailwind CSS
│   └── unity-plugin/     # Unity C# Package (com.antigravity.busybar)
├── Project Plan/         # System architecture, IPC API contracts, user stories & UI/UX specs
├── Documentation/        # Hardware SDK, OpenAPI HTTP REST/WebSocket spec, Developer Guides & AI Lessons
├── GEMINI.md             # Code quality standards & AI guidelines
├── scripts/              # Preflight check, packaging scripts & PixelIt icon downsampler
├── tools/                # Standalone 16×16 Pixel Art Editor web application (pnpm editor)
└── package.json          # Root monorepo workspace configuration
```

---

## 🌟 Key Features & Capabilities

### ⏱️ Timestamp-Based Time Tracking & Session Management
- **Precision Time Logging:** Live active session tracker, auto-calculating exact work durations with start, pause, resume, and completion states.
- **SQLite Persistence:** Worklogs and session history are saved locally using `better-sqlite3` with automated sync queues for offline resilience.
- **Work History & Export:** Complete historical view of logged sessions categorized by project and task ticket with EOD export capabilities.

### 🗂️ OpenProject Task Integration & Time Synchronization
- **OpenProject (REST API v3):** Direct connection to OpenProject to fetch projects (`/api/v3/projects`) and work packages (`/api/v3/work_packages`).
- **Automated Status Sync:** Automatically updates work package statuses (e.g. `In Progress`, `To Test`, `To Review`) when tracking starts or completes.
- **Time Entry Synchronization:** Synchronizes tracked session durations directly with OpenProject work packages using ISO 8601 duration format (`POST /api/v3/time_entries`).
- **AdHoc Local Tasks:** Quick offline task creation for ad-hoc work and immediate time tracking with custom fallback ticket keys.

### 🖥️ Dual Display Hardware & Emulation Engine
- **Front RGB LED Matrix (72×16):** Displays 16×16 app icons, scrolling active task titles, priority notification popups, compilation progress bars, particle animations (confetti, spark effects), and LED status alerts.
- **Rear OLED Screen (160×80):** Renders secondary status, timer counts, and detailed session telemetry.
- **Built-In Display Emulator:** Integrated canvas display emulator in both the desktop app dashboard and browser workspace for real-time visual testing without requiring physical hardware.
- **Mock Hardware Mode:** Run the desktop application with `--mock-hardware` or set `MOCK_HARDWARE=true` to emulate TCP/UDP hardware socket communication.

### 🎛️ Physical Input Decoder & Remote Control
- **Rotary Encoder Wheel:** Decodes physical hardware inputs into application actions (rotary turns, short clicks, double clicks, long presses, button 1/2).
- **Hardware Trigger Mapping:** Rotary wheel click triggers task selector modal, double click toggles play/pause, long press opens daily ceremonies, and remote key injection API allows full remote control.

### 🔔 Windows Notification Listener & Priority Preemption Engine
- **Windows Action Center Integration:** Service captures system and application notifications directly from Windows APIs.
- **Dynamic Icon Processing:** Extracts desktop application icons and downsamples them into a crisp **15×15 pixel slot on the left (`x=0`)**.
- **Left Icon + Right Header Layout:** App icon is displayed on the left slot (`x=0`), with notification title and message body scrolling smoothly on the right (`x=16`).
- **Score-Based Priority Rules (0–100):** Application source priority management (`Don't Show`, `Default`, `High Priority`) and preemption engine handling Away Mode (75), Lunch Mode (65), Active Task override, and Notification Interrupts.

### 🎮 Unity Engine Deep Integration
- **Automated Plugin Management:** `UnityInjectorService` auto-discovers installed Unity projects and manages C# plugin (`com.antigravity.busybar`) injection.
- **Compilation Progress Display:** Displays live assembly compilation progress bar on the LED matrix during Unity script compiles.
- **"ON AIR" Indicator:** Automatically toggles red "ON AIR" display mode during Unity Play Mode (`entered`, `exited`).
- **Console Exception Flash:** Flashes red LED matrix warnings and displays exception/warning details when Unity runtime errors occur.
- **Heartbeat Connection Monitor:** Continuous connection pings between Unity Editor and the PC Companion app.

### 📅 Agile Ceremonies & Context Schedules
- **Daily Standup Assistant:** Automated standup prompts, interactive answer collection modal, and formatted summary generation.
- **End-Of-Day (EOD) Wrap-Up:** Daily wrap-up summary prompt with automated worklog export and report generator.
- **Context Schedule Service:** Configurable working hours, lunch break alerts, away time detection, and scheduled ceremony notifications.

### 💬 Messaging & Presence Sync
- **Slack & Discord Integration:** Sync user presence status and push webhook alerts during active focus sessions, meetings, or away modes.

### 🧩 Extensible Display Widget Engine
- **Built-In Display Widgets:** Pomodoro focus timer, Build Monitor widget, and Text Ticker widget.
- **Dynamic Registry:** Extensible widget architecture for registering custom matrix display views and cycling through widgets.

### 🎨 PixelIt 16×16 Downsampling & Standalone Pixel Editor
- **1:1 Crisp Pixel Art Font:** Uses `FONT_4X6` bitmask rasterization to eliminate subpixel canvas blur.
- **Standalone Pixel Editor:** Run `pnpm editor` to launch the 16×16 Pixel Art Editor web server on `http://localhost:39124`.
- **Animation & Visual Debugger:** Test marquee scrolling speeds, particle effects, LED colors, and icon rasterization in real time under **Settings > Device Diagnostics**.

---

## 📋 Prerequisites

Before setting up the project, ensure you have installed:

- **Node.js**: `v18.0.0` or higher (Node `v20+` recommended)
- **pnpm**: `v8.0.0` or higher (`npm install -g pnpm` or use `npx pnpm`)
- **C++ Build Tools / Python**: Required for native C++ compilation of `better-sqlite3` (Windows Visual Studio Build Tools / `python`).

---

## 🚀 Installation & Setup

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

---

## 💻 Running the Application

### Launch Development Server

To launch the Electron Desktop App in development mode with hot reloading:

```bash
pnpm dev
```

This starts the Vite dev server for the React UI (`http://localhost:3000`), watches and compiles the Electron main process, and launches the interactive Electron window. The embedded Fastify Webhook Server listens on `http://127.0.0.1:39123`.

To launch in **Mock Hardware Mode** (without a physical device connected):
```bash
cross-env MOCK_HARDWARE=true pnpm dev
```

---

## 📦 Building & Production Packaging (Windows x64)

The application uses `electron-builder` to generate production binaries for Windows x64:

### 1. Package Complete Windows Release (NSIS Installer & Portable Executable)

To build both the **NSIS Setup Installer** (`.exe`) and the standalone **Portable Executable** (`.exe`):

```bash
pnpm package:win
```

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

### 3. Package Unity C# Plugin

To package the standalone Unity Editor C# plugin:

```bash
pnpm package:unity
```

---

## 🧪 Testing & Verification

The project includes an AAA unit test suite built with Vitest and V8 code coverage:

> [!NOTE]
> Testing automatically runs `pnpm rebuild better-sqlite3` via pre-test hooks to ensure native C++ SQLite bindings match the host Node.js runtime environment.

### Run Unit Tests (250+ Tests)
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

### Verify Compiled Electron Release Package
```bash
pnpm verify:packed
```

---

## 🎨 Pixel Art Editor & CLI Tools

- **Standalone 16×16 Pixel Art Editor Web Server:**
  ```bash
  pnpm editor
  ```
  Launches the interactive editor at `http://localhost:39124` for live visual icon creation and tweaking.

- **Icon Downsampling Command:**
  ```bash
  node scripts/convert-icons-pixelit.js
  ```

---

## ⚡ Windows Quick Launch Helpers (`.bat`)

Convenient Windows batch scripts are available in the repository root directory:

- **`install.bat`**: Installs all monorepo workspace dependencies via PNPM.
- **`run_editor.bat`**: Launches the standalone 16×16 Pixel Art Editor web server (`http://localhost:39124`).
- **`package-win.bat`**: Builds and packages the complete Windows installer and portable `.exe`.
- **`package-unity.bat`**: Packages the Unity C# plugin package.
- **`test-coverage.bat`**: Runs ESLint checks and the Vitest test suite with V8 code coverage report.
- **`run_web.bat`**: Launches the web server.

---

## 🔌 Embedded Webhook Server API Endpoints

The Electron Main process hosts a Fastify HTTP server on `http://127.0.0.1:39123` for local IDE, Unity, and telemetry integrations.

| Route | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/unity/compile` | `POST` | Compilation state (`started`, `finished`) & progress bar display |
| `/api/v1/unity/playmode` | `POST` | Toggles "ON AIR" red display mode during Unity Play Mode (`entered`, `exited`) |
| `/api/v1/unity/console` | `POST` | Flashes red LED and displays exception/warning details |
| `/api/v1/unity/heartbeat` | `POST` | Unity Editor C# plugin active connection heartbeat pings |
| `/api/v1/vscode/activity` | `POST` | VS Code workspace & active file editing activity telemetry |
| `/api/v1/input/inject` | `POST` | Inject physical hardware key events (`up`, `down`, `start`, `ok`, etc.) |

---

## 🎮 Unity Editor Plugin (`com.antigravity.busybar`)

The monorepo includes a Unity Editor C# package that connects Unity assembly compilation, Play Mode transitions, and console exceptions directly to the BUSY Bar physical matrix display.

### 1. Build Unity Package Bundle
```bash
pnpm package:unity
```

### 2. Import into Unity Project
1. Open your Unity project (Unity 2021.3+ recommended).
2. Open **Unity Package Manager** (`Window` > `Package Manager`).
3. Click `+` (top-left) > **Add package from disk...**.
4. Select `packages/unity-plugin/package.json` in this monorepo.

The plugin automatically initializes `BusyBarWebhookPublisher` and `BusyBarSceneSaveListener` without modifying your scene files or project code.

---

## 📚 Documentation & Technical Specifications

For further details, consult the technical documentation in the repository:

- [Technical Stack & System Architecture](file:///c:/Users/jbgeron/Documents/Perso/BUSY_Bar/Project%20Plan/Technical%20Stack%20%26%20System%20Architecture.md)
- [IPC & Local Webhook API Contracts](file:///c:/Users/jbgeron/Documents/Perso/BUSY_Bar/Project%20Plan/IPC%20%26%20Local%20Webhook%20API%20Contracts.md)
- [BUSY Bar API & Display Technical Developer Guide](file:///c:/Users/jbgeron/Documents/Perso/BUSY_Bar/Documentation/BUSY%20Bar%20API%20%26%20Display%20Technical%20Developer%20Guide.md)
- [BUSY Bar HTTP API Specs (OpenAPI YAML)](file:///c:/Users/jbgeron/Documents/Perso/BUSY_Bar/Documentation/BUSY%20Bar%20HTTP%20API%20Docs.yaml)
- [Product Backlog & User Stories](file:///c:/Users/jbgeron/Documents/Perso/BUSY_Bar/Project%20Plan/Product%20Backlog%20%26%20User%20Stories.md)
- [UI/UX Specifications](file:///c:/Users/jbgeron/Documents/Perso/BUSY_Bar/Project%20Plan/UIUX%20Specification.md)
- [AI Lessons & Widget Reference Guide](file:///c:/Users/jbgeron/Documents/Perso/BUSY_Bar/Documentation/AI%20Lessons/README.md)

---

## 📜 Code Style & Standards

- **SOLID & Clean Code Principles:** Adheres to [GEMINI.md](file:///c:/Users/jbgeron/Documents/Perso/BUSY_Bar/GEMINI.md) AI project guidelines.
- **ESLint & Prettier:** Shared configuration in `.eslintrc.cjs` and `.prettierrc`.
- **Formatting Command:** `pnpm format`
- **Linting Command:** `pnpm lint`

