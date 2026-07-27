# BUSY Bar PC Companion App: Technical Stack & System Architecture

**Document Purpose:** This document defines the technical architecture, technology stack, project directory structure, core software contracts, and module designs for the "Antigravity" BUSY Bar PC Companion Application and associated Unity Engine extension.

## 1\. System Overview & High-Level Architecture

The system consists of three distinct execution layers operating in harmony:

```
+-----------------------------------------------------------------------------------+
|                                 PC HOST MACHINE                                   |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                         Unity Editor (C# Plugin)                            |  |
|  |  - Compilation Hooks  - Play Mode Hooks  - Console Exception Listener       |  |
|  +-------------------------------------+---------------------------------------+  |
|                                        | Local HTTP Webhook (e.g. port 8080)      |
|                                        v                                          |
|  +-----------------------------------------------------------------------------+  |
|  |                   Electron PC Companion Desktop Application                 |  |
|  |                                                                             |  |
|  |  +---------------------------+       +-----------------------------------+  |  |
|  |  |   Renderer Process (UI)   |       |       Main Process (Node.js)      |  |  |
|  |  |                           |       |                                   |  |  |
|  |  | - React + Tailwind Dashboard | <---> | - Priority Notification Engine |  |  |
|  |  | - Live Task Control Panel |  IPC  | - Local Webhook Server            |  |  |
|  |  | - Keybinding Configurator |       | - Timestamp Timer & SQLite Store  |  |  |
|  |  | - Modular Settings Panels |       | - Pluggable ITaskProvider Engine  |  |  |
|  |  +---------------------------+       +-----------------+-----------------+  |  |
|  +--------------------------------------------------------|--------------------+  |
+-----------------------------------------------------------|-----------------------+
                                                            | HTTP REST API +
                                                            | WebSocket (StateStream)
                                                            v
                                            +-------------------------------+
                                            |      BUSY Bar Hardware        |
                                            |                               |
                                            | - Front Display (72x16 RGB)   |
                                            | - Back Display (160x80 OLED)  |
                                            | - Status RGB LED              |
                                            | - Physical Wheel & Buttons    |
                                            +-------------------------------+
```

1.  **Unity Engine Plugin (`Com.Antigravity.BusyBar`):** A lightweight C# Editor extension attached to Unity's `CompilationPipeline`, `EditorApplication`, and `Debug` log delegates. It sends local IPC/HTTP telemetry events to the Electron main process.
    
2.  **Electron PC Companion App:** The central coordinator built on Node.js/TypeScript. It manages active task timers using UTC timestamps, local SQLite storage, provider API integrations (Jira/Sheets/Notion), OS lock/unlock hooks, priority notification queueing, and local WebSockets.
    
3.  **BUSY Bar Hardware:** Communicates with the Electron Main process over local USB Virtual Ethernet (`10.0.4.20`) or Wi-Fi LAN HTTP REST endpoints and WebSocket `StateStream`.
    

## 2\. Technology Stack Selection

| 
Component / Layer

 | 

Technology

 | 

Version / Specification

 | 

Rationale & Justification

 |
| --- | --- | --- | --- |
| 

**Desktop Framework**

 | 

Electron

 | 

≥30.0  


 | 

Provides native Node.js capabilities for local HTTP servers, OS power/lock monitoring, system tray support, and deep IPC integration with TypeScript.

 |
| 

**Frontend UI**

 | 

React + TypeScript

 | 

React 18 / TS 5.x

 | 

High-performance, declarative UI for the modular dashboard ("1 Bar per Function") and task control panels.

 |
| 

**Styling & Icons**

 | 

Tailwind CSS + Lucide React

 | 

v3.x / Latest

 | 

Rapid styling of crisp, dark-themed dashboard components matching developer desktop aesthetics.

 |
| 

**Hardware Client Library**

 | 

`@busy-app/busy-lib`

 | 

v0.17.0+

 | 

Official TypeScript SDK providing typed `BusyBar` HTTP API client and Web Workers / `SharedWorker` WebSocket `StateStream` listeners.

 |
| 

**Local Persistence**

 | 

SQLite (`better-sqlite3`)

 | 

v11.x

 | 

Fast, zero-config embedded database for reboot-proof UTC timestamp logging, offline worklog retry queueing, and settings persistence.

 |
| 

**Local Webhook Server**

 | 

Fastify

 | 

v4.x

 | 

Ultra-lightweight, high-throughput embedded HTTP server in Electron Main process to receive events from Unity and VS Code.

 |
| 

**System Hooks**

 | 

Electron `powerMonitor`

 | 

