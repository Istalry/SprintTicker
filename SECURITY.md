# Security

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and
use **Report a vulnerability**. That creates a private advisory only you and the
maintainer can see.

Please do not open a public issue for a security problem — an issue is visible
the moment it is filed.

This is a personal project maintained by one person. Expect an acknowledgement
within a week or so; there is no SLA, and no bounty.

## What this software exposes

Worth knowing before you assess it, because two of these look alarming and are
intentional.

### A local HTTP server on `127.0.0.1:39123`

The app runs an HTTP server so the Unity Editor plugin can push compile and
console events. It can drive the LED display and **inject hardware input
events**, which makes it more interesting than a typical loopback endpoint.

It is not authenticated. Loopback is not a security boundary — any page in any
browser on the machine can `POST` to `127.0.0.1` — so requests are screened
before they reach a route:

- `Content-Type: application/json` is **required**. A cross-origin `POST` may
  skip the CORS preflight only while it stays a "simple" request, which limits
  it to form, plain-text and multipart bodies. Requiring JSON forces a
  preflight, and no `Access-Control-Allow-Origin` header is ever sent, so the
  preflight fails and the real request is never issued. **This is the check
  doing the work.**
- Requests carrying an `Origin` header are refused. Browsers set it; native
  clients do not. This is defence in depth, not the primary control.
- Bodies are capped at 64 KB.

What that closes is the path from a web page you happen to be visiting to your
hardware. It does **not** stop another program running as you from calling the
API. If you have found a way for a *web page* to reach a route, that is a
vulnerability and worth reporting.

The server binds to `127.0.0.1` and is never reachable from the network.

### A fixed device address with no token

The BUSY Bar answers on `10.0.4.20` over USB and requires no authentication
there. That is how the device works, not a hardcoded shortcut, and the app does
not support connecting to it over Wi-Fi.

### Windows notification contents

The app reads the Windows Action Center database to mirror notifications you
have allowed onto the display. Notification titles and bodies are **redacted
from logs and from the diagnostics export** by default; `--debug-notifications`
turns that off for troubleshooting. If you find notification text reaching a
log, a crash report or an exported bundle without that flag, please report it.

### Credentials

OpenProject credentials are currently stored **in plaintext** in the local
settings database, and the default instance URL scheme is `http`. This is known
(`F-11` in `AUDIT.md`) and is on the roadmap; `safeStorage` is the intended
fix. Treat it as a documented weakness rather than a new finding — though a
report showing it is worse than described is welcome.

### Unsigned builds

There is no code-signing certificate, so installers are unsigned and Windows
SmartScreen warns on first launch. Verify what you run: build from source, or
check the artifact against the workflow run that produced it.

## Supported versions

The latest commit on `main`. There are no released versions and no backports.
