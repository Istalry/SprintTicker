# Windows User Notification Listener & Priority Guide

The **Windows User Notification Listener** service in the BUSY Bar PC Companion application captures system and third-party application notifications directly from the Windows Action Center / User Notification API, formatting alerts on the physical 72x16 LED matrix display.

---

## 🚀 Key Features

1. **Generic Windows Notification Capture:** Automatically captures notifications from apps such as **Discord**, **Slack**, **Antigravity**, **Google Chrome**, **Outlook / Gmail**, **System Battery**, and custom desktop applications.
2. **Left-Icon Centered Matrix Layout:** Notification alerts render the application icon on the **left (x=0, y=0, 16x16)** centered inside a 15x15 icon grid, and the notification title + body text on the **right (x=16, y=0 / y=8, width=56)**.
3. **3-Level Per-Source Priority System:**
   - **`DONT_SHOW`** (Suppress notification completely - do not display or preempt)
   - **`DEFAULT`** (Standard notification - priority score 40, subject to Work/Lunch/Away preemption matrix)
   - **`HIGH_PRIORITY`** (High priority - priority score 95, preempts active status and flashes LED banner)

---

## 📊 Priority Order Matrix (Work / Lunch / Away Modes)

| Event / Status | Rule Key | Score | Work Mode | Lunch Mode | Away Mode |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Unity Build Failure / Exception** | `unityBuildFailurePriority` | **100** | `DISPLAY` | `DISPLAY` | `DISPLAY` |
| **High Priority Notification / System Alert** | `highNotificationPriority` | **95** | `DISPLAY` | `DISPLAY` | `DISPLAY` |
| **Unity Play Mode / ON AIR** | `unityPlayModePriority` | **90** | `DISPLAY` | `SUPPRESS` | `DISPLAY` |
| **Unity Compiling / Building** | `unityCompilingPriority` | **80** | `DISPLAY` | `SUPPRESS` | `SUPPRESS` |
| **Away Mode Screen** | `awayModePriority` | **75** | `DISPLAY` | `SUPPRESS` | `DISPLAY` |
| **Daily Stand-Up Ceremony Prompt** | `standupPromptPriority` | **70** | `DISPLAY` | `QUEUE` | `QUEUE` |
| **Lunch Mode Screen** | `lunchModePriority` | **65** | `DISPLAY` | `DISPLAY` | `SUPPRESS` |
| **Pomodoro / Rest Break Reminder** | `breakPromptPriority` | **60** | `DISPLAY` | `QUEUE` | `SUPPRESS` |
| **Default Chat / App Notification** | `messagingPriority` | **40** | `DISPLAY` | `SUPPRESS` | `SUPPRESS` |
| **Active Session Time Tracker / Idle** | `activeTrackerPriority` | **20** | `DISPLAY` | `DISPLAY` | `DISPLAY` |

---

## 🛠️ Testing & Simulation Triggers

You can trigger simulated notifications from either:
- The **Notifications** tab in the PC Companion dashboard (`Notifications` -> click the Send button next to any source).
- The **Device Diagnostics & Telemetry** tab (`Device Diagnostics` -> click **Test Discord**, **Test Slack**, **Test Antigravity**, or **Test Battery Alert**).
