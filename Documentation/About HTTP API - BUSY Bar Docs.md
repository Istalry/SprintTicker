Development

# About HTTP API

![Document image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/IkfzK-kzJ0SiFV4TF5D3L_busy-bar-http-api.png?format=webp "Document image")

The open HTTP API lets you fully control BUSY Bar using your own scripts, applications, or services in any programming language. The HTTP API is available over USB, Wi-Fi, and the internet.

On this page, you'll learn about the HTTP API:

-   ﻿[Capabilities](https://docs.busy.app/bar/dev/http-api#capabilities)﻿ ﻿![Inline image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/JOYoOfZBWq8K46a17xtZ8-20260312-164747.png?format=webp)﻿

-   ﻿[Authentication](https://docs.busy.app/bar/dev/http-api#authentication)﻿ ﻿![Inline image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/JOYoOfZBWq8K46a17xtZ8-20260312-164747.png?format=webp)﻿

-   ﻿[HTTP API reference](https://docs.busy.app/bar/dev/http-api#http-api-reference)﻿ ﻿![Inline image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/JOYoOfZBWq8K46a17xtZ8-20260312-164747.png?format=webp)﻿

-   ﻿[busylib libraries](https://docs.busy.app/bar/dev/http-api#uZjUs)﻿ ﻿![Inline image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/JOYoOfZBWq8K46a17xtZ8-20260312-164747.png?format=webp)﻿

# Capabilities

-   **Timer control** — control the BUSY and CUSTOM modes.

-   **Display control** — render text and images on both displays, adjust brightness.

-   **Audio control** — upload and play audio files, adjust volume.

-   **Real-time updates** — get display frames and device state changes over WebSocket.

-   **Input simulation** — emulate button presses and scroll wheel events.

-   **File management** — upload, organize, and delete files stored on the device.

-   **Firmware updates** — update firmware from a local file or over the internet.

-   **Wi-Fi and Bluetooth** — scan and connect the device to Wi-Fi networks, enable BLE advertising, remove BLE pairings, and check connection status.

-   **BUSY account** — link or unlink the device with your BUSY account, get account info.

-   **Matter integration** — connect the device to your smart home.

-   **System config** — set the device name, system time, time zone, and more.

-   **System info** — get device status, power, and firmware details.

# How it works

HTTP API follows a client-server architecture. The BUSY Bar acts as an **HTTP Server**, waiting for incoming requests, while an **HTTP Client** sends requests to the device.

![Document image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/iX1a0ZGC8GBg0kjCEvZJu_http-communication.jpg?format=webp "Document image")

The HTTP client can be any application capable of sending HTTP requests, such as a smart home system, a script, a desktop or mobile application, or even a web browser. For the simplest test, connect BUSY Bar to your computer via USB and enter: 10.0.4.20/api/status/firmware. The browser will send an HTTP request to BUSY Bar and display its response:

![Document image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/MpHOiaXv4lohpsJFm72HJ_request-and-response-newest.jpg?format=webp "Document image")

An HTTP request URL consists of:

-   **Base URL**, which depends on how BUSY Bar is connected.

-   **Endpoint**, which identifies the type of request to BUSY Bar. All available endpoints are listed in the HTTP API reference.

![Document image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/wWkeyyNgBJ0y8KJiZlR7j_base-url-and-endpoint-new.jpg?format=webp "Document image")

## Base URL

The base URL for HTTP API requests depends on how your BUSY Bar is connected:

-   **Via USB:** Use [http://10.0.4.20](http://10.0.4.20) as the base URL.

-   **Via Wi-Fi (LAN):** Use the IP address assigned by your Wi-Fi router. To view the current IP address on your BUSY Bar, go to **Settings → Wi-Fi → \[Your Wi-Fi AP name\] → View IP Address**.

-   **Via internet:** Use [https://api.busy.app](https://api.busy.app) as the base URL.

Connecting via Wi-Fi (LAN) or the internet requires authentication. For details, see the [Authentication](https://docs.busy.app/bar/dev/http-api#authentication)﻿ section below.

﻿

## Wi-Fi access

Wi-Fi (LAN) connections to BUSY Bar are **disabled by default for security reasons**. This applies to both the local web interface and the HTTP API.

To enable Wi-Fi access to BUSY Bar:

1

Connect your BUSY Bar to a computer via USB.

2

Open the BUSY Bar local web interface in a web browser: [http://10.0.4.20/](http://10.0.4.20/)﻿

3

On the **Network** page, in the **HTTP API** section, turn on the **HTTP API access** toggle.

4

Click **Set password and enable** and set a password.

From now on, BUSY Bar will ask for this password every time you log in to the web interface via Wi-Fi. You'll also need to include this password in all HTTP requests for authentication.

# Authentication

Authentication is how the device verifies that an incoming HTTP API request was actually sent by its owner or someone the owner trusts. Without authentication, BUSY Bar returns a 403 Forbidden error in response to the request.

The authentication method depends on how you connect to BUSY Bar: via USB, Wi-Fi, or the internet.

﻿

## Via USB

A USB connection is considered a secure communication channel, so authentication is not used over USB. You can send any HTTP API requests to the device at its IP address 10.0.4.20 without authentication.

﻿

## Via Wi-Fi

HTTP API requests over Wi-Fi (LAN) are authenticated using a password that is configured in the local web interface when Wi-Fi access is enabled. Learn more about enabling Wi-Fi access in the [Wi-Fi Access](https://docs.busy.app/bar/dev/http-api#wi-fi-access)﻿ section.

Every HTTP request sent to the device via Wi-Fi must include this password in the X-API-Token header.

See examples below:

curl

JavaScript

Python

Bash

1curl \-X GET \\ 2 "http://\[BUSY Bar IP address\]/api/status" \\ 3 \-H "Accept: application/json" \\ 4 \-H 'X-API-Token: <your password>'  

curl -X GET \\ "http://\[BUSY Bar IP address\]/api/status" \\ -H "Accept: application/json" \\ -H 'X-API-Token: <your password>'

JS

1const response \= await fetch("http://\[BUSY Bar IP address\]/api/status", { 2 headers: { 3 "Accept": "application/json", 4 "X-API-Token": <your password\>, 5 }, 6});  

const response = await fetch("http://\[BUSY Bar IP address\]/api/status", { headers: { "Accept": "application/json", "X-API-Token": <your password>, }, });

﻿

Python

1import requests 2 3response \= requests.get( 4 "http://\[BUSY Bar IP address\]/api/status", 5 headers\={ 6 "Accept": "application/json", 7 "X-API-Token": <your password\>, 8 }, 9)  

import requests response = requests.get( "http://\[BUSY Bar IP address\]/api/status", headers={ "Accept": "application/json", "X-API-Token": <your password>, }, )

## Via internet

Internet authentication is performed using an API token, which is generated in your BUSY account after you connect your BUSY Bar to the account. Learn more about [managing API tokens](https://docs.busy.app/bar/dev/api-tokens)﻿.

Every HTTP request sent to the device must include this API token in the Authorization header using the Bearer authentication scheme.

See examples below:

curl

JavaScript

Python

Bash

1curl \-X GET \\ 2 "https://api.busy.app/busybar/status" \\ 3 \-H "Accept: application/json" \\ 4 \-H "Authorization: Bearer <your\_api\_token>"  

curl -X GET \\ "https://api.busy.app/busybar/status" \\ -H "Accept: application/json" \\ -H "Authorization: Bearer <your\_api\_token>"

JS

1const response \= await fetch("https://api.busy.app/busybar/status", { 2 headers: { 3 "Accept": "application/json", 4 "Authorization": "Bearer <your\_api\_token>", 5 }, 6});  

const response = await fetch("https://api.busy.app/busybar/status", { headers: { "Accept": "application/json", "Authorization": "Bearer <your\_api\_token>", }, });

﻿

Python

1import requests 2 3response \= requests.get( 4 "https://api.busy.app/busybar/status", 5 headers\={ 6 "Accept": "application/json", 7 "Authorization": "Bearer <your\_api\_token>", 8 }, 9)  

import requests response = requests.get( "https://api.busy.app/busybar/status", headers={ "Accept": "application/json", "Authorization": "Bearer <your\_api\_token>", }, )

# HTTP API reference

![Document image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/4dFJ3HzduKFSQh63UrYZX_api-reference-2.jpg?format=webp "Document image")

﻿[HTTP API reference](https://api.busy.app/busybar/docs) is an interactive page where you can:

-   **Browse all HTTP API endpoints** — view all supported API requests.

-   **View the API schemas** that describe the JSON objects used by the HTTP API.

-   **Download the** **openapi.yml** **file**, which contains the HTTP API specification in the OpenAPI format.

-   **Test any API request**. Expand the desired endpoint, click **Try it out**, edit the request parameters or body if necessary, and then click **Execute**.

﻿

## How to open the HTTP API reference

You can open the HTTP API reference in one of two ways:

### ﻿Option 1: From the BUSY Bar local web interface

Open the following URL in your web browser:

-   http://10.0.4.20/docs (when connected over USB)

-   http://<BUSY Bar IP address>/docs (when connected over Wi-Fi)

Alternatively, open the **Network** tab in the local web interface and, in the **HTTP API** section, click either **Over USB** or **Over Wi-Fi**.

This opens the HTTP API reference hosted directly on the device. It documents the version of the HTTP API implemented in the device's firmware. When you test API requests from the reference page, they are sent directly to the BUSY Bar over Wi-Fi or USB.

﻿

### ﻿Option 2: Public HTTP API reference

Open the following URL in your web browser: [https://api.busy.app/busybar/docs](https://api.busy.app/busybar/docs)﻿

In the page header, you can select the BUSY Bar firmware version whose HTTP API reference you want to view.

When you test API requests from the public reference page, the requests are sent to your BUSY Bar over the Internet through our cloud service.

﻿

## Testing requests from the HTTP API reference

To test API requests, you may need to authenticate first, depending on how you access the HTTP API reference:

-   **Over USB** (http://10.0.4.20/docs) — no authentication needed, just send requests.

-   **Over Wi-Fi (LAN)** — click **Authorize** and enter the password you set when [enabling Wi-Fi access](https://docs.busy.app/bar/dev/http-api#wi-fi-access)﻿.

-   **Over the internet** (api.busy.app/busybar/docs) — click **Authorize** and enter an [API token](https://docs.busy.app/bar/dev/api-tokens)﻿ generated in your BUSY account.

![Document image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/urCvodqUmRWLr1wCkURUL_authorize-new.jpg?format=webp "Document image")

To test HTTP API requests directly from the HTTP API reference, expand the desired endpoint, click **Try it out**, edit the request body if necessary, and then click **Execute**.

![Document image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/3deHsBUECSn0anNI9m9qW_testing-responses-3.jpg?format=webp "Document image")

Once you click **Execute**, BUSY Bar performs the request immediately. For example, sending the default request body of the /busybar/display/draw endpoint shows this on the display:

![Document image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/Hi82VmIXuPWW422k3Sqw7_test-responses-draw.jpg?format=webp "Document image")

# busylib libraries

**busylib** is the official open-source library for building applications that interact with BUSY Bar. It provides ready-to-use Python and TypeScript APIs that abstract the underlying HTTP API.

﻿

## Advantages

-   **Simplifies development** by handling HTTP request construction and response processing. Developers can work with a simple, high-level API without worrying about the underlying HTTP protocol.

-   **Implements WebSocket communication** for receiving real-time events from the device and for screen streaming.

-   **Supports both synchronous and asynchronous interaction** with BUSY Bar, making it suitable for both simple applications and concurrent workflows.

﻿

## **Get busylib**

busylib is available for Python and TypeScript:

![Link block header image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/2nMyL30R83hSoqpG17NSK_ts-logo.jpg?format=webp)

﻿[**TypeScript library**](https://go.busy.app/typescript-library)﻿

![Link block header image](https://images.archbee.com/3StCFqarJkJQZV-7N79yY/ayHOmRd7ESYDHNI9TSIkL_python-logo.jpg?format=webp)

﻿[**Python library**](https://pypi.org/project/busylib/)﻿

﻿

Updated 23 Jul 2026

![Doc contributor](https://archbee-profile-photos.s3.amazonaws.com/3StCFqarJkJQZV-7N79yY/IBqf--4jjt2UJXadPkmD1_.blob)

![Doc contributor](https://archbee-profile-photos.s3.amazonaws.com/3StCFqarJkJQZV-7N79yY/Kvhn1YR6-yun24x5ivBKZ_.blob)

[PREVIOUS

Development](https://docs.busy.app/bar/dev)[NEXT

API tokens](https://docs.busy.app/bar/dev/api-tokens)

[Docs powered by Archbee](https://www.archbee.com/?utm_campaign=hosted-docs&utm_medium=referral&utm_source=docs.busy.app)