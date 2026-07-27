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

To launch the Electron Desktop App with hot reloading for the React UI:

```bash
pnpm dev
```

This starts the Vite dev server for the React UI on `http://localhost:3000` and launches the Electron Main process with the embedded Fastify Webhook Server listening on `http://127.0.0.1:8080`.

---

## 🧪 Testing & Verification

The project includes an AAA unit test suite built with Vitest and V8 code coverage:

### Run Unit Tests
```bash
pnpm test
```

### Run Tests with Coverage Report (90%+ Target)
```bash
pnpm test:coverage
```

---

## 🔌 Embedded Webhook Server API Endpoints

The Electron Main process hosts an HTTP server on `http://127.0.0.1:8080` for local IDE integrations:

| Route | Method | Payload Description |
| :--- | :--- | :--- |
| `/unity/compile-start` | `POST` | Dispatches blue compilation progress bar display state |
| `/unity/compile-finish` | `POST` | Plays audio chime & blinks green/red LED on build result |
| `/unity/playmode` | `POST` | Toggles "ON AIR" red display mode during Unity play mode |
| `/unity/exception` | `POST` | Flashes red LED and displays console exception details |

---

## 📜 Code Style & Standards

- **ESLint & Prettier:** Configured with shared rules in `.eslintrc.cjs` and `.prettierrc`.
- **Formatting Command:** `pnpm format`
- **Linting Command:** `pnpm lint`
