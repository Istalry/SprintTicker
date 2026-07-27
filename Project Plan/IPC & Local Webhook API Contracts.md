# BUSY Bar PC Companion App: IPC & Local Webhook API Contracts

**Document Purpose:** This document defines the strongly typed API contracts for the "Antigravity" BUSY Bar Companion system. It covers the Electron Inter-Process Communication (IPC) context bridge between the Renderer (React) and Main (Node.js) processes, as well as the local HTTP Webhook API hosted by the PC Companion app for Unity Engine and VS Code integrations.

## 1\. Electron IPC Channel Contracts (`Main <-> Preload <-> Renderer`)

The companion desktop app uses Electron's isolated context bridge (`contextBridge.exposeInMainWorld`). Direct access to Node.js APIs or native modules from the Renderer process is prohibited.

```
+--------------------------+                     +--------------------------+
|  Renderer Process (UI)   |  window.electronAPI |   Main Process (Node)    |
|                          | ------------------> |                          |
|  - Zustand State Store   |   ipcRenderer.invoke| - Time Tracking Engine   |
|  - React Dashboard       |                     | - SQLite Database        |
|  - Keybinding Config     | <------------------ | - BUSY Bar Hardware SDK  |
|                          |   ipcRenderer.on    | - Fastify Webhook Server |
+--------------------------+                     +--------------------------+
```

### 1.1 IPC Channel Enumeration

```
// packages/desktop-app/src/shared/ipc-channels.ts

export enum IPCChannel {
  // Session & Timer Controls
  GET_CURRENT_SESSION = 'session:get-current',
  START_TASK = 'session:start-task',
  PAUSE_SESSION = 'session:pause',
  RESUME_SESSION = 'session:resume',
  COMPLETE_SESSION = 'session:complete',
  DISCARD_SESSION = 'session:discard',
  ON_SESSION_UPDATED = 'session:on-updated',

  // Task Provider & Task Query
  GET_PROVIDERS = 'provider:get-all',
  SET_ACTIVE_PROVIDER = 'provider:set-active',
  GET_PROJECTS = 'provider:get-projects',
  GET_TASKS = 'provider:get-tasks',
  CREATE_AD_HOC_TASK = 'provider:create-adhoc',
  RECONCILE_REMOTE_STATE = 'provider:reconcile',

  // Hardware Input Rebindings
  GET_INPUT_BINDINGS = 'input:get-bindings',
  SAVE_INPUT_BINDINGS = 'input:save-bindings',
  ON_HARDWARE_INPUT_EVENT = 'input:on-hardware-event',

  // Priority Matrix & Display
  GET_PRIORITY_RULES = 'priority:get-rules',
  SAVE_PRIORITY_RULES = 'priority:save-rules',

  // Device Management & SDK
  GET_DEVICE_STATUS = 'device:get-status',
  SET_DEVICE_CONFIG = 'device:set-config',
  ON_DEVICE_STATUS_CHANGED = 'device:on-status-changed',

  // Ceremonies & Schedule
  GET_SCHEDULE_SETTINGS = 'schedule:get-settings',
  SAVE_SCHEDULE_SETTINGS = 'schedule:save-settings',
  TRIGGER_EOD_WRAP_UP = 'schedule:trigger-eod-wrapup',
  ON_CEREMONY_PROMPT = 'schedule:on-ceremony-prompt'
}
```

### 1.2 Preload Context Bridge Type Definition (`window.electronAPI`)

