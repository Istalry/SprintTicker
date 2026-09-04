# Hardware Samples

Standalone reference scripts that talk to the BUSY Bar directly, with no
dependency on the desktop app. They are the shortest path to confirming a
hardware behaviour before wiring it into `packages/desktop-app`.

The bar is reachable at the fixed USB address `10.0.4.20` and needs no token
over USB — see [ai-lessons](../ai-lessons/).

## `input-websocket/`

Subscribes to the `/api/status/ws` input stream and draws the pressed button
back onto the front matrix. Provided twice, in Python and TypeScript, so you
can compare against whichever runtime is convenient.

```bash
# Python
pip install requests websocket-client
python Documentation/hardware-samples/input-websocket/test_input.py
```

```bash
# TypeScript
cd Documentation/hardware-samples/input-websocket && npm install && npx tsx test_input.ts
```

Both open the socket, send the `{"enable":true}` handshake, and map button
indices `0/1/2` to `OK`/`BACK`/`START`.
