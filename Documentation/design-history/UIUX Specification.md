> [!NOTE]
> **Historical design document — not maintained.**
>
> This is a pre-implementation design document, kept for provenance. It
> describes what the system was intended to be, not what was built. Where it
> and the code disagree, **the code is right**.
>
> Known divergences across this set: the HTTP server is Node's built-in `http` module on
> `127.0.0.1:39123`, not Fastify on `localhost:8080`; the `PriorityLevel` enum
> described here was never implemented under any name; the VS Code integration
> was never built; and the rear OLED is preview-only. For current behaviour see
> [README.md](../../README.md) and [CLAUDE.md](../../CLAUDE.md).

# BUSY Bar PC Companion App: UI/UX Specification

**Document Purpose:** This document defines the user interface (UI) design system, layout wireframes, user interaction flows, component hierarchy, modular settings tabs, and physical display pixel templates for the "Antigravity" BUSY Bar PC Companion Application.

## 1\. Visual Language & Design System

The desktop companion app uses a sleek, high-contrast dark theme designed specifically for software developers and game creators. It mirrors the aesthetic of modern IDEs, engine editors (Unity/Unreal), and physical dark-mode electronics.

### 1.1 Palette & Color Tokens

| 
Token Name

 | 

Hex Code

 | 

Purpose / Application

 |
| --- | --- | --- |
| 

`bg-dark-900`

 | 

`#0D0F12`

 | 

Main application background

 |
| 

`bg-dark-800`

 | 

`#16191E`

 | 

Sidebar, card containers, modal overlays

 |
| 

`bg-dark-700`

 | 

`#21262E`

 | 

Input fields, button rest state, table headers

 |
| 

`border-dark`

 | 

`#2D3440`

 | 

Subtle component borders and dividers

 |
| 

`accent-green`

 | 

`#10B981`

 | 

Active task tracking, success states, green LED

 |
| 

`accent-amber`

 | 

`#F59E0B`

 | 

Paused task status, warning alerts, yellow LED

 |
| 

`accent-blue`

 | 

`#3B82F6`

 | 

Unity compiling status, info badges, blue LED

 |
| 

`accent-red`

 | 

`#EF4444`

 | 

Unity compilation failure, critical exception, red LED

 |
| 

`accent-purple`

 | 

`#8B5CF6`

 | 

Discord/Slack messaging notifications, purple LED

 |
| 

`text-primary`

 | 

`#F3F4F6`

 | 

Main headers, active labels, primary text

 |
| 

`text-secondary`

 | 

`#9CA3AF`

 | 

Subtitles, inactive menu items, timestamps

 |

### 1.2 Typography & Iconography

-   **Font Family:** `JetBrains Mono` or `Inter` for clean readability across data tables, timer clocks, and control panels.
    
-   **Icon Library:** `Lucide React` (crisp, vector icons matching developer tools).
    
-   **Hardware Screen Fonts (Front** 72×16 **LED):** Built-in bitmap ASCII fonts (`tiny`, `small`, `normal`, `condensed`, `bold`, `large`, `extra_large`).
    

## 2\. Desktop Application Component Hierarchy

The desktop companion application is divided into three core functional regions:

```
+-----------------------------------------------------------------------------------+
| Top Navigation Bar: App Title | BUSY Bar Connection Badge | Quick Task Control    |
+-------------------+---------------------------------------------------------------+
| Sidebar Navigation| Main Workspace Panel                                          |
|                   |                                                               |
|  ⏱️ Active Session|  [ Active Task Hero Card ]                                    |
|  🔌 Task Provider |  - Task Key & Title                                           |
|  🎛️ Hardware Inputs| - UTC Elapsed Stopwatch ($00:42:15$)                         |
|  🎮 Unity Engine  |  - [ Start / Pause ]  [ Complete ]  [ Switch Task ]           |
|  📅 Ceremonies    |                                                               |
|  💬 Messaging     |  [ Module Content Area ]                                      |
|  ⚡ Priority Rules|  (Renders selected module settings or live dashboard)         |
|  🖥️ Device Hardware|                                                              |
+-------------------+---------------------------------------------------------------+
```

## 3\. Screen Layouts & Desktop Wireframes

