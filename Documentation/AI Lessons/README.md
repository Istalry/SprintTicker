# Official lessons (HTTP widgets)

These files match **standard shipping behavior** for the BUSY Bar **HTTP widget** path: Python (or any client) + **`POST /api/display/draw`** for the **72×16** strip, plus **openapi.yaml** and **CLI** reference.

**On-device JavaScript (JerryScript)** is documented under **[../Unofficial/12-JerryScript-on-device-apps.md](../Unofficial/12-JerryScript-on-device-apps.md)** — it is **not** treated as part of the default “normal” firmware build for these lessons.

## Widget model (this folder)

| Topic | Detail |
|-------|--------|
| **Where code runs** | Your PC (e.g. Python `widget.py`) |
| **How the device is driven** | `POST /api/display/draw` with DisplayElements JSON |
| **Typical use** | Dashboards, tickers, live data from a host script |

## File list

| File | Content |
|------|--------|
| **01-Instructions-for-users.md** | How to give instructions to an AI, file downloads, visual previews, beginner mode rules. |
| **02-How-to-run-it.md** | Running a widget: device address, Terminal, pip, Widget Builder AI (Ollama). |
| **03-Device-and-API.md** | Device summary, connection, widget API, workflow (upload → draw → clear). |
| **04-Design-and-layout.md** | 72×16 design rules: alignment, slots, fonts, colors. |
| **05-DisplayElements-and-assets.md** | Draw API: element types, assets upload. |
| **06-Examples.md** | Example draw JSON. |
| **07-Dynamic-widget-pattern.md** | Loop pattern; external APIs. |
| **08-Pitfalls-and-references.md** | Pitfalls; references. |
| **09-Widget-template.md** | Full `widget.py` template. |
| **10-BSB-icons-base64.md** | BSB icons as base64 for Python widgets. |
| **11-Social-icons-base64.md** | Social icons as base64 for widgets. |
| **openapi.yaml** | Device HTTP API (includes `/api/storage/*`). |
| **CLI/** | Busy Bar CLI reference. |

## Suggested order

**First widget:** 01 → 02 → 03 → 04 → 05 → 06 → 09 → (07 if live data).
