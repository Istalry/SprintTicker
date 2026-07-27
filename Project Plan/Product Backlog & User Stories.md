# BUSY Bar PC Companion App: Agile Unity Developer

## Product Backlog & User Stories

**Document Purpose:** This document defines the refined user stories for the "Antigravity" BUSY Bar PC Companion Application. It incorporates game development workflow triggers, Agile ceremonies, automated system actions, notification routing, provider abstraction, hardware constraints, timestamp-based session persistence, external state reconciliation, multi-instance Unity support, and customizable hardware input keybindings.

## Epic 1: Bi-Directional Task Management & Timestamp Time Tracking

### US1.01: Bi-Directional Task Selection & Control (Desktop UI & Physical Hardware)

-   **User Story:** As a developer, I want complete parity between the PC Companion desktop interface and the physical BUSY Bar hardware controls, so that I can select tasks, start, pause, resume, and stop sessions interchangeably from my computer screen or the physical device.
    
-   **Acceptance Criteria:**
    
    -   **Dual Control Capability:**
        
        -   **PC Desktop UI:** The PC Companion App features an accessible Task Control overlay/widget allowing the user to browse projects, pick tasks (or create custom "+ Other / Ad-Hoc" tasks), start, pause, resume, and stop tracking with a single click.
            
        -   **Physical BUSY Bar:** Physical wheel and button interactions support **Start**, **Pause**, **Resume**, **Stop**, and **Request New Task** (keybindings customizable in PC App Settings).
            
    -   **Desktop Selection Flow:** Pressing "Request New Task" on the BUSY Bar (or initiating task change in the PC App) triggers a 2-step desktop modal window:
        
        -   **Step 1:** Select Project or choose **"+ Other / Ad-Hoc"**.
            
        -   **Step 2:** Select specific Task under that project (or enter custom title for Ad-Hoc work).
            
    -   **Ad-Hoc / Custom Task Provider Mapping:**
        
        -   When an Ad-Hoc task is selected, time is logged against a configurable **"Fallback / Overhead Ticket ID"** (e.g., `MISC-1` or `ADMIN-1`) set in the Provider Settings, with the custom task title included in the worklog comment/description.
            
    -   **Bi-Directional State Synchronization:**
        
        -   Triggering any action on the PC desktop UI updates the BUSY Bar front display, LED, and internal state instantly via HTTP/WebSocket.
            
        -   Triggering any physical button/wheel operation on the BUSY Bar updates the PC Companion desktop UI in real time.
            
    -   **Screen Constraint:** Front display renders only one active task at a time (`Project Name` on row 1, `Task Title` on row 2) and auto-scrolls text longer than 72px.
        

### US1.02: Timestamp-Based Reboot-Proof Tracking & State Mirroring

-   **User Story:** As a developer, I want active time tracking to be reboot-proof and based on absolute timestamps, so system restarts, locks, or crashes never corrupt active task duration logs, regardless of whether action was initiated on PC or hardware.
    
-   **Acceptance Criteria:**
    
    -   Toggling state (via PC Desktop App or physical BUSY Bar Start/Pause button) switches between `TRACKING` and `PAUSED`.
        
    -   Time tracking is calculated via UTC timestamps (`start_time`, `end_time`, `paused_intervals: [{start, end}]`) rather than in-memory tick counts.
        
    -   If the PC reboots, crashes, or enters sleep mode while tracking, restarting the PC companion app accurately recalculates exact elapsed duration without data corruption.
        
    -   RGB LED breathes Yellow (`#FFFF00FF`) when paused and shines solid Red (`#FF0000FF`) or Green (`#00FF00FF`) when active.
        
-   **Implementation Notes:**
    
    -   State persistence is written to local SQLite / JSON storage on every state transition.
        

### US1.03: Pluggable Providers, External State Reconciliation & Offline Buffering

-   **User Story:** As a developer, I want a generic provider architecture for time tracking and task fetching that handles offline work and cross-PC usage safely, so my logged hours are never lost or overwritten.
    
-   **Acceptance Criteria:**
    
    -   **Generic Interface (`ITaskProvider`):** Abstract interface defines methods `getProjects()`, `getTasks(projectId)`, and `logTime(taskId, durationSeconds, comment)`. Switching providers (Jira, Google Sheets, Notion, Toggl, Custom REST) in settings immediately re-routes task listing and worklog submissions.
        
    -   **Startup Remote Reconciliation:** Upon PC App launch, the app fetches remote task statuses and existing worklogs/timestamps from the active provider. If work was done on another computer without this companion app, the local state reconciles with the remote provider to avoid overwriting tasks or logging duplicate/conflicting time.
        
    -   **Offline Worklog Buffering:** If an internet outage or provider endpoint failure occurs when finalizing a session, worklogs are saved locally to a retry queue and automatically synced once network connectivity is restored.
        
    -   **Mandatory EOD Session Finalization:** When executing the End-of-Day wrap-up sequence, any active running task session is automatically stopped and its worklog submitted/queued before PC shutdown.
        

