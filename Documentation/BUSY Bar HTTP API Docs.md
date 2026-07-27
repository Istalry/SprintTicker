### [Account](#/Account)

Account linking and MQTT status

GET

[/busybar/account/info](#/Account/getAccountInfo)

Get linked account info

Retrieves linked account data

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Data retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "linked": true,
  "id": "12345678-9abc-def0-1234-56789abcdef0",
  "email": "name@example.com",
  "user_id": "12345678-9abc-def0-1234-56789abcdef0"
}
```









 | _No links_ |

GET

[/busybar/account/status](#/Account/getAccountStatus)

Get MQTT status info

Retrieves MQTT status

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Data retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "status": "connected"
}
```









 | _No links_ |

GET

[/busybar/account/backend](#/Account/getAccountBackend)

Get MQTT configuration

Retrieves MQTT backend configuration

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Data retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "server_url": "default",
  "client_cert_type": "default",
  "ignore_server_cert": false
}
```









 | _No links_ |
| 503 | 

Failed to serialize MQTT configuration

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Assets](#/Assets)

Asset file management and display control

POST

[/busybar/assets/upload](#/Assets/uploadAssetWithAppId)

Upload asset file with app ID

Uploads a file to a specific app's assets directory

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
application\_name \*

string

(query)

 | 

Application ID for organizing assets

_Example_ : my\_app

 |
| 

file \*

string

(query)

 | 

Filename for the uploaded asset

_Example_ : data.png

 |

#### Request body

application/octet-stream

_Example values are not available for `application/octet-stream` media types._

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
File uploaded successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid parameters or upload failed

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 413 | 

File too large

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 508 | 

Failed to write uploaded file

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

DELETE

[/busybar/assets/upload](#/Assets/deleteAppAssets)

Delete app assets

Deletes all assets for a specific app ID

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
application\_name \*

string

(query)

 | 

Application ID whose assets should be deleted

_Example_ : my\_app

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Assets deleted successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid request parameters

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 503 | 

Delete failed

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/display/draw](#/Assets/drawOnDisplay)

Draw on display

Sends drawing data to the display. Supports JSON-defined display elements.

#### Parameters

Try it out

No parameters

#### Request body

application/json

-   Example Value
-   Schema

```json
{
  "application_name": "my_app",
  "led_notification_color": "#FF0000FF",
  "elements": [
    {
      "id": "0",
      "timeout": 10,
      "align": "center",
      "x": 36,
      "y": 10,
      "type": "text",
      "text": "Hello, World! Long text",
      "font": "normal",
      "color": "#FFFFFFFF",
      "width": 72,
      "scroll_rate": 1000,
      "scroll_start_delay": 1000,
      "scroll_repeat_delay": 2500,
      "display": "front"
    },
    {
      "id": "1",
      "timeout": 6,
      "align": "top_mid",
      "x": 36,
      "y": 0,
      "type": "text",
      "text": "top_mid",
      "font": "small",
      "color": "#AAFF00FF",
      "display": "front"
    },
    {
      "id": "2",
      "timeout": 6,
      "type": "image",
      "path": "data.png",
      "x": 0,
      "y": 0,
      "display": "back"
    }
  ]
}
```

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Drawing command executed successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid drawing data

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 409 | 

Requested priority level is below that of currently active app

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

DELETE

[/busybar/display/draw](#/Assets/clearDisplay)

Clear display

Deletes display elements drawn by the Canvas application. If application\_name is specified, only elements for that app are removed.

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
application\_name

string

(query)

 | 

Application identifier

_Example_ : my\_app

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Display cleared successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |

POST

[/busybar/audio/play](#/Assets/playAudio)

Play audio file

Plays an audio file from the assets directory. Supported formats include .snd files.

#### Parameters

Try it out

No parameters

#### Request body

application/json

-   Example Value
-   Schema

```json
{
  "path": "data.snd",
  "application_name": "my_app"
}
```

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Audio playback started successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid file path

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 404 | 

Audio file not found or is unplayable

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

DELETE

[/busybar/audio/play](#/Assets/stopAudio)

Stop audio playback

Stops any currently playing audio

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Audio playback stopped successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 410 | 

No audio is playing

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 503 | 

Audio system error

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [BLE](#/BLE)

Allows to operate with BLE

POST

[/busybar/ble/enable](#/BLE/post_busybar_ble_enable)

Enable BLE

Enables BLE module and starts advertising

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
BLE enabled

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 503 | 

Unable to start BLE

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/ble/disable](#/BLE/post_busybar_ble_disable)

Disable BLE

Stops advertising

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
BLE disabled

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 503 | 

Unable to stop BLE

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

DELETE

[/busybar/ble/pairing](#/BLE/delete_busybar_ble_pairing)

Remove pairing

Remove pairing with previous device

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Pairing removed, now device is discoverable

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 503 | 

Failed to remove because BLE is not initialized or pairing was already removed

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/ble/status](#/BLE/get_busybar_ble_status)

Returns current BLE status

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
OK

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "status": "connected",
  "address": "50:DA:D6:FE:DD:A9"
}
```









 | _No links_ |