```
// packages/desktop-app/src/preload/index.ts

import { IpcRendererEvent } from 'electron';
import { 
  ActiveSessionDTO, 
  TaskDTO, 
  ProjectDTO, 
  HardwareBindingConfig, 
  DeviceStatusDTO,
  PriorityMatrixConfig,
  ScheduleSettingsDTO 
} from '../shared/dtos';

export interface IElectronAPI {
  // Session Controls
  getCurrentSession: () => Promise<ActiveSessionDTO | null>;
  startTask: (taskId: string, isAdHoc?: boolean, customTitle?: string) => Promise<ActiveSessionDTO>;
  pauseSession: () => Promise<ActiveSessionDTO>;
  resumeSession: () => Promise<ActiveSessionDTO>;
  completeSession: (comment?: string) => Promise<{ success: boolean; loggedSeconds: number }>;
  discardSession: () => Promise<boolean>;
  onSessionUpdated: (callback: (session: ActiveSessionDTO | null) => void) => () => void;

  // Providers & Tasks
  getProjects: () => Promise<ProjectDTO[]>;
  getTasks: (projectId: string) => Promise<TaskDTO[]>;
  reconcileRemoteState: () => Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }>;

  // Hardware Rebindings
  getInputBindings: () => Promise<HardwareBindingConfig>;
  saveInputBindings: (config: HardwareBindingConfig) => Promise<boolean>;
  onHardwareInputEvent: (callback: (event: { inputKey: string; actionAssigned: string }) => void) => () => void;

  // Priority Rules
  getPriorityRules: () => Promise<PriorityMatrixConfig>;
  savePriorityRules: (config: PriorityMatrixConfig) => Promise<boolean>;

  // Device Management
  getDeviceStatus: () => Promise<DeviceStatusDTO>;
  onDeviceStatusChanged: (callback: (status: DeviceStatusDTO) => void) => () => void;

  // Schedule & Ceremonies
  getScheduleSettings: () => Promise<ScheduleSettingsDTO>;
  saveScheduleSettings: (settings: ScheduleSettingsDTO) => Promise<boolean>;
  triggerEodWrapUp: () => Promise<{ success: boolean; savedUnityScenes: boolean; savedVSCode: boolean }>;
  onCeremonyPrompt: (callback: (prompt: { type: 'STANDUP' | 'LUNCH' | 'EOD'; title: string }) => void) => () => void;
}
```

### 1.3 Data Transfer Objects (DTOs)

```
// packages/desktop-app/src/shared/dtos.ts

export interface ActiveSessionDTO {
  sessionId: string;
  projectId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  isAdHoc: boolean;
  status: 'TRACKING' | 'PAUSED' | 'COMPLETED';
  startTimeUtc: string; // ISO 8601
  totalPausedSeconds: number;
  elapsedSeconds: number; // Calculated on Main process
  lastPauseStartUtc?: string;
}

export interface TaskDTO {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
}

export interface ProjectDTO {
  id: string;
  name: string;
  key: string;
}

export interface HardwareBindingConfig {
  startButtonPress: string;
  wheelRotateLeft: string;
  wheelRotateRight: string;
  wheelClick: string;
  backButtonShortPress: string;
  backButtonLongPress: string;
}

export interface DeviceStatusDTO {
  connected: boolean;
  ipAddress: string;
  connectionType: 'usb' | 'wifi';
  frontBrightness: number;
  backBrightness: number;
  batteryPercent: number;
  firmwareVersion: string;
  webSocketPingMs: number;
}

export interface ScheduleSettingsDTO {
  standupTime: string; // "10:00"
  enableStandupPrompt: boolean;
  lunchStartTime: string; // "12:30"
  lunchEndTime: string; // "13:30"
  enableLunchMute: boolean;
  eodWrapUpTime: string; // "18:00"
  promptTimeoutSeconds: number; // 0 for indefinite
}
```

## 2\. Local HTTP Webhook API Specification (Main Process)

The Electron Main process hosts an embedded **Fastify HTTP Server** listening on `http://localhost:8080`. External IDEs (Unity Editor script, VS Code extension) post telemetry events to this server.

```
+-------------------------------+                  +-------------------------------+
| Unity Editor (C# Extension)   |                  | Fastify Webhook Server (Node) |
| com.antigravity.busybar       | -- HTTP POST --> | Listening on localhost:8080   |
+-------------------------------+                  +-------------------------------+
                                                                  |
                                                                  v
                                                   +-------------------------------+
                                                   | PriorityDispatcher Engine     |
                                                   | Evaluates State & Rules Matrix|
                                                   +-------------------------------+
                                                                  |
                                                                  v
                                                   +-------------------------------+
                                                   | BUSY Bar Hardware REST Client |
                                                   | /busybar/display/draw         |
                                                   +-------------------------------+
```

### 2.1 Security & Local Boundary

-   **Host Binding:** `127.0.0.1` (localhost only). External network interfaces are rejected.
    
-   **Headers:** Requests may optionally include header `X-Antigravity-Source: unity-editor | vscode`.
    

### 2.2 Unity Webhook Endpoints

#### Endpoint 1: Compile Started

-   **Route:** `POST /unity/compile-start`
    
-   **Request Body:**
    

```
{
  "project": "MyFantasyGame",
  "unityVersion": "2022.3.10f1",
  "timestampUtc": "2026-07-27T09:30:00.000Z"
}
```

-   **Response:** `200 OK` `{"status": "ACCEPTED"}`
    
-   **Action:** Dispatches `UNITY_COMPILING` display payload to BUSY Bar with blue progress bar layout (Priority 60).
    