## Epic 2: Unity Engine Workflow Integration (Resilient Architecture)

-   **Architecture Principle (Resilience):** All Unity Engine interactions are non-blocking. If the Unity Editor script is not placed in the target Unity project, the PC Companion Application continues running smoothly in degraded mode, flagging the plugin as "Disconnected" in dashboard diagnostics without interrupting general task tracking.
    

### US2.01: Multi-Instance Script Compilation & Build Progress Tracking

-   **User Story:** As a Unity developer working on one or multiple Unity projects, I want the BUSY Bar to identify the project name and show compilation/build progress with configurable audio/visual notifications.
    
-   **Acceptance Criteria:**
    
    -   **Multi-Instance Context:** The Unity C# plugin attaches `Application.productName` to all IPC payloads. The display indicates project context (e.g., _"MyGame: Compiling..."_).
        
    -   Displays "Compiling..." or build percentage bar (`RectangleElement`) when compilation events arrive over IPC.
        
    -   On build completion, conditionally plays a completion sound based on user settings in the PC app.
        
    -   On build failure, flashes red LED (`#FF0000FF`) and plays an alert sound.
        
    -   If Unity plugin is absent, task tracking operates normally without compilation telemetry.
        
-   **Implementation Notes:**
    
    -   **Unity Side:** `[InitializeOnLoad]` Unity Editor script hooked to `CompilationPipeline.compilationStarted` and `compilationFinished`.
        

### US2.02: Play-Mode Alert (Do Not Disturb)

-   **User Story:** As a developer, I want entering Unity Play Mode to automatically broadcast a "Do Not Disturb / Testing" status on the BUSY Bar.
    
-   **Acceptance Criteria:**
    
    -   Entering Play Mode sets an "ON AIR" / "GAME TESTING" display mode on front screen, tagged with the active Unity project name.
        
    -   Exiting Play Mode reverts display to the current active task tracker without stopping the active session clock.
        

### US2.03: Critical Unity Console Error Alert

-   **User Story:** As a developer, I want immediate visual alerts on the BUSY Bar when a critical exception occurs in Unity.
    
-   **Acceptance Criteria:**
    
    -   Catching `LogType.Exception` flashes the project name and exception class name on the front display.
        

## Epic 3: Agile Ceremonies, Schedule & PC Automation

### US3.01: Daily Stand-Up Prompt & Elapsed Stopwatch Tracking

-   **User Story:** As a team member, I want a scheduled daily stand-up alert that asks if I wish to track the stand-up, using an incremental stopwatch to monitor meeting duration.
    
-   **Acceptance Criteria:**
    
    -   At user-configured stand-up time (e.g., 10:00 AM), PC App pops up a confirmation dialog: _"Daily Stand-Up starting. Track 'Daily Stand-Up' task?"_
        
    -   **Wait / Timeout Behavior:** Dialog waits indefinitely by default for user interaction. If auto-dismiss is enabled in app settings, the dialog auto-dismisses after X seconds (where X is configurable).
        
    -   If accepted: Active task is auto-paused, a "Daily Stand-Up" task begins tracking, and BUSY Bar renders an incremental stopwatch (`CountdownElement` with `direction: "time_since"`).
        
    -   If declined/dismissed: Alert clears and active task continues uninterrupted.
        

### US3.02: Workstation Lock / Away State Sync & Debug Back Display Strategy

-   **User Story:** As a user whose BUSY Bar faces away from the wall, I want primary status changes shown on the front display without interrupting the background timer, and debug information kept on the back display.
    
-   **Acceptance Criteria:**
    
    -   Locking Windows/macOS (`Win + L` or sleep) updates the **Front Display** to "AWAY / LOCKED".
        
    -   **Timer Uninterrupted:** System lock/away state updates the visual UI display but **does NOT pause or corrupt active task timestamp calculations** in the background.
        
    -   **Back Display Usage:** Reserved exclusively for low-priority debug and diagnostic information (e.g., local IP address, WebSocket reconnect count, system metrics, memory status). No user-critical status notifications are routed exclusively to the rear display.
        
    -   Unlocking PC restores the active task front UI instantly.
        

### US3.03: Lunch Schedule & Notification Suppression

-   **User Story:** As a user, I want to define daily lunch hours so BUSY Bar updates my status and silences routine alerts automatically.
    
-   **Acceptance Criteria:**
    
    -   Configurable Lunch Start and End times in PC app (e.g., 12:30 PM - 1:30 PM).
        
    -   At Lunch Start: Front display updates to "LUNCH BREAK", active task pauses, chat alerts are muted.
        
    -   At Lunch End: BUSY Bar plays a gentle chime to prompt resuming work.
        

### US3.04: Interactive End-of-Day Automated Wrap-Up Sequence

-   **User Story:** As a developer, I want an optional interactive end-of-day wrap-up dialog prompting me to execute a wrap-up script that saves my work, finalizes task sessions, and turns off the PC.
    
