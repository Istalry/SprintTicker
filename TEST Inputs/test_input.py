#!/usr/bin/env python3
import time
import requests
from websocket import create_connection, WebSocketTimeoutException
from collections.abc import Iterator

HOST = "10.0.4.20"
API = f"http://{HOST}/api"
APP_NAME = "test_input"

BTN_MAP = {
    0: "OK",
    1: "BACK",
    2: "START"
}

def draw_text(text: str) -> None:
    print(f"Drawing text: {text}")
    try:
        # Clear previous drawing
        requests.delete(f"{API}/display/draw", params={"application_name": APP_NAME}, timeout=2)
        
        # Draw new text
        payload = {
            "application_name": APP_NAME,
            "priority": 100,
            "elements": [
                {
                    "id": "text_1",
                    "type": "text",
                    "text": text,
                    "font": "large",
                    "color": "#00FFCCFF",
                    "align": "center",
                    "x": 36,
                    "y": 8,
                    "display": "front"
                }
            ]
        }
        requests.post(f"{API}/display/draw", json=payload, timeout=2)
    except Exception as e:
        print(f"Failed to update display: {e}")

def _read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
        if shift > 70:
            break
    raise ValueError("Invalid protobuf varint")

def _fields(data: bytes) -> Iterator[tuple[int, int, int | bytes]]:
    offset = 0
    while offset < len(data):
        key, offset = _read_varint(data, offset)
        number, wire_type = key >> 3, key & 7
        if wire_type == 0:
            value, offset = _read_varint(data, offset)
        elif wire_type == 1:
            value = data[offset : offset + 8]
            offset += 8
        elif wire_type == 2:
            length, offset = _read_varint(data, offset)
            value = data[offset : offset + length]
            offset += length
        elif wire_type == 5:
            value = data[offset : offset + 4]
            offset += 4
        else:
            raise ValueError(f"Unsupported protobuf wire type: {wire_type}")
        yield number, wire_type, value

def _zigzag(value: int) -> int:
    return (value >> 1) ^ -(value & 1)

def _input_event(data: bytes) -> tuple | None:
    for number, wire_type, value in _fields(data):
        if wire_type != 2 or not isinstance(value, bytes):
            continue
        if number == 1:
            button = action = 0
            for field, _, item in _fields(value):
                if field == 1 and isinstance(item, int):
                    button = item
                elif field == 2 and isinstance(item, int):
                    action = item
            return "button", button, action
        if number == 2:
            position = 0
            for field, _, item in _fields(value):
                if field == 1 and isinstance(item, int):
                    position = item
            return "switch", position
        if number == 3:
            delta = 0
            for field, _, item in _fields(value):
                if field == 1 and isinstance(item, int):
                    delta = _zigzag(item)
            return "encoder", delta
    return None

def events_from_state(data: bytes) -> Iterator[tuple]:
    for number, wire_type, update in _fields(data):
        if number != 2 or wire_type != 2 or not isinstance(update, bytes):
            continue
        for field, update_wire_type, value in _fields(update):
            if field == 11 and update_wire_type == 2 and isinstance(value, bytes):
                event = _input_event(value)
                if event:
                    yield event

def main():
    ws_url = f"ws://{HOST}/api/status/ws"
    print(f"Connecting to {ws_url}...")
    
    draw_text("WAITING")
    
    while True:
        socket = None
        try:
            socket = create_connection(ws_url, timeout=5, enable_multithread=True)
            socket.settimeout(1)
            socket.send('{"enable":true}')
            print("Connected! Waiting for physical button inputs...")
            
            while True:
                try:
                    opcode, data = socket.recv_data(control_frame=False)
                except WebSocketTimeoutException:
                    continue
                if opcode != 2 or not data:
                    continue
                
                for event in events_from_state(data):
                    kind = event[0]
                    if kind == "button":
                        button_id = int(event[1])
                        action = int(event[2])
                        if action == 1:  # Release
                            btn_name = BTN_MAP.get(button_id, f"BTN {button_id}")
                            print(f"Detected: {btn_name}")
                            draw_text(btn_name)
                    elif kind == "switch":
                        pos = int(event[1])
                        mode = "APPS" if pos == 3 else f"MODE {pos}"
                        print(f"Detected Switch: {mode}")
                        draw_text(mode)
                    elif kind == "encoder":
                        delta = int(event[1])
                        dir_str = "RIGHT" if delta > 0 else "LEFT"
                        print(f"Detected Encoder: {dir_str}")
                        draw_text(dir_str)
        except Exception as error:
            print(f"Connection lost: {error}. Retrying in 2s...")
            time.sleep(2)
        finally:
            if socket:
                try:
                    socket.close()
                except Exception:
                    pass

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nExiting test script.")
        try:
            requests.delete(f"{API}/display/draw", params={"application_name": APP_NAME}, timeout=2)
        except Exception:
            pass
