import WebSocket from 'ws';

const HOST = "10.0.4.20";
const API = `http://${HOST}/api`;
const APP_NAME = "test_input_ts";

const BTN_MAP: Record<number, string> = {
    0: "OK",
    1: "BACK",
    2: "START"
};

async function drawText(text: string) {
    console.log(`Drawing text: ${text}`);
    try {
        await fetch(`${API}/display/draw?application_name=${APP_NAME}`, {
            method: 'DELETE',
            // @ts-ignore - abort signal timeout not strictly needed here for basic test
        });
        
        const payload = {
            application_name: APP_NAME,
            priority: 100,
            elements: [
                {
                    id: "text_1",
                    type: "text",
                    text: text,
                    font: "large",
                    color: "#00FFCCFF",
                    align: "center",
                    x: 36,
                    y: 8,
                    display: "front"
                }
            ]
        };
        await fetch(`${API}/display/draw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.log(`Failed to update display: ${(e as Error).message}`);
    }
}

// -------------------------------------------------------------
// EXACT TS CODE FROM busybar-driver.ts to test the bug!
// -------------------------------------------------------------
function parseVarint(data: Uint8Array, offset: number): { value: number; nextOffset: number } {
  let value = 0;
  let shift = 0;
  let curr = offset;
  while (curr < data.length) {
    const byte = data[curr++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      return { value: value >>> 0, nextOffset: curr };
    }
    shift += 7;
    if (shift > 35) break;
  }
  return { value: 0, nextOffset: data.length };
}

function parseFields(data: Uint8Array): { number: number; wireType: number; value: unknown }[] {
  const fields: { number: number; wireType: number; value: unknown }[] = [];
  let offset = 0;
  while (offset < data.length) {
    const keyRes = parseVarint(data, offset);
    offset = keyRes.nextOffset;
    const key = keyRes.value;
    const number = key >>> 3;
    const wireType = key & 7;

    if (wireType === 0) {
      const valRes = parseVarint(data, offset);
      offset = valRes.nextOffset;
      fields.push({ number, wireType, value: valRes.value });
    } else if (wireType === 1) {
      const sub = data.subarray(offset, offset + 8);
      offset += 8;
      fields.push({ number, wireType, value: sub });
    } else if (wireType === 2) {
      const lenRes = parseVarint(data, offset);
      offset = lenRes.nextOffset;
      const len = lenRes.value;
      const sub = data.subarray(offset, offset + len);
      offset += len;
      fields.push({ number, wireType, value: sub });
    } else if (wireType === 5) {
      const sub = data.subarray(offset, offset + 4);
      offset += 4;
      fields.push({ number, wireType, value: sub });
    } else {
      break;
    }
  }
  return fields;
}

function zigzagDecode(val: number): number {
  return (val >> 1) ^ -(val & 1);
}

function processInputEventBytes(value: Uint8Array) {
    const fields = parseFields(value);
    for (const f of fields) {
        if (f.number === 1 && f.value instanceof Uint8Array) {
            let button = 0;
            let action = 0;
            const subFields = parseFields(f.value);
            for (const sf of subFields) {
                if (sf.number === 1 && typeof sf.value === 'number') button = sf.value;
                if (sf.number === 2 && typeof sf.value === 'number') action = sf.value;
            }
            return { kind: 'button', button, action };
        }
        if (f.number === 2 && f.value instanceof Uint8Array) {
            let pos = 0;
            const subFields = parseFields(f.value);
            for (const sf of subFields) {
                if (sf.number === 1 && typeof sf.value === 'number') pos = sf.value;
            }
            return { kind: 'switch', pos };
        }
        if (f.number === 3 && f.value instanceof Uint8Array) {
            let delta = 0;
            const subFields = parseFields(f.value);
            for (const sf of subFields) {
                if (sf.number === 1 && typeof sf.value === 'number') delta = zigzagDecode(sf.value);
            }
            return { kind: 'encoder', delta };
        }
    }
    return null;
}

function eventsFromState(data: Uint8Array) {
    const events: any[] = [];
    const rootFields = parseFields(data);
    for (const rf of rootFields) {
        if (rf.number === 2 && rf.value instanceof Uint8Array) {
            const updateFields = parseFields(rf.value);
            for (const uf of updateFields) {
                if (uf.number === 11 && uf.value instanceof Uint8Array) {
                    const res = processInputEventBytes(uf.value);
                    if (res) events.push(res);
                }
            }
        } else if (rf.number === 11 && rf.value instanceof Uint8Array) {
            const res = processInputEventBytes(rf.value);
            if (res) events.push(res);
        }
    }
    return events;
}

async function main() {
    const wsUrl = `ws://${HOST}/api/status/ws`;
    console.log(`Connecting to ${wsUrl}...`);
    
    await drawText("WAITING (TS)");

    function connect() {
        const socket = new WebSocket(wsUrl);
        
        socket.on('open', () => {
            console.log("Connected! Waiting for physical button inputs...");
            socket.send(JSON.stringify({ enable: true }));
        });

        socket.on('message', (rawData) => {
            let data: Uint8Array;
            if (Buffer.isBuffer(rawData)) {
                data = new Uint8Array(rawData);
            } else if (rawData instanceof ArrayBuffer) {
                data = new Uint8Array(rawData);
            } else if (Array.isArray(rawData)) {
                data = new Uint8Array(Buffer.concat(rawData));
            } else {
                return; // String or unhandled
            }

            try {
                const events = eventsFromState(data);
                for (const event of events) {
                    if (event.kind === 'button') {
                        if (event.action === 1) { // Release
                            const btnName = BTN_MAP[event.button] || `BTN ${event.button}`;
                            console.log(`Detected: ${btnName}`);
                            drawText(btnName);
                        }
                    } else if (event.kind === 'switch') {
                        const mode = event.pos === 3 ? "APPS" : `MODE ${event.pos}`;
                        console.log(`Detected Switch: ${mode}`);
                        drawText(mode);
                    } else if (event.kind === 'encoder') {
                        const dirStr = event.delta > 0 ? "RIGHT" : "LEFT";
                        console.log(`Detected Encoder: ${dirStr}`);
                        drawText(dirStr);
                    }
                }
            } catch (e) {
                console.error("Parse error:", (e as Error).message);
            }
        });

        socket.on('error', (err) => {
            console.log(`Connection error: ${err.message}`);
        });

        socket.on('close', () => {
            console.log("Connection lost. Retrying in 2s...");
            setTimeout(connect, 2000);
        });
    }

    connect();
}

main().catch(err => {
    console.error("Fatal error:", err);
});