Native API

 | 

Native lock screen (`Win + L` / sleep) and unlock detection without external binary dependencies.

 |
| 

**Unity Extension**

 | 

C# (.NET Standard 2.1)

 | 

Unity 2021.3 LTS+

 | 

Native Unity Editor C# script utilizing `UnityWebRequest` and `CompilationPipeline` hooks.

 |

## 3\. Project Directory Structure

```
antigravity-busy-bar/
├── .github/                       # CI/CD workflows and automated release scripts
├── docs/                          # Architecture diagrams, API specs, user manuals
├── packages/
│   ├── desktop-app/               # Electron Companion Desktop Application
│   │   ├── src/
│   │   │   ├── main/              # Electron Main Process (Node.js)
│   │   │   │   ├── api/           # Local Fastify Webhook Server for Unity/VS Code
│   │   │   │   ├── hardware/      # BusyBar SDK wrapper, WebSocket listener, Renderer Driver
│   │   │   │   ├── providers/     # ITaskProvider implementations (Jira, Google Sheets, Custom)
│   │   │   │   ├── services/      # Time tracking engine, Priority dispatcher, OS lock monitor
│   │   │   │   ├── store/         # SQLite schema, migrations, repository layer
│   │   │   │   └── index.ts       # Main process entry point
│   │   │   ├── preload/           # Electron IPC Context Bridge
│   │   │   │   └── index.ts
│   │   │   ├── renderer/          # Electron Renderer Process (React UI)
│   │   │   │   ├── components/    # Reusable UI widgets, Modals, Task Selectors
│   │   │   │   ├── modules/       # Settings tabs ("1 Bar per Function")
│   │   │   │   ├── state/         # Zustand UI state management
│   │   │   │   ├── App.tsx
│   │   │   │   └── main.tsx
│   │   │   └── shared/            # Shared DTOs, Enums, IPC channel definitions
│   │   ├── package.json
│   │   └── electron-builder.json
│   │
│   └── unity-plugin/              # Unity Editor C# Package (`com.antigravity.busybar`)
│       ├── Editor/
│       │   ├── AntigravityBusyBarPlugin.cs    # [InitializeOnLoad] Compiler & PlayMode Hooks
│       │   ├── AntigravityWebhookClient.cs    # Non-blocking UnityWebRequest Client
│       │   └── AntigravitySettings.cs         # Unity Editor Preferences Window
│       ├── package.json
│       └── package.json.meta
├── GEMINI.md                      # AI & Code Engineering Guidelines
└── package.json                   # Monorepo Workspace configuration (pnpm / npm workspaces)
```

## 4\. Core Software Contracts & Interfaces

### 4.1 Pluggable Task Provider Contract (`ITaskProvider`)

To ensure seamless support for Jira, Google Sheets, Notion, or custom self-hosted REST tools without modifying hardware rendering logic, all task management adheres to `ITaskProvider`:

```
export interface Project {
  id: string;
  name: string;
  key: string;
}

export interface Task {
  id: string;
  projectId: string;
  key: string; // e.g. "PROJ-123"
  title: string;
  status: 'todo' | 'in_progress' | 'done';
}

export interface WorklogPayload {
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string; // ISO 8601 UTC
  comment: string;
  isAdHoc: boolean;
}

export interface ITaskProvider {
  readonly providerId: string; // e.g. 'jira', 'google_sheets', 'notion'
  readonly providerName: string;

  initialize(credentials: Record<string, string>): Promise<boolean>;
  getProjects(): Promise<Project[]>;
  getTasks(projectId: string): Promise<Task[]>;
  reconcileRemoteState(): Promise<{ activeTask?: Task; remoteLoggedTimeToday: number }>;
  logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }>;
}
```

### 4.2 Priority Notification Matrix Engine (`PriorityDispatcher`)

All display commands sent to the BUSY Bar pass through an internal priority preemption engine before constructing the `/busybar/display/draw` payload:

```
export enum PriorityLevel {
  IDLE_OR_DEFAULT = 10,
  ACTIVE_TASK_TRACKER = 20,
  UNITY_COMPILING = 60,         // Unity compilation progress bar
  UNITY_PLAY_MODE = 70,         // Unity Play Mode DND
  UNITY_CRITICAL_ERROR = 80,    // Compilation failure / Exception
  MESSAGING_NOTIFICATION = 90,  // Discord, Slack, Gmail
  DAILY_STANDUP_PROMPT = 100,    // Stand-up stopwatch prompt
}

export interface DisplayPayloadRequest {
  id: string;
  priority: PriorityLevel;
  applicationName: string;
  frontElements: Array<Record<string, unknown>>;
  backElements?: Array<Record<string, unknown>>;
  ledColorHex?: string; // #RRGGBBAA
  audioPath?: string;
  suppressInStates?: Array<'AWAY' | 'LUNCH'>;
}
```