### 3.1 Main Dashboard & Active Task Hero Card

When the application is active, the top section always displays the live task hero card, giving immediate visibility and control over the active session.

```
+-----------------------------------------------------------------------------------+
| 🟢 BUSY Bar: Connected (10.0.4.20)  |  Sync Status: Synced  |  [⚙️ Settings]     |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  CURRENT SESSION                                                                  |
|  +-----------------------------------------------------------------------------+  |
|  |  [PROJ-142] Implement Player Character Dash Mechanics                       |  |
|  |                                                                             |  |
|  |  Elapsed Time:  01 : 24 : 38  (UTC)                Status: 🟢 TRACKING      |  |
|  |                                                                             |  |
|  |  [ ⏸️ Pause ]   [ ⏹️ Finish & Log Hours ]   [ 🔄 Switch / New Task ]       |  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
|  TODAY'S WORKLOG QUEUE                                                            |
|  +-----------------------------------------------------------------------------+  |
|  | Task ID   | Description                        | Duration | Provider Status |  |
|  +-----------+------------------------------------+----------+-----------------+  |
|  | PROJ-140  | Fix Enemy Spawner Memory Leak      | 02h 15m  | 🟢 Synced (Jira)|  |
|  | ADHOC-01  | Sprint Planning & Stand-up         | 00h 45m  | 🟢 Synced (Misc)|  |
|  | PROJ-142  | Implement Dash Mechanics (Active)  | 01h 24m  | 🟡 In Progress  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 3.2 2-Step Task Selection Modal (Desktop Screen Popup)

Triggered either by clicking **"Switch / New Task"** on the desktop UI or pressing the **"Request New Task"** shortcut on the physical BUSY Bar.

#### Step 1: Select Project or Ad-Hoc

```
+-------------------------------------------------------------+
| Select Target Project                                   [X] |
+-------------------------------------------------------------+
| Choose a project from your active provider (Jira):          |
|                                                             |
|  (•) PROJ - Core Gameplay Engine                            |
|  ( ) UI   - Main Menu & HUD Redesign                        |
|  ( ) SHDR - Custom Shader Pipeline                          |
|                                                             |
|  [ + Create Custom / Ad-Hoc Task ]                          |
|                                                             |
|                                        [ Cancel ] [ Next > ]|
+-------------------------------------------------------------+
```

#### Step 2: Select Sprint Task or Enter Ad-Hoc Title

```
+-------------------------------------------------------------+
| Select Task under [PROJ - Core Gameplay Engine]         [X] |
+-------------------------------------------------------------+
| Search/Select Task:                                         |
| +---------------------------------------------------------+ |
| | PROJ-142: Implement Player Character Dash Mechanics     | |
| | PROJ-145: Fix RigidBody Collision Jitter on Slope       | |
| | PROJ-149: Add Audio Fmod Hooks for Footsteps            | |
| +---------------------------------------------------------+ |
|                                                             |
| * If Ad-Hoc selected:                                       |
|   Custom Task Title: [ e.g. Code Review with Lead        ]  |
|   Will log time under fallback ticket: MISC-1               |
|                                                             |
|                                         [ < Back ] [ Start ]|
+-------------------------------------------------------------+
```

## 4\. Modular Settings Panels ("1 Bar per Function")

The left sidebar navigation offers discrete settings modules:

### 4.1 ⏱️ Task & Provider Module

-   **Active Provider Dropdown:** Jira / Google Sheets / Notion / Custom REST / Ad-Hoc Only.
    
-   **Credentials & Endpoints:** Domain URL, API Token, Username/Email, Project Keys.
    
-   **Ad-Hoc Fallback Ticket Key:** Default fallback ID (e.g., `MISC-1` or `ADMIN-1`) for non-sprint work.
    
-   **Startup Reconciliation Toggle:** `[x]` Fetch remote task updates on launch to prevent state overwrite.
    

### 4.2 🎛️ Hardware Input Control Panel

Allows rebinding physical BUSY Bar inputs to custom app actions:

```
+-----------------------------------------------------------------------------------+
| Physical Hardware Input Rebinding                                                 |
+-----------------------------------------------------------------------------------+
| Physical Input             | Assigned Desktop Action                              |
+----------------------------+------------------------------------------------------+
| Start/Pause Button Press   | [ Toggle Start / Pause Tracking                    v]|
| Scroll Wheel Rotate Left   | [ Previous Task in Queue / Decrement               v]|
| Scroll Wheel Rotate Right  | [ Next Task in Queue / Increment                   v]|
| Scroll Wheel Click (OK)    | [ Trigger 2-Step Task Selection Modal              v]|
| Back Button Short Press    | [ Dismiss Current Notification / Alert             v]|
| Back Button Long Press (2s)| [ Stop Session & Complete Active Task              v]|
+-----------------------------------------------------------------------------------+
```

### 4.3 🎮 Unity Integration Module

-   **Webhook Server Status:** Listening on `http://localhost:8080/unity` (Status: 🟢 Active).
    