#### Endpoint 2: Compile Finished

-   **Route:** `POST /unity/compile-finish`
    
-   **Request Body:**
    

```
{
  "project": "MyFantasyGame",
  "success": true,
  "elapsedSeconds": 14.2,
  "errorCount": 0,
  "warningCount": 3
}
```

-   **Response:** `200 OK` `{"status": "ACCEPTED"}`
    
-   **Action:**
    
    -   If `success: true`: Plays success chime (`/busybar/audio/play`), blinks green LED, then clears after 3s.
        
    -   If `success: false`: Plays error chime, blinks red LED, displays error count banner (Priority 80).
        

#### Endpoint 3: Play Mode State Changed

-   **Route:** `POST /unity/playmode`
    
-   **Request Body:**
    

```
{
  "project": "MyFantasyGame",
  "state": "EnteredPlayMode" // "EnteredPlayMode" | "ExitedPlayMode"
}
```

-   **Response:** `200 OK` `{"status": "ACCEPTED"}`
    
-   **Action:**
    
    -   `EnteredPlayMode`: Triggers "ON AIR" red display mode (Priority 70).
        
    -   `ExitedPlayMode`: Reverts to lower priority display (Active Task Tracker).
        

#### Endpoint 4: Critical Console Exception

-   **Route:** `POST /unity/exception`
    
-   **Request Body:**
    

```
{
  "project": "MyFantasyGame",
  "exceptionType": "NullReferenceException",
  "message": "Object reference not set to an instance of an object",
  "stackTrace": "at PlayerController.Update () [0x00012] in ..."
}
```

-   **Response:** `200 OK` `{"status": "ACCEPTED"}`
    
-   **Action:** Flashes Red LED (`#FF0000FF`) and renders exception banner on front LED screen (Priority 80).
    

## 3\. End-of-Day EOD Automation Webhook (PC App -> Unity)

During the optional End-of-Day wrap-up sequence, the PC Companion App acts as an HTTP client and issues a command to Unity's local listener.

-   **Route:** `POST http://localhost:8081/antigravity/save-scenes`
    
-   **Headers:** `Content-Type: application/json`
    
-   **Timeout:** 2000 ms  
    
-   **Expected Response from Unity C# Script:** `200 OK`
    

```
{
  "result": "OK",
  "savedScenes": ["Assets/Scenes/MainLevel.unity", "Assets/Scenes/HUD.unity"]
}
```

-   **Degradation Handling:** If `localhost:8081` connection is refused (Unity not running or plugin missing), the PC Companion App logs `Unity project not active, skipping scene save` and continues execution without throwing errors.
    

## 4\. WebSocket Hardware Input Dispatching Protocol

The Electron Main process subscribes to the BUSY Bar's native WebSocket (`/busybar/status/ws`) via `@busy-app/busy-lib` `LocalStateStream`.

### 4.1 Input Event Decoding & Rebinding Logic

```
+----------------------------+
|  BUSY Bar Physical Input   |
|  (Wheel Scroll, Button OK) |
+----------------------------+
              |
              v Protobuf WS Stream
+----------------------------+
| Main Process Input Handler |
+----------------------------+
              |
              | 1. Look up user binding from SQLite
              v
+-----------------------------------------------------------+
| Configured Action Execution                               |
| - Toggle Start/Pause                                      |
| - Send IPC 'input:on-hardware-event' to Renderer UI       |
| - Trigger Task Selection Popup Modal on Desktop Screen    |
+-----------------------------------------------------------+
```

### 4.2 Raw Key Mapping Table

| 
Physical Hardware Event

 | 

Protobuf Key Name

 | 

Default Rebind Action

 |
| --- | --- | --- |
| 

**Start/Pause Button**

 | 

`start` / `ok`

 | 

`TOGGLE_TRACK_PAUSE`

 |
| 

**Scroll Wheel Click**

 | 

`ok`

 | 

`TRIGGER_TASK_SELECTOR_MODAL`

 |
| 

**Scroll Wheel Left**

 | 

`up`

 | 

`NAVIGATE_QUEUE_PREV`

 |
| 

**Scroll Wheel Right**

 | 

`down`

 | 

`NAVIGATE_QUEUE_NEXT`

 |
| 

**Back Button Short**

 | 

`back`

 | 

`DISMISS_NOTIFICATION_ALERT`

 |
| 

**Back Button Long (1.5s)**

 | 

`back_hold`

 | 

`COMPLETE_AND_LOG_ACTIVE_TASK`

 |