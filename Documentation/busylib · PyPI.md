-   [Project description](#description)
-   [Project details](#data)
-   [Release history](#history)
-   [Download files](#files)

## Project description

# busylib

[![PyPI version](https://pypi-camo.freetls.fastly.net/516661583e919845b48d25e9710afb24b7438983/68747470733a2f2f696d672e736869656c64732e696f2f707970692f762f627573796c69622e7376673f6c6162656c3d50795049)](https://pypi.org/project/busylib/) [![Python versions](https://pypi-camo.freetls.fastly.net/f4e2e3ffd5e18487a64c9d767758d62c8a52a524/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f707974686f6e2d332e3130253230253743253230332e3131253230253743253230332e3132253230253743253230332e3133253230253743253230332e31342d626c7565)](https://pypi.org/project/busylib/) [![License: MIT](https://pypi-camo.freetls.fastly.net/f7db8d43223f55fabe102838639f47819829c1ca/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f6c6963656e73652d4d49542d677265656e2e737667)](https://github.com/busy-app/busylib-py/blob/main/LICENSE)

A simple and intuitive Python client for interacting with the Busy Bar API. This library allows you to programmatically control the device's display, audio, and assets.

## Features

-   Easy-to-use API for all major device functions.
-   Upload and manage assets for your applications.
-   Control the display by drawing text and images.
-   Play and stop audio files.
-   Built-in validation for device IP addresses.

## Installation

You can install `busylib` directly from PyPI:

```
pip install busylib
```

Upgrade to the latest release:

```
pip install --upgrade busylib
```

## Usage

First, import and initialize the `BusyBar` client with IP address of your device.

```
from busylib import BusyBar

bb = BusyBar("10.0.4.20")

version_info = bb.version()
print(f"Device version: {version_info.version}")
```

You can also use context manager.

```
from busylib import BusyBar

with BusyBar("10.0.4.20") as bb:
    version_info = bb.version()
    print(f"Device version: {version_info.version}")
```

For concurrent workflows, use the async client to avoid blocking I/O.

```
import asyncio

from busylib import AsyncBusyBar


async def main() -> None:
    async with AsyncBusyBar("10.0.4.20") as bb:
        version_info = await bb.version()
        print(f"Device version: {version_info.version}")


if __name__ == "__main__":
    asyncio.run(main())
```

## API Examples

Here are some examples of how to use the library to control your Busy Bar device.

Client method names follow Busy Bar API path segments instead of generic `get_*`/`set_*` prefixes. For example, `/api/display/draw` maps to `display_draw`, `/api/audio/play` maps to `audio_play`, and `/api/storage/remove` maps to `storage_remove`.

### Uploading an Asset

You can upload files (like images or sounds) to be used by your application on the device.

```
with open("path/to/your/image.png", "rb") as f:
    file_bytes = f.read()
    response = bb.assets_upload(
        application_name="my-app",
        filename="logo.png",
        data=file_bytes,
    )
    print(f"Upload result: {response.result}")


with open("path/to/your/sound.wav", "rb") as f:
    file_bytes = f.read()
    response = bb.assets_upload(
        application_name="my-app",
        filename="notification.wav",
        data=file_bytes,
    )
```

### Drawing on the Display

Draw text or images on the device's screen. The `display_draw` method accepts a `DisplayElements` object containing a list of elements to render.

```
from busylib import types


text_element = types.TextElement(
    id="hello",
    type="text",
    x=10,
    y=20,
    text="Hello, World!",
    font="small",
    display=types.DisplayName.FRONT,
)

image_element = types.ImageElement(
    id="logo",
    type="image",
    x=50,
    y=40,
    path="logo.png",
    display=types.DisplayName.BACK,
)

display_data = types.DisplayElements(
    application_name="my-app",
    elements=[text_element, image_element]
)

response = bb.display_draw(display_data)
print(f"Draw result: {response.result}")
```

### Clearing the Display

To clear everything from the screen:

```
response = bb.display_clear()
print(f"Clear result: {response.result}")
```

### Playing Audio

Play an audio file that you have already uploaded.

```
response = bb.audio_play(application_name="my-app", path="notification.wav")
print(f"Play result: {response.result}")
```

### Stopping Audio

To stop any audio that is currently playing:

```
response = bb.audio_stop()
print(f"Stop result: {response.result}")
```

### Deleting All Assets for an App

This will remove all files associated with a specific `application_name`.

```
response = bb.assets_delete(application_name="my-app")
print(f"Delete result: {response.result}")
```

### Getting Device Status

You can get various status information from the device:

```
version = bb.version()
print(f"Version: {version.version}, Branch: {version.branch}")

status = bb.status()
if status.system:
    print(f"Uptime: {status.system.uptime}")
if status.power:
    print(f"Battery: {status.power.battery_charge}%")

brightness = bb.display_brightness()
print(f"Front brightness: {brightness.front}, Back brightness: {brightness.back}")

volume = bb.audio_volume()
print(f"Volume: {volume.volume}")
```

### Preparing and Executing Requests Separately

You can prepare a low-level request first and execute it later, optionally with a different HTTP client/pool.

```
from busylib import BusyBar

bb = BusyBar("10.0.4.20")
prepared = bb.prepare_request(
    "POST",
    "/api/audio/play",
    json_payload={"application_name": "my-app", "path": "notification.snd"},
)

# execute now
result = bb.execute_prepared_request(prepared)

# or execute with an external client
# with httpx.Client(base_url="http://10.0.4.20") as ext:
#     result = bb.execute_prepared_request(prepared, client=ext)
```

### Working with Storage

You can manage files in the device's storage:

```
file_data = b"Hello, world!"
response = bb.storage_write(path="/my-app/data.txt", data=file_data)

file_content = bb.storage_read(path="/my-app/data.txt")
print(file_content.decode('utf-8'))

storage_list = bb.storage_list(path="/my-app")
for item in storage_list.list:
    if item.type == "file":
        print(f"File: {item.name} ({item.size} bytes)")
    else:
        print(f"Directory: {item.name}")

response = bb.storage_mkdir(path="/my-app/subdirectory")

response = bb.storage_remove(path="/my-app/data.txt")
```

## Links

-   Documentation: [https://busylib.readthedocs.io](https://busylib.readthedocs.io)
-   Source: [https://github.com/busy-app/busylib-py](https://github.com/busy-app/busylib-py)
-   PyPI: [https://pypi.org/project/busylib/](https://pypi.org/project/busylib/)

## Development

To set up a development environment, clone the repository and install the package in editable mode with test dependencies:

```
git clone https://github.com/busy-app/busylib-py
cd busylib-py
python3 -m venv .venv
source .venv/bin/activate
make install-dev
```

To run the tests:

```
make test
```

To regenerate protobuf models for `/api/status/ws`:

```
make proto-sync
```

This target pulls schemas from `https://github.com/flipperdevices/bsb-protobuf` into `.cache/bsb-protobuf` and regenerates Python protobuf modules in `src/busylib/state_stream_proto` using `uv run python -m grpc_tools.protoc` from dev dependencies.

## Project details

### Verified details

_These details have been [verified by PyPI](https://docs.pypi.org/project_metadata/#verified-details)_

###### Project links

-   [Homepage](https://github.com/busy-app/busylib-py)
-   [Repository](https://github.com/busy-app/busylib-py)

###### GitHub Statistics

-   [**Repository**](https://github.com/busy-app/busylib-py)
-   [**Stars:** 10](https://github.com/busy-app/busylib-py/stargazers)
-   [**Forks:** 2](https://github.com/busy-app/busylib-py/network/members)
-   [**Open issues:** 0](https://github.com/busy-app/busylib-py/issues)
-   [**Open PRs:** 3](https://github.com/busy-app/busylib-py/pulls)

###### Maintainers

 [![Avatar for flipperdevices from gravatar.com](https://pypi-camo.freetls.fastly.net/a51f30390a6d9948988aa79dd58ea3602a229b98/68747470733a2f2f7365637572652e67726176617461722e636f6d2f6176617461722f34636332356166346161313839623334363330306639303966616666326466333f73697a653d3530 "Avatar for flipperdevices from gravatar.com")flipperdevices](https://pypi.org/user/flipperdevices/)

### Unverified details

_These details have **not** been verified by PyPI_

###### Project links

-   [Documentation](https://busylib.readthedocs.io)

###### Meta

-   **License Expression:** MIT  
    _[SPDX](https://spdx.org/licenses/) [License Expression](https://spdx.github.io/spdx-spec/v3.0.1/annexes/spdx-license-expressions/)_
-   **Author:** [flipperdevices](mailto:pypi@flipperdevices.com)
-   **Requires:** Python >=3.10

###### Classifiers

-   **Development Status**
    -   [3 - Alpha](https://pypi.org/search/?c=Development+Status+%3A%3A+3+-+Alpha)
-   **Intended Audience**
    -   [Developers](https://pypi.org/search/?c=Intended+Audience+%3A%3A+Developers)
-   **Programming Language**
    -   [Python :: 3 :: Only](https://pypi.org/search/?c=Programming+Language+%3A%3A+Python+%3A%3A+3+%3A%3A+Only)
    -   [Python :: 3.10](https://pypi.org/search/?c=Programming+Language+%3A%3A+Python+%3A%3A+3.10)
    -   [Python :: 3.11](https://pypi.org/search/?c=Programming+Language+%3A%3A+Python+%3A%3A+3.11)
    -   [Python :: 3.12](https://pypi.org/search/?c=Programming+Language+%3A%3A+Python+%3A%3A+3.12)
    -   [Python :: 3.13](https://pypi.org/search/?c=Programming+Language+%3A%3A+Python+%3A%3A+3.13)
    -   [Python :: 3.14](https://pypi.org/search/?c=Programming+Language+%3A%3A+Python+%3A%3A+3.14)

  

## Release history [Release notifications](https://pypi.org/help/#project-release-notifications) | [RSS feed](https://pypi.org/rss/project/busylib/releases.xml)

This version

![](https://pypi.org/static/images/blue-cube.572a5bfb.svg)

[1.0.0

Jun 23, 2026](https://pypi.org/project/busylib/1.0.0/)

![](https://pypi.org/static/images/white-cube.2351a86c.svg)

[0.4.2

Feb 13, 2026](https://pypi.org/project/busylib/0.4.2/)

![](https://pypi.org/static/images/white-cube.2351a86c.svg)

[0.4.1

Feb 2, 2026](https://pypi.org/project/busylib/0.4.1/)

![](https://pypi.org/static/images/white-cube.2351a86c.svg)

[0.3.0

Oct 25, 2025](https://pypi.org/project/busylib/0.3.0/)

![](https://pypi.org/static/images/white-cube.2351a86c.svg)

[0.2.0

Oct 24, 2025](https://pypi.org/project/busylib/0.2.0/)

![](https://pypi.org/static/images/white-cube.2351a86c.svg)

[0.1.0

Aug 11, 2025](https://pypi.org/project/busylib/0.1.0/)

![](https://pypi.org/static/images/white-cube.2351a86c.svg)

[0.0.2

Jul 15, 2025](https://pypi.org/project/busylib/0.0.2/)

![](https://pypi.org/static/images/white-cube.2351a86c.svg)

[0.0.1

Jun 25, 2025](https://pypi.org/project/busylib/0.0.1/)

![](https://pypi.org/static/images/white-cube.2351a86c.svg)

[0.0.1a0 pre-release

Jul 15, 2025](https://pypi.org/project/busylib/0.0.1a0/)

## Download files

Download the file for your platform. If you're not sure which to choose, learn more about [installing packages](https://packaging.python.org/tutorials/installing-packages/).

### Source Distribution

[busylib-1.0.0.tar.gz](https://files.pythonhosted.org/packages/64/36/a921887728abb6092af8e8ccf0cee3c4a4856054b9872cfa2dd202a98e2f/busylib-1.0.0.tar.gz) (49.4 kB [view details](#busylib-1.0.0.tar.gz))

Uploaded Jun 23, 2026 `Source`

### Built Distribution

Filter files by name, interpreter, ABI, and platform.

If you're not sure about the file name format, learn more about [wheel file names](https://packaging.python.org/en/latest/specifications/binary-distribution-format/).

Copy a direct link to the current filters [https://pypi.org/project/busylib/#files](https://pypi.org/project/busylib/#files) Copy

Showing 1 of 1 file.

File name 

Interpreter Interpreter py3

ABI ABI none

Platform Platform any

[busylib-1.0.0-py3-none-any.whl](https://files.pythonhosted.org/packages/19/13/bea3ac45df2cb0d41db9dc360a9639235187de8547febdf5b0bd7cbc6dec/busylib-1.0.0-py3-none-any.whl) (67.2 kB [view details](#busylib-1.0.0-py3-none-any.whl))

Uploaded Jun 23, 2026 `Python 3`

## File details

Details for the file `busylib-1.0.0.tar.gz`.

### File metadata

-   Download URL: [busylib-1.0.0.tar.gz](https://files.pythonhosted.org/packages/64/36/a921887728abb6092af8e8ccf0cee3c4a4856054b9872cfa2dd202a98e2f/busylib-1.0.0.tar.gz)
-   Upload date: Jun 23, 2026
-   Size: 49.4 kB
-   Tags: Source
-   Uploaded using Trusted Publishing? Yes
-   Uploaded via: twine/6.1.0 CPython/3.13.13

### File hashes

Hashes for busylib-1.0.0.tar.gz
| Algorithm | Hash digest |  |
| --- | --- | --- |
| SHA256 | `b0a91f7f66015a9f7f91dc180203c28056e7b354cc7b44b3598840b8b0b07a2b` | Copy |
| MD5 | `c2e50db222a1e8161e13d2e9e103d2c9` | Copy |
| BLAKE2b-256 | `6436a921887728abb6092af8e8ccf0cee3c4a4856054b9872cfa2dd202a98e2f` | Copy |

[See more details on using hashes here.](https://pip.pypa.io/en/stable/topics/secure-installs/#hash-checking-mode)

### Provenance

The following attestation bundles were made for `busylib-1.0.0.tar.gz`:

Publisher: [`pypi-publish.yml` on busy-app/busylib-py](https://github.com/busy-app/busylib-py/blob/HEAD/.github/workflows/pypi-publish.yml)

Attestations: _Values shown here reflect the state when the release was signed and may no longer be current._

-   Statement:
    
    -   Statement type: [`https://in-toto.io/Statement/v1`](https://in-toto.io/Statement/v1)
    -   Predicate type: [`https://docs.pypi.org/attestations/publish/v1`](https://docs.pypi.org/attestations/publish/v1)
    -   Subject name: `busylib-1.0.0.tar.gz`
    -   Subject digest: `b0a91f7f66015a9f7f91dc180203c28056e7b354cc7b44b3598840b8b0b07a2b`
    -   Sigstore transparency entry: [1929071080](https://search.sigstore.dev/?logIndex=1929071080)
    -   Sigstore integration time: Jun 23, 2026, 6:48:29 PM
    
    Source repository:
    
    -   Permalink: [`busy-app/busylib-py@1da538923fd7ff12ab612f9a2ae3b9ca128c750b`](https://github.com/busy-app/busylib-py/tree/1da538923fd7ff12ab612f9a2ae3b9ca128c750b)
    -   Branch / Tag: [`refs/tags/1.0.0`](https://github.com/busy-app/busylib-py/tree/refs/tags/1.0.0)
    -   Owner: [https://github.com/busy-app](https://github.com/busy-app)
    -   Access: `public`
    
    Publication detail:
    -   Token Issuer: `https://token.actions.githubusercontent.com`
    -   Runner Environment: `github-hosted`
    -   Publication workflow: [`pypi-publish.yml@1da538923fd7ff12ab612f9a2ae3b9ca128c750b`](https://github.com/busy-app/busylib-py/blob/1da538923fd7ff12ab612f9a2ae3b9ca128c750b/.github/workflows/pypi-publish.yml)
    -   Trigger Event: `release`

## File details

Details for the file `busylib-1.0.0-py3-none-any.whl`.

### File metadata

-   Download URL: [busylib-1.0.0-py3-none-any.whl](https://files.pythonhosted.org/packages/19/13/bea3ac45df2cb0d41db9dc360a9639235187de8547febdf5b0bd7cbc6dec/busylib-1.0.0-py3-none-any.whl)
-   Upload date: Jun 23, 2026
-   Size: 67.2 kB
-   Tags: Python 3
-   Uploaded using Trusted Publishing? Yes
-   Uploaded via: twine/6.1.0 CPython/3.13.13

### File hashes

Hashes for busylib-1.0.0-py3-none-any.whl
| Algorithm | Hash digest |  |
| --- | --- | --- |
| SHA256 | `7f7a4079e028d9f6280f859ec155cb724f049bf473abf14303b26b539dbb312c` | Copy |
| MD5 | `47fd79c8d6abc84881dedb42c7e530c8` | Copy |
| BLAKE2b-256 | `1913bea3ac45df2cb0d41db9dc360a9639235187de8547febdf5b0bd7cbc6dec` | Copy |

[See more details on using hashes here.](https://pip.pypa.io/en/stable/topics/secure-installs/#hash-checking-mode)

### Provenance

The following attestation bundles were made for `busylib-1.0.0-py3-none-any.whl`:

Publisher: [`pypi-publish.yml` on busy-app/busylib-py](https://github.com/busy-app/busylib-py/blob/HEAD/.github/workflows/pypi-publish.yml)

Attestations: _Values shown here reflect the state when the release was signed and may no longer be current._

-   Statement:
    
    -   Statement type: [`https://in-toto.io/Statement/v1`](https://in-toto.io/Statement/v1)
    -   Predicate type: [`https://docs.pypi.org/attestations/publish/v1`](https://docs.pypi.org/attestations/publish/v1)
    -   Subject name: `busylib-1.0.0-py3-none-any.whl`
    -   Subject digest: `7f7a4079e028d9f6280f859ec155cb724f049bf473abf14303b26b539dbb312c`
    -   Sigstore transparency entry: [1929071291](https://search.sigstore.dev/?logIndex=1929071291)
    -   Sigstore integration time: Jun 23, 2026, 6:48:30 PM
    
    Source repository:
    
    -   Permalink: [`busy-app/busylib-py@1da538923fd7ff12ab612f9a2ae3b9ca128c750b`](https://github.com/busy-app/busylib-py/tree/1da538923fd7ff12ab612f9a2ae3b9ca128c750b)
    -   Branch / Tag: [`refs/tags/1.0.0`](https://github.com/busy-app/busylib-py/tree/refs/tags/1.0.0)
    -   Owner: [https://github.com/busy-app](https://github.com/busy-app)
    -   Access: `public`
    
    Publication detail:
    -   Token Issuer: `https://token.actions.githubusercontent.com`
    -   Runner Environment: `github-hosted`
    -   Publication workflow: [`pypi-publish.yml@1da538923fd7ff12ab612f9a2ae3b9ca128c750b`](https://github.com/busy-app/busylib-py/blob/1da538923fd7ff12ab612f9a2ae3b9ca128c750b/.github/workflows/pypi-publish.yml)
    -   Trigger Event: `release`