-   **Compile Completion Audio Chime:** Dropdown selection (`Success Chime 1`, `Retro Beep`, `Custom Asset`).
    
-   **Unity Plugin Status:** `[ Detect Plugin ]` → _"Connected to Unity Editor Project: MyFantasyGame"_
    
-   **Play Mode Do Not Disturb:** `[x]` Enable "ON AIR" mode automatically when entering Play Mode.
    

### 4.4 📅 Ceremonies & Schedule Module

-   **Daily Stand-Up Time:** `10:00 AM` | `[x]` Prompt to track stand-up stopwatch.
    
-   **Lunch Hours:** Start `12:30 PM` | End `01:30 PM` | `[x]` Mute routine notifications during lunch.
    
-   **End-of-Day Wrap-Up Time:** `06:00 PM` | `[x]` Prompt for interactive wrap-up sequence.
    
-   **Prompt Timeout Limit:** Dropdown (`Wait Indefinitely (Default)` / `Auto-Dismiss after 60s` / `Auto-Execute after 120s`).
    

### 4.5 💬 Messaging Integrations Module

-   **Discord Integration:** Bot Token / Webhook URL | `[x]` Flash Purple LED on high-priority tag.
    
-   **Slack Integration:** User OAuth Token / Webhook URL | `[x]` Show sender preview text on front display.
    
-   **Gmail Integration:** OAuth2 Client Credentials | Filter query (`is:unread label:urgent`).
    

### 4.6 ⚡ Priority & Rules Manager Matrix

A visual matrix controlling which alerts pre-empt display states:

```
+-----------------------------------------------------------------------------------+
| Priority Preemption Rules Matrix                                                  |
+-----------------------------------------------------------------------------------+
| Incoming Event             | Active State: WORK   | Active State: LUNCH | AWAY/LOCKED |
+----------------------------+---------------------+---------------------+-------------+
| Unity Compilation Error    | 🟢 Display Alert    | 🔴 Suppress         | 🔴 Suppress |
| Unity Compiling Progress   | 🟢 Display Progress | 🔴 Suppress         | 🔴 Suppress |
| Daily Stand-Up Prompt      | 🟢 Display Prompt   | 🔴 Suppress         | 🔴 Suppress |
| Discord / Slack / Gmail    | 🟢 Display Banner   | 🔴 Queue Silently   | 🔴 Suppress |
+-----------------------------------------------------------------------------------+
```

### 4.7 🖥️ BUSY Bar Device Module

-   **Connection Target:** IP Address (`10.0.4.20` USB Ethernet or local Wi-Fi LAN IP).
    
-   **Wi-Fi Credentials & Password:** Wi-Fi SSID and HTTP API Access Key.
    
-   **Display Brightness:** Front LED Slider (0−100%) | Rear OLED Slider (0−100%) | `[x]` Auto-brightness.
    
-   **Rear OLED Display Mode:** Toggle `[ Debug Information & System Metrics Only ]`.
    

## 5\. BUSY Bar Physical Display Pixel Templates

### 5.1 Front Display (72×16 RGB LED Matrix)

The front display renders text and graphic elements within a compact 72×16 resolution grid.

#### Template A: Active Task Tracker View

-   **Row 1 (**y\=0..6**):** Project Key & Elapsed Time (`PROJ-142 01:24:38`, font: `small`, color: `#AAFF00FF`).
    
