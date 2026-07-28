# BUSY Bar PC Companion Application: Feature Audit & Implementation Roadmap

> **Reference Document:** [Product Backlog & User Stories.md](file:///e:/Code/BUSY_Bar/Project%20Plan/Product%20Backlog%20&%20User%20Stories.md)  
> **Repository:** [Antigravity BUSY Bar Workspace](file:///e:/Code/BUSY_Bar)  
> **Guidelines:** [GEMINI.md](file:///e:/Code/BUSY_Bar/GEMINI.md)

---

## 1. Executive Summary & Audit Overview

A comprehensive audit of the **Antigravity BUSY Bar Companion App** codebase was conducted against the 5 Epics and 13 User Stories in `Product Backlog & User Stories.md`.

- **Core Infrastructure & Architecture (85% Complete):** Monorepo build, SQLite schema, IPC bridge, WebSocket hardware driver, Vite/Electron packaging, and native Webhook server are fully operational and passing 104 unit tests.
- **UI Views & Visual Layout (90% Complete):** All 8 left-sidebar navigation views (`Active Session`, `Modular Settings`, `Hardware Rebinds`, `Unity Engine`, `Ceremonies`, `Messaging`, `Priority Rules`, `Device Diagnostics`) have dedicated React views adhering to the dark UI/UX design system tokens.
- **Backend Integrations & Live Handshakes (40% Complete):** The five specific functional gaps highlighted (`Priority Rules` drag/drop sorting, live `Discord`/`Slack`/`Gmail` API listeners, `Unity Engine` editor plugin heartbeat/save state, real task provider API fetches, and dynamic worklog table rendering on session finish) form the remaining backlog required to complete the system.

---

## 2. Detailed Audit by Epic

### Epic 1: Bi-Directional Task Management & Timestamp Time Tracking

| User Story | Implementation Status | What is Fully Implemented | What Remains to be Done |
| :--- | :--- | :--- | :--- |
| **US1.01: Bi-Directional Task Selection & Control** | 🟡 **PARTIAL** | • Task control Hero card with Start, Pause, Resume, Complete.<br>• 2-Step Task Selection Modal (Project selection -> Task selection).<br>• Hardware button & wheel input decoder triggers.<br>• Hardware front display active task rendering (72×16 scrolling title). | • Clicking **"Finish & Log Hours"** does not dynamically push the completed session into the "Today's Worklog Queue" table on `App.tsx` (table currently uses static HTML). |
| **US1.02: Timestamp-Based Tracking & State Mirroring** | 🟢 **COMPLETE** | • UTC timestamp tracking engine calculating elapsed time via `(now - startTime - pausedDuration)`.<br>• Crash & reboot resilience via SQLite persistence.<br>• State mirroring across IPC and hardware WebSocket stream. | • None. Core engine is rock solid and fully verified. |
| **US1.03: Pluggable Providers & Offline Buffering** | 🟡 **PARTIAL** | • `ProviderManager` architecture for Jira, Notion, AdHoc.<br>• SQLite `worklog_sync_queue` table with offline auto-flush worker. | • **Task Retrieval:** `getTasks()` and `getProjects()` in `JiraProvider` and `NotionProvider` currently return static mock arrays instead of calling real REST APIs with user API tokens. |

---

### Epic 2: Unity Engine Workflow Integration

| User Story | Implementation Status | What is Fully Implemented | What Remains to be Done |
| :--- | :--- | :--- | :--- |
| **US2.01: Multi-Instance Compilation & Build Progress** | 🟡 **PARTIAL** | • Native HTTP Webhook Server listening on `http://127.0.0.1:39123`.<br>• Front display rendering compilation progress bars.<br>• Directory Junction scanner and auto-injector for Unity projects.<br>• Global `.gitignore` configuration. | • **Save Button & Persistence:** `UnityEngineView.tsx` lacks a "Save Settings" button to persist audio chime choices (`chime_1`, `retro_beep`) and Play Mode toggles into SQLite.<br>• **Live Heartbeat Telemetry:** "Active Unity Editor C# Plugin Status" card displays static text ("MyFantasyGame") instead of tracking real live webhooks sent from `packages/unity-plugin`. |
| **US2.02: Play-Mode Alert (Do Not Disturb)** | 🟢 **COMPLETE** | • Webhook endpoint `/api/v1/unity/playmode` and legacy `/unity/playmode` listeners.<br>• Front display "ON AIR" alert rendering with red LED indicator. | • Connect toggle state in `UnityEngineView.tsx` to active IPC settings. |
| **US2.03: Critical Unity Console Error Alert** | 🟢 **COMPLETE** | • Exception webhook handlers `/api/v1/unity/console` and `/unity/exception`.<br>• Front display error banner and red LED preemption. | • None. Backend handlers are operational. |

---

### Epic 3: Agile Ceremonies, Schedule & PC Automation

| User Story | Implementation Status | What is Fully Implemented | What Remains to be Done |
| :--- | :--- | :--- | :--- |
| **US3.01: Daily Stand-Up Prompt & Stopwatch** | 🟢 **COMPLETE** | • Dedicated `CeremoniesView.tsx` UI.<br>• Scheduled Stand-Up timer trigger.<br>• Front display stopwatch rendering (`STAND-UP STOPWATCH 00:08:42`). | • None. View and timer loops are functional. |
| **US3.02: Workstation Lock / Away State Sync** | 🟢 **COMPLETE** | • OS lock listener updating front display to `AWAY / LOCKED` while background clock continues uninterrupted. | • None. |
| **US3.03: Lunch Schedule & Notification Suppression** | 🟢 **COMPLETE** | • Lunch start & end time settings in `CeremoniesView.tsx`.<br>• Suppression rules in `TimeTrackingEngine`. | • None. |
| **US3.04: Interactive End-of-Day (EOD) Wrap-Up** | 🟢 **COMPLETE** | • `EodWrapUpModal.tsx` interactive sequence.<br>• IPC channel `TRIGGER_EOD_WRAP_UP`.<br>• Worklog summary generation and PC shutdown execution options. | • None. |

---

### Epic 4: Third-Party Notifications & Priority Engine

| User Story | Implementation Status | What is Fully Implemented | What Remains to be Done |
| :--- | :--- | :--- | :--- |
| **US4.01: Discord, Gmail & Slack Notifications** | 🔴 **NOT IMPLEMENTED** | • Visual integration cards in `MessagingView.tsx`. | • **No Live API Linking:** No background workers or webhooks exist to connect to Discord Bot Gateway/Webhooks, Slack Event Subscriptions, or Gmail OAuth2 API to poll/receive real messages. |
| **US4.02: Configurable Priority Rules Matrix** | 🟡 **PARTIAL** | • `PriorityRulesView.tsx` rendering preemption matrix.<br>• Preemption logic in `DisplayRenderer`. | • **Ordering & Drag-and-Drop:** Matrix rules are not sorted by priority descending, and there is no interactive drag handle (or up/down priority increment buttons) to adjust priority ranking. |

---

### Epic 5: Centralized PC Companion Dashboard

| User Story | Implementation Status | What is Fully Implemented | What Remains to be Done |
| :--- | :--- | :--- | :--- |
| **US5.01: Modular Settings & Keybindings** | 🟢 **COMPLETE** | • `HardwareRebindsView.tsx` with live input event test monitor.<br>• Custom input remapping persisted to SQLite. | • None. |
| **US5.02: Device Communication Manager** | 🟢 **COMPLETE** | • `DeviceDiagnosticsView.tsx` with sanitized offline handling (`Offline`, `N/A`, `Ping: --`).<br>• Background ping loop and rear OLED debug mode. | • None. |

---

## 3. Deep-Dive Analysis of the 5 User-Identified Gaps

### Gap 1: Priority Rules Matrix Ordering & Priority Re-ordering
- **Current State:** `PriorityRulesView.tsx` displays event rules in a static array.
- **Root Cause:** Missing a priority numerical field (`priorityScore: number`), a descending sort function (`.sort((a, b) => b.priorityScore - a.priorityScore)`), and UI grab handles / Up-Down priority adjustment controls with IPC persistence to `SettingsRepository`.

### Gap 2: Third-Party Messaging Backend Integration (Discord, Slack, Gmail)
- **Current State:** `MessagingView.tsx` allows entering Webhook URLs and API credentials, but clicking "Save Credentials" only triggers a local React state alert.
- **Root Cause:** Missing a `MessagingIntegrationService` in Electron main process that:
  1. Polls/listens to Discord Webhooks/Bot APIs.
  2. Receives Slack Incoming Webhook / Event API payloads on `/api/v1/slack/events`.
  3. Executes Gmail API OAuth2 queries (`is:unread label:urgent`) on a 30s background interval.
  4. Triggers front display text banner scrolling and purple/red LED flashing when urgent messages arrive.

### Gap 3: Unity Engine Settings Persistence & Live Editor Heartbeat
- **Current State:** `UnityEngineView.tsx` controls (build chime dropdown, failure sound toggle, Play Mode DND toggle) are not saved when changed, and the "Active Unity Editor C# Plugin Status" card shows a hardcoded string (`MyFantasyGame`).
- **Root Cause:** 
  1. Missing a **"Save Unity Settings"** button and IPC invocation (`window.electronAPI.saveUnitySettings`).
  2. Missing a heartbeat endpoint `/api/v1/unity/heartbeat` in `WebhookServer.ts` and a `UnityTelemetryTracker` service in Main process that tracks connected editor project names, compilation state, and heartbeat timestamps.

### Gap 4: Real Task Retrieval for Providers (Jira, Notion, Ad-Hoc)
- **Current State:** Task Selection Modal displays hardcoded sample tasks (`PROJ-142`, `PROJ-145`, `PROJ-149`).
- **Root Cause:** `JiraProvider.getTasks()` and `NotionProvider.getTasks()` return static arrays. Needs real REST API calls:
  - **Jira:** `GET /rest/api/3/search?jql=assignee=currentUser()+AND+statusCategory!=Done` using `domain`, `email`, and `apiToken`.
  - **Notion:** `POST /v1/databases/{database_id}/query` with `Notion-Version: 2022-06-28` header using `apiKey`.

### Gap 5: Finish & Log Hours UI Workflow & Worklog Table Refresh
- **Current State:** Clicking "Finish & Log Hours" calls `completeSession()`, which updates SQLite, but the "Today's Worklog Queue" table on `App.tsx` remains static.
- **Root Cause:** `App.tsx` renders static `<tr>` elements for `PROJ-140` and `ADHOC-01`. Needs a `useWorklogs()` hook that fetches today's worklogs from `WorklogRepository` via IPC and re-fetches whenever `completeSession()` or `sessionUpdated` fires.

---

## 4. Actionable Implementation Plan for Next Sprint / Tomorrow

### Component A: Dynamic Worklog Table & Finish Session Fix
1. **[MODIFY] [ipc-handler-registry.ts](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/main/ipc/ipc-handler-registry.ts):** Add IPC channel `GET_TODAYS_WORKLOGS` to return `worklogRepo.getWorklogsForDate(today)`.
2. **[MODIFY] [preload/index.ts](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/preload/index.ts):** Expose `getTodaysWorklogs()`.
3. **[NEW] [useWorklogs.ts](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/renderer/hooks/useWorklogs.ts):** Hook to fetch today's worklogs and auto-refresh when sessions complete.
4. **[MODIFY] [App.tsx](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/renderer/App.tsx):** Replace static HTML table in "Today's Worklog Queue" with dynamic rendering from `useWorklogs()`.

### Component B: Unity Engine View Save & Live Heartbeat
1. **[MODIFY] [webhook-server.ts](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/main/api/webhook-server.ts):** Add `/api/v1/unity/heartbeat` endpoint.
2. **[MODIFY] [UnityEngineView.tsx](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/renderer/views/Unity/UnityEngineView.tsx):** Add "Save Unity Settings" button with IPC persistence, and subscribe to real-time Unity heartbeat telemetry.

### Component C: Priority Rules Descending Re-Ordering
1. **[MODIFY] [PriorityRulesView.tsx](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/renderer/views/Priority/PriorityRulesView.tsx):** Sort rules descending by `priorityScore`. Add Up/Down grab buttons to increase/decrease rule priority and save matrix to SQLite.

### Component D: Real Task Retrieval for Jira & Notion Providers
1. **[MODIFY] [jira-provider.ts](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/main/providers/jira-provider.ts):** Implement `fetch` request to Jira REST API v3 `/rest/api/3/search`.
2. **[MODIFY] [notion-provider.ts](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/main/providers/notion-provider.ts):** Implement `fetch` request to Notion API `/v1/databases/{id}/query`.

### Component E: Third-Party Messaging Live Integration Service
1. **[NEW] [messaging-service.ts](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/main/services/messaging-service.ts):** Service in main process to store credentials, poll Gmail API, accept Slack/Discord webhooks, and trigger front display banner preemption via `DisplayRenderer`.
2. **[MODIFY] [MessagingView.tsx](file:///e:/Code/BUSY_Bar/packages/desktop-app/src/renderer/views/Messaging/MessagingView.tsx):** Wire save button and test alert buttons directly to `MessagingService` IPC.