-   **Acceptance Criteria:**
    
    -   At configured EOD time (e.g., 6:00 PM), PC App displays a prominent dialog: _"Execute End-of-Day Wrap-Up & Shutdown?"_ with buttons:
        
        ExecuteNow
        
        ,
        
        Snooze15m
        
        ,
        
        Cancel
        
        .
        
    -   **Wait / Timeout Behavior:** By default, the dialog stays open and waits indefinitely for user choice. If configured in settings, auto-dismiss or auto-execute triggers after X seconds.
        
    -   If
        
        ExecuteNow
        
        (or auto-confirmed after timeout):
        
        1.  Stops and finalizes any active running task session and posts worklogs to the active Provider.
            
        2.  If Unity plugin is installed, saves open scenes (`EditorSceneManager.SaveOpenScenes()`); if uninstalled, skips gracefully.
            
        3.  Instructs VS Code extension / workspace script to save dirty files (`workbench.action.files.saveAll`).
            
        4.  Displays "Day Complete!" on front screen with success chime.
            
        5.  Initiates PC shutdown sequence.
            

## Epic 4: Third-Party Notifications & Priority Engine

### US4.01: Discord, Gmail & Slack Notifications

-   **User Story:** As a developer, I want incoming messages from Discord, Gmail, and Slack to show subtle alerts on the BUSY Bar front display and status LED.
    
-   **Acceptance Criteria:**
    
    -   Connectors for Discord Webhooks/Bot, Gmail API, and Slack Webhooks.
        
    -   Incoming high-priority message flashes the LED in brand color (Discord: Purple, Slack: Red/Aubergine, Gmail: Red).
        
    -   Displays sender name and preview text on front screen using scrolling text.
        

### US4.02: Configurable Priority & Status Preemption Rules

-   **User Story:** As a user, I want to customize notification priority rules so that alerts are shown only when appropriate.
    
-   **Acceptance Criteria:**
    
    -   **Priority Hierarchy Matrix (Configurable in Dashboard):**
        
        1.  Unity Build Failure / Emergency Alert (`Priority 100`) -> _Always Displays_
            
        2.  Unity Compiling / Building (`Priority 80`) -> _Displays over notifications_
            
        3.  Daily Stand-up Prompt (`Priority 70`) -> _Displays over notifications_
            
        4.  Discord / Slack / Gmail Messages (`Priority 40`) -> _Suppressed during LUNCH and AWAY states; Displayed during active work_
            
        5.  Active Task Tracker / Idle Status (`Priority 10–20`) -> _Base layer_
            
    -   Notifications arriving while in "LUNCH" or "AWAY" state are queued silently without flashing LED or playing sound.
        

## Epic 5: Centralized PC Companion Dashboard

### US5.01: Modular Multi-Bar Settings, Live Control Dashboard & Hardware Keybindings

-   **User Story:** As a user, I want a centralized PC desktop application featuring live session controls, dedicated settings tabs, and configurable physical hardware input keybindings.
    
-   **Acceptance Criteria:**
    
    -   **Desktop Control Widget / Floating Bar:** Persistent desktop controls to select active project/task, start, pause, resume, and stop session tracking directly from the PC mouse/keyboard.
        
    -   **Navigation Bar / Settings Modules:**
        
        -   ⏱️ **Task & Session Manager:** Active task viewer, manual time adjustment, ad-hoc fallback ticket key (`MISC-1`), and project/task selection modal triggers.
            
        -   🔌 **Time & Task Provider:** Select active provider (Jira, Google Sheets, Notion, Custom REST), enter credentials, manage project filters, configure startup reconciliation options.
            
        -   🎛️ **Hardware Input Control Panel:** Dedicated configuration tab allowing user to rebind physical BUSY Bar inputs (Start/Pause button press, Scroll Wheel click, Scroll Wheel rotate, Back button short/long press) to custom actions (e.g., Toggle Pause, Trigger Task Selection Modal, Dismiss Notification, Complete Task Session).
            
        -   🎮 **Unity Integration:** Toggle compile sound, set build chime audio file, check plugin installation status.
            
        -   📅 **Ceremonies & Schedule:** Set Daily Stand-up time, Lunch Start/End, EOD wrap-up actions, and prompt timeout limits (X seconds or indefinite wait).
            
        -   💬 **Messaging Integrations:** Configure API keys/tokens for Discord, Gmail, and Slack.
            
        -   🎛️ **Priority & Rules Manager:** Visual matrix to dictate which notifications interrupt which states.
            
        -   🔌 **BUSY Bar Device:** IP Address, Wi-Fi keys, front brightness sliders, back display debug info toggles, WebSocket status indicator.
            

### US5.02: Device Communication Manager

-   **User Story:** As a PC App, I need to seamlessly maintain both HTTP API requests and WebSocket `StateStream` listeners with the BUSY Bar.
    
-   **Acceptance Criteria:**
    
    -   Auto-reconnects over local network IP or USB virtual ethernet (`10.0.4.20`).
        
    -   Handles authentication via `X-API-Token` header for Wi-Fi or local network key.