-   **Row 2 (**y\=8..15**):** Task Title (`Dash Mechanics...`, font: `small`, auto-scrolling with `scroll_rate: 60`, color: `#FFFFFFFF`).
    

```
+------------------------------------------------------------------------+ (y=0)
| P R O J - 1 4 2   0 1 : 2 4 : 3 8                                      |
|                                                                        | (y=7)
| I m p l e m e n t   D a s h   M e c h a n i c s . . .                  |
+------------------------------------------------------------------------+ (y=15)
(x=0)                                                                (x=71)
```

#### Template B: Unity Compiling / Build Progress Bar View

-   **Row 1 (**y\=0..6**):** Status Text (`MyGame: Compiling...`, font: `small`, color: `#3B82F6FF`).
    
-   **Row 2 (**y\=9..13**):** Progress Bar border & filled `RectangleElement` (`width: progress * 72 / 100`, fill: `#3B82F6FF`).
    

```
+------------------------------------------------------------------------+ (y=0)
| M y G a m e :   C o m p i l i n g . . .                                |
| +--------------------------------------------------------------------+ | (y=8)
| |=============================                                       | | (y=13)
+------------------------------------------------------------------------+ (y=15)
```

#### Template C: Play Mode "ON AIR" Alert

-   **Centered Label (**y\=3..12**):** Text `ON AIR` (font: `bold`, color: `#FF0000FF`).
    
-   **Status LED:** Solid Red or Breathing Red (`#FF0000FF`).
    

```
+------------------------------------------------------------------------+
|                                                                        |
|                       O N   A I R                                      |
|                                                                        |
+------------------------------------------------------------------------+
```

#### Template D: Daily Stand-Up Stopwatch View

-   **Row 1 (**y\=0..6**):** Header Text (`STAND-UP STOPWATCH`, font: `tiny`, color: `#F59E0BFF`).
    
-   **Row 2 (**y\=7..15**):** Stopwatch Timer (`00 : 08 : 42`, font: `normal`, color: `#FFFFFFFF`).
    

```
+------------------------------------------------------------------------+
| S T A N D - U P   S T O P W A T C H                                    |
|             0 0 : 0 8 : 4 2                                            |
+------------------------------------------------------------------------+
```

### 5.2 Rear Display (160×80 Monochrome OLED)

The rear display faces away from the user and is strictly allocated for low-priority system diagnostics, IP metrics, and debug logs.

#### Rear OLED Layout Template: Debug & Diagnostic Overview

```
+-----------------------------------------------------------------------------------+ (y=0)
| BUSY BAR DIAGNOSTICS                                          [ USB Ethernet ]    |
+-----------------------------------------------------------------------------------+ (y=15)
| IP Address   : 10.0.4.20                                                          |
| WebSocket WS : CONNECTED (Ping: 4ms)                                              |
| Battery      : 98% (Charging - 4843 mV)                                           |
| Active Task  : PROJ-142 (Tracking)                                                |
| Local Server : http://127.0.0.1:39123 (Node http)                                    |
+-----------------------------------------------------------------------------------+ (y=80)
(x=0)                                                                           (x=159)
```

## 6\. Interaction Summary & Event Flow Matrix

| 
Trigger Source

 | 

Action / Input

 | 

UI / Hardware Result

 |
| --- | --- | --- |
| 

**PC App UI**

 | 

Click "Pause"

 | 

Front screen shows yellow pause icon; LED breathes yellow; timer session updates state to `PAUSED`.

 |
| 

**BUSY Bar Wheel**

 | 

Click (OK)

 | 

PC App brings 2-step task selection modal to front focus on workstation.

 |
| 

**BUSY Bar Wheel**

 | 

Rotate Wheel

 | 

Navigates through project/task items in active selection modal.

 |
| 

**BUSY Bar Button**

 | 

Long Press Back

 | 

Completes active task session, logs accumulated hours to Jira/Sheets, and returns display to Idle.

 |
| 

**OS Event**

 | 

`Win + L` (PC Lock)

 | 

Front display renders `AWAY / LOCKED`; LED dims; active timestamp clock continues accurately in background.

 |
| 

**Unity Event**

 | 

Compile Starts

 | 

High-priority blue progress bar appears on front display; LED blinks blue; audio chime plays upon completion.

 |