| 503 | 

Failed to get BLE status, because of an error

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Busy](#/Busy)

BUSY timer control

GET

[/busybar/busy/snapshot](#/Busy/getBusySnapshot)

Get BUSY timer snapshot

Gets the current state of the BUSY timer in snapshot form

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Got snapshot successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "snapshot": {
    "type": "NOT_STARTED",
    "busy_bar_settings": {
      "theme": "on_air",
      "show_work_phase_only": false,
      "trigger_smart_home": true
    }
  },
  "snapshot_timestamp_ms": 1761582532251
}
```









 | _No links_ |
| 400 | 

Error getting snapshot

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

PUT

[/busybar/busy/snapshot](#/Busy/setBusySnapshot)

Set BUSY timer snapshot

Run the timer starting from the given snapshot

#### Parameters

Try it out

No parameters

#### Request body

application/json

-   Example Value
-   Schema

```json
{
  "snapshot": {
    "type": "NOT_STARTED",
    "busy_bar_settings": {
      "theme": "on_air",
      "show_work_phase_only": false,
      "trigger_smart_home": true
    }
  },
  "snapshot_timestamp_ms": 1761582532251
}
```

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Snapshot successfully set

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Error setting snapshot

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/busy/profiles/{slot}](#/Busy/getBusyProfile)

Get BUSY timer profile

Gets the BUSY timer profile under specified slot

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
slot \*

string

(path)

 | 

_Available values_ : busy, custom

busycustom |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Got profile successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "sort_order": -1,
  "title": "study",
  "id": "00000000-0000-0000-0000-000000000000",
  "timer_settings": {
    "type": "INFINITE"
  },
  "busy_bar_settings": {
    "theme": "on_air",
    "show_work_phase_only": false,
    "trigger_smart_home": true
  },
  "profile_timestamp_ms": 1761582532251
}
```









 | _No links_ |
| 400 | 

Error getting profile

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

PUT

[/busybar/busy/profiles/{slot}](#/Busy/setBusyProfile)

Set BUSY timer profile

Sets the BUSY timer profile under specified slot

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
slot \*

string

(path)

 | 

_Available values_ : busy, custom

busycustom |

#### Request body

application/json

-   Example Value
-   Schema

```json
{
  "sort_order": -1,
  "title": "study",
  "id": "00000000-0000-0000-0000-000000000000",
  "timer_settings": {
    "type": "INFINITE"
  },
  "busy_bar_settings": {
    "theme": "on_air",
    "show_work_phase_only": false,
    "trigger_smart_home": true
  },
  "profile_timestamp_ms": 1761582532251
}
```

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Profile successfully set

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Error setting profile

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Input](#/Input)

Input events

POST

[/busybar/input](#/Input/setInputKey)

Send input event

Send single key press event

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
key \*

string

(query)

 | 

Key name

_Available values_ : up, down, ok, back, start, busy, custom, off, apps, settings

_Example_ : ok

updownokbackstartbusycustomoffappssettings |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Input event sent successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid request data

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Settings](#/Settings)

Device settings

GET

[/busybar/access](#/Settings/getHttpAccess)

Get HTTP API access over Wi-Fi configuration

Get HTTP API access over Wi-Fi configuration

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "mode": "key",
  "key_valid": true
}
```









 | _No links_ |

POST

[/busybar/access](#/Settings/setHttpAccess)

Set HTTP API access over Wi-Fi configuration

Set HTTP API access over Wi-Fi configuration

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
mode \*

string

(query)

 | 

Access mode

_Available values_ : disabled, enabled, key

_Example_ : key

disabledenabledkey |
| 

key

string

(query)

 | 

Access key (4-10 digits length). Required when mode is "key".

_Example_ : 12345678

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Set successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid request data

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/name](#/Settings/get_busybar_name)

Get current device name

Get current device name

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "name": "BUSY bar"
}
```









 | _No links_ |

POST

[/busybar/name](#/Settings/post_busybar_name)

Set new device name

Set new device name

#### Parameters

Try it out

No parameters

#### Request body

application/json

-   Example Value
-   Schema

```json
{
  "name": "BUSY bar"
}
```

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
New name successfully set

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid name parameter, or failed to store new name

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/display/brightness](#/Settings/getDisplayBrightness)

Get display brightness

Get brightness value for displays

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "value": "auto"
}
```









 | _No links_ |

POST

[/busybar/display/brightness](#/Settings/setDisplayBrightness)

Set display brightness

Set brightness for one or both displays

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
value \*

string

(query)

 | 

Displays brightness (0-100/auto)

_Example_ : 50

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Brightness set successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid request data

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/audio/volume](#/Settings/getAudioVolume)

Get audio volume

Get audio volume value

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "volume": 50
}
```









 | _No links_ |

POST

[/busybar/audio/volume](#/Settings/setAudioVolume)

Set audio volume

Set audio volume value

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
volume \*

number

(query)

 | 

Audio volume (0-100)

_Example_ : 50

 |
| 

silent

integer

(query)

 | 

Set volume silently (0 - play volume change sound(default), 1 - do not play sound)

_Available values_ : 0, 1

_Example_ : 1

\--01 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Volume set successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid request data

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Smart Home](#/Smart%20Home)

Smart Home event handling

GET

[/busybar/smart\_home/pairing](#/Smart%20Home/getSmartHomeCommissioningStatus)

Smart home commissioning status

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Successfully got smart home commissioning status

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "fabric_count": 1,
  "latest_pairing_status": {
    "value": "completed_successfully",
    "timestamp": 1769436711
  }
}
```









 | _No links_ |

POST

[/busybar/smart\_home/pairing](#/Smart%20Home/startSmartHomePairing)

Link device to a smart home

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Successfully started smart home pairing

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "available_until": "1769437579000",
  "qr_code": "MT:YNDA0-O913..VV7I000",
  "manual_code": "1155-360-0377"
}
```









 | _No links_ |
| 503 | 

Internal smart home service is broken

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

DELETE

[/busybar/smart\_home/pairing](#/Smart%20Home/delete_busybar_smart_home_pairing)

Erase all smart home links

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Successfully erased all smart home pairing info, device restart is needed

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 503 | 

Internal smart home service is broken

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/smart\_home/switch](#/Smart%20Home/get_busybar_smart_home_switch)

Get state of emulated smart home switch

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Successfully got state of emulated smart home switch

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "state": false,
  "startup": "off"
}
```









 | _No links_ |
| 503 | 

Internal smart home service is broken

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/smart\_home/switch](#/Smart%20Home/post_busybar_smart_home_switch)

Set state of emulated smart home switch

#### Parameters

Try it out

No parameters

#### Request body

application/json

-   Example Value
-   Schema

```json
{
  "state": false,
  "startup": "off"
}
```

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Successfully set state of emulated smart home switch

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 503 | 

Internal smart home service is broken

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Storage](#/Storage)

File storage operations

POST

[/busybar/storage/write](#/Storage/writeStorageFile)

Upload file to internal storage

Uploads a file to a specified path

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
path \*

string

(query)

 | 

Path for the uploaded file

_Example_ : /ext/test.png

 |

#### Request body

application/octet-stream

_Example values are not available for `application/octet-stream` media types._

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
File uploaded successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid parameters or upload failed

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 413 | 

File too large

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 508 | 

Failed to write uploaded file

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/storage/read](#/Storage/readStorageFile)

Download file from internal storage

Downloads a file from a specified path

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
path \*

string

(query)

 | 

Path to the file

_Example_ : /ext/test.png

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
File downloaded successfully

Media type

application/octet-stream

Controls `Accept` header.

-   Example Value
-   Schema

```code
string
```









 | _No links_ |
| 400 | 

Invalid parameters or file not exists

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/storage/list](#/Storage/listStorageFiles)

List files on internal storage

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
path \*

string

(query)

 | 

Path to the file

_Example_ : /ext

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Directory contents read successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "list": [
    {
      "type": "file",
      "name": "test.png",
      "size": 65535
    },
    {
      "type": "dir",
      "name": "assets"
    }
  ]
}
```









 | _No links_ |
| 400 | 

Invalid parameters or directory does not exist

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

DELETE

[/busybar/storage/remove](#/Storage/removeStorageFile)

Remove a file on internal storage

Removes a file with a specified path

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
path \*

string

(query)

 | 

Path of a file to remove

_Example_ : /ext/test.png

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
File deleted successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid path or deletion failed

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/storage/mkdir](#/Storage/createStorageDir)

Create a directory on internal storage

Creates a new directory with a specified path

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
path \*

string

(query)

 | 

Path to a new directory

_Example_ : /ext/newdir

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Directory created successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid path or creation failed

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/storage/rename](#/Storage/RenameStorageFile)

Rename/move a file

Moves a file to a new location

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
path \*

string

(query)

 | 

Old location path

_Example_ : /ext/old\_name.txt

 |
| 

new\_path \*

string

(query)

 | 

New location path

_Example_ : /ext/new\_name.txt

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Renamed successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid path or operation failed

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/storage/status](#/Storage/getStorageStatus)

Show storage usage

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Storage status queried successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "used_bytes": 123456,
  "free_bytes": 654321,
  "total_bytes": 777777
}
```









 | _No links_ |
| 400 | 

Invalid parameters or storage doesn't exist

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Streaming](#/Streaming)

Screen streaming

GET

[/busybar/status/ws](#/Streaming/connectWebSocket)

Device status streaming WebSocket endpoint

WebSocket connection for real-time device status and screen streaming. Upgrade from HTTP to WebSocket protocol is required. After connection, client must enable streaming by sending JSON: {"enable": true}

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 101 | 
WebSocket connection established





 | _No links_ |
| 400 | 

Exceed max clients count

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/screen](#/Streaming/get_busybar_screen)

Get single frame for requested screen

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
display \*

integer

(query)

 | 

Type of the display Front = 0, Back = 1

_Example_ : 0

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
OK

Media type

image/bmp

Controls `Accept` header.

-   Example Value
-   Schema

```code
string
```









 | _No links_ |
| 400 | 

Wrong display

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [System](#/System)

System information and control

GET

[/busybar/version](#/System/getVersion)

Get API version information

Retrieves API version

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Version information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "api_semver": "0.0.0"
}
```









 | _No links_ |

GET

[/busybar/transport](#/System/getTransport)

Get device network connection info

Retrieves device transport type (usb/wifi)

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "type": "usb"
}
```









 | _No links_ |

GET

[/busybar/status](#/System/getStatus)

Get device status

Get device status

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "device": {
    "serial_number": "203638485431500400123456",
    "usb_mac": "0c:fa:22:21:2a:31",
    "wifi_mac": "0c:fa:22:21:2a:31",
    "ble_mac": "0c:fa:22:21:2a:31",
    "otp_valid": true,
    "otp_model": "BB.1",
    "otp_timestamp": 1767225600,
    "firmware_security": "secure"
  },
  "firmware": {
    "version": "1.0.0",
    "target": 22,
    "branch": "main",
    "build_date": "2024-01-01",
    "commit_hash": "abc123def456-dirty",
    "intercom_version": "abc123de",
    "nwp_version": "1711.2.14.5.2.0.7",
    "matter_version": "1.0"
  },
  "system": {
    "api_semver": "0.0.0",
    "uptime": "00d 00h 04m 13s",
    "boot_time": 1767225600,
    "auto_update_enabled": true
  },
  "power": {
    "state": "discharging",
    "battery_charge": 99,
    "battery_voltage": 4183,
    "battery_current": -180,
    "usb_voltage": 4843
  }
}
```









 | _No links_ |
| 503 | 

Failed to retrieve status

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/status/device](#/System/getStatusDevice)

Get device info

Get device info

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "serial_number": "203638485431500400123456",
  "usb_mac": "0c:fa:22:21:2a:31",
  "wifi_mac": "0c:fa:22:21:2a:31",
  "ble_mac": "0c:fa:22:21:2a:31",
  "otp_valid": true,
  "otp_model": "BB.1",
  "otp_timestamp": 1767225600,
  "firmware_security": "secure"
}
```









 | _No links_ |
| 503 | 

Failed to retrieve status

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/status/firmware](#/System/getStatusFirmware)

Get firmware info

Get firmware info

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "version": "1.0.0",
  "target": 22,
  "branch": "main",
  "build_date": "2024-01-01",
  "commit_hash": "abc123def456-dirty",
  "intercom_version": "abc123de",
  "nwp_version": "1711.2.14.5.2.0.7",
  "matter_version": "1.0"
}
```









 | _No links_ |
| 503 | 

Failed to retrieve status

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/status/system](#/System/getStatusSystem)

Get system status

Get system status

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "api_semver": "0.0.0",
  "uptime": "00d 00h 04m 13s",
  "boot_time": 1767225600,
  "auto_update_enabled": true
}
```









 | _No links_ |
| 503 | 

Failed to retrieve status

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/status/power](#/System/getStatusPower)

Get power status

Get power status

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Information retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "state": "discharging",
  "battery_charge": 99,
  "battery_voltage": 4183,
  "battery_current": -180,
  "usb_voltage": 4843
}
```









 | _No links_ |
| 503 | 

Failed to retrieve status

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/log\_dump](#/System/dumpLog)

Dump captured log

Snapshot the in-memory log buffer to a file (defaults to /ext/log.txt)

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
filename

string

(query)

 | 

Destination file name (without extension)

_Example_ : log

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Log dumped successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK",
  "path": "/ext/dump.txt"
}
```









 | _No links_ |
| 400 | 

Invalid filename

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 508 | 

Failed to dump logs

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Time](#/Time)

Time-related methods

GET

[/busybar/time](#/Time/getTime)

Get current timestamp with timezone

Retrieves the current timestamp from RTC with timezone in ISO 8601 format

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Timestamp retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "timestamp": "2025-10-02T14:30:45+04:00"
}
```









 | _No links_ |

POST

[/busybar/time/timestamp](#/Time/setTimeTimestamp)

Set current timestamp

Sets the RTC timestamp in ISO 8601 format. Time zone qualifier (e.g. Z of UTC or +hh:mm for local time) is required.

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
timestamp \*

string($date-time)

(query)

 | 

ISO 8601 timestamp (e.g., 2025-10-02T14:30:45+02:00 for local time or 2025-10-02T14:30:45Z for UTC)

_Example_ : 2025-10-02T14:30:45+0100

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Timestamp set successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid timestamp format or value

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/time/timezone](#/Time/getTimeTimezone)

Get timezone

Get current timezone name

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Timezone got successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "name": "Bangalore",
  "offset": "+05:30",
  "abbr": "IST"
}
```









 | _No links_ |
| 400 | 

Invalid timezone offset

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/time/timezone](#/Time/setTimeTimezone)

Set timezone

Sets the timezone name. Use /api/time/tzlist to get available names list.

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
timezone \*

string

(query)

 | 

Timezone name (use /api/time/tzlist to get available names)

_Example_ : Berlin

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Timezone set successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid timezone offset

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/time/tzlist](#/Time/getTimeTzlist)

Get list of supported time zones

Retrieves the list of time zones accepted by /api/time/timezone

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Got the list successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "list": [
    {
      "name": "Bangalore",
      "offset": "+05:30",
      "abbr": "IST"
    }
  ]
}
```









 | _No links_ |
| 400 | 

Error getting time zone list

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Updater](#/Updater)

Firmware update control

POST

[/busybar/update](#/Updater/updateFirmware)

Update firmware

Uploads a firmware update package (TAR file) and initiates the update process.

#### Parameters

Try it out

No parameters

#### Request body

application/octet-stream

_Example values are not available for `application/octet-stream` media types._

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Update initiated successfully. The device will reboot.

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid parameters, invalid TAR file, or update preparation failed.

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 409 | 

Upload received on a closed or invalid update context.

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 413 | 

Update package too large.

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 508 | 

Failed to save the update package.

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/update/check](#/Updater/checkFirmwareUpdate)

Start firmware update check

Initiates an asynchronous check for available firmware updates.

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Update check started successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 409 | 

Update check already in progress

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 503 | 

Failed to start update check

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

GET

[/busybar/update/status](#/Updater/getFirmwareUpdateStatus)

Get firmware update status

Returns current update and check status including progress information.

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Status retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "install": {
    "is_allowed": true,
    "event": "none",
    "action": "none",
    "status": "ok",
    "detail": "",
    "download": {
      "speed_bytes_per_sec": 0,
      "received_bytes": 0,
      "total_bytes": 0
    }
  },
  "check": {
    "available_version": "1.2.3",
    "event": "stop",
    "status": "available"
  }
}
```









 | _No links_ |

GET

[/busybar/update/changelog](#/Updater/getUpdateChangelog)

Get update changelog

Returns the changelog for a specific firmware version.

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
version \*

string

(query)

 | 

Firmware version to get changelog for

_Example_ : 1.2.3

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Changelog retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "changelog": "string"
}
```









 | _No links_ |
| 400 | 

Version parameter missing, update not available, or version mismatch

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/update/install](#/Updater/installFirmwareUpdate)

Install firmware update

Starts asynchronous firmware installation from a remote URL. The update process (download, SHA verification, unpack, prepare, reboot) runs in the background. Use /api/update/status to monitor progress.

#### Parameters

Try it out

| Name | Description |
| --- | --- |
| 
version \*

string

(query)

 | 

Firmware version to install

_Example_ : 1.2.3

 |

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Update installation started successfully in background

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Version parameter missing, update not available, or version mismatch

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 409 | 

Update already in progress

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 503 | 

Battery too low or installation failed to start

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

POST

[/busybar/update/abort\_download](#/Updater/abortFirmwareDownload)

Abort ongoing firmware download

Signals the updater to abort an ongoing download operation.

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Abort signal sent successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |

GET

[/busybar/update/autoupdate](#/Updater/getAutoupdateSettings)

Get autoupdate settings

Returns current autoupdate configuration

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Settings retrieved successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "is_enabled": true,
  "interval_start": "00:00",
  "interval_end": "08:00"
}
```









 | _No links_ |

POST

[/busybar/update/autoupdate](#/Updater/setAutoupdateSettings)

Set autoupdate settings

Updates autoupdate configuration. All fields are optional - only provided fields are updated.

#### Parameters

Try it out

No parameters

#### Request body

application/json

-   Example Value
-   Schema

```json
{
  "is_enabled": true,
  "interval_start": "00:00",
  "interval_end": "08:00"
}
```

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
Settings updated successfully

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "result": "OK"
}
```









 | _No links_ |
| 400 | 

Invalid time format (expected HH:MM)

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |
| 503 | 

Failed to apply settings

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |

### [Wi-Fi](#/Wi-Fi)

Allows to operate with Wi-Fi

GET

[/busybar/wifi/status](#/Wi-Fi/get_busybar_wifi_status)

Returns current Wi-Fi status

#### Parameters

Try it out

No parameters

#### Responses

| Code | Description | Links |
| --- | --- | --- |
| 200 | 
OK

Media type

application/json

Controls `Accept` header.

-   Example Value
-   Schema

```json
{
  "state": "disconnected",
  "ssid": "Your_WIFI_SSID",
  "bssid": "EC:5A:00:0B:55:1D",
  "channel": 3,
  "rssi": -43,
  "security": "WPA3",
  "ip_config": {
    "ip_method": "dhcp",
    "ip_type": "ipv4",
    "address": "192.168.50.5"
  }
}
```









 | _No links_ |
| 503 | 

Wi-Fi operation failed

Media type

application/json

-   Example Value
-   Schema

```json
{
  "error": "Invalid parameter",
  "code": 400
}
```









 | _No links_ |