## 5\. Timestamp Time Tracking & Persistence Schema

### 5.1 Absolute UTC Timestamp Logic

Time tracking does not rely on active interval counters or in-memory timers. It calculates elapsed time dynamically from immutable UTC timestamps:

Elapsed Time\=(Tcurrent​−Tstart​)−∑(Tpause\_end​−Tpause\_start​)

### 5.2 SQLite Schema (`better-sqlite3`)

```
CREATE TABLE IF NOT EXISTS active_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    task_key TEXT NOT NULL,
    task_title TEXT NOT NULL,
    is_ad_hoc INTEGER NOT NULL DEFAULT 0,
    start_time_utc TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('TRACKING', 'PAUSED', 'COMPLETED')),
    total_paused_seconds INTEGER NOT NULL DEFAULT 0,
    last_pause_start_utc TEXT
);

CREATE TABLE IF NOT EXISTS paused_intervals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    paused_at_utc TEXT NOT NULL,
    resumed_at_utc TEXT,
    FOREIGN KEY(session_id) REFERENCES active_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS worklog_sync_queue (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    started_at_utc TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at_utc TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'SYNCED', 'FAILED'))
);
```

## 6\. Unity Editor Plugin Integration (`Com.Antigravity.BusyBar`)

The Unity plugin is non-blocking. If the companion desktop app is not running or the plugin is removed from a Unity project, Unity operates normally without throw exceptions or slowing editor performance.

### 6.1 Unity Event Flow

1.  `CompilationPipeline.compilationStarted` → POST `http://localhost:8080/unity/compile-start` `{"project": "MyGame"}`
    
2.  `CompilationPipeline.compilationFinished` → POST `http://localhost:8080/unity/compile-finish` `{"project": "MyGame", "success": true/false}`
    
3.  `EditorApplication.playModeStateChanged` → POST `http://localhost:8080/unity/playmode` `{"project": "MyGame", "state": "Playing" | "Stopped"}`
    
4.  `Application.logMessageReceived` (Filtered to `LogType.Exception`) → POST `http://localhost:8080/unity/exception` `{"project": "MyGame", "condition": "NullReferenceException"}`
    

### 6.2 Unity EOD Scene Saver Webhook

When the PC Companion App executes the optional End-of-Day wrap-up sequence, it issues an HTTP request to the Unity plugin listener:

-   POST `http://localhost:8081/antigravity/save-scenes`
    
-   Unity C# Handler executes: `EditorSceneManager.SaveOpenScenes()` on the main thread and responds `{"result": "OK"}` within 2000 ms.
    

## 7\. Development Roadmap & Implementation Steps

1.  **Phase 1: Workspace Setup & Monorepo Configuration**
    
    -   Configure pnpm workspace, TypeScript `tsconfig.base.json`, and ESLint/Prettier rules.
        
    -   Initialize Electron Main + Preload + Renderer scaffold with Tailwind CSS.
        
2.  **Phase 2: Hardware Core Driver & SDK Wrapper**
    
    -   Integrate `@busy-app/busy-lib` into Electron Main process.
        
    -   Implement `BusyBarService` handling HTTP connection fallback (`10.0.4.20` USB vs Wi-Fi LAN IP) and `LocalStateStream` WebSocket reconnects.
        
3.  **Phase 3: Persistence Layer & Time Tracker Engine**
    
    -   Setup SQLite database with `better-sqlite3`.
        
    -   Build timestamp-based reboot-proof session tracker and offline `WorklogSyncQueue`.
        
4.  **Phase 4: Provider Abstraction & Dashboard UI**
    
    -   Implement `ITaskProvider` interface and initial Jira / Ad-hoc fallback provider.
        
    -   Build React Modular Settings Dashboard ("1 Bar per Function") and task selector modal.
        
5.  **Phase 5: Unity Plugin & Local Webhook Integration**
    
    -   Develop Fastify webhook server in Electron Main.
        
    -   Create `Com.Antigravity.BusyBar` Unity Editor C# package.
        
6.  **Phase 6: Priority Dispatcher, Ceremonies & System Integrations**
    
    -   Implement Priority Matrix engine (`PriorityDispatcher`).
        
    -   Add Windows lock screen (`powerMonitor`) hook, Stand-up stopwatch prompt, and EOD wrap-up automation.