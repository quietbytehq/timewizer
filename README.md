# Timewizer

Timetables for a single school, on your own computer. Offline, one file per school, no login.
Open source (Apache-2.0).

## Install (Windows)

Download from the project's Releases page, then either:

- **Setup .exe** (recommended): double-click `Timewizer_0.1.0_x64-setup.exe` and follow the steps. Then open **Timewizer** from the Start menu.
- **.msi** (for school IT staff): `msiexec /i Timewizer_0.1.0_x64_en-US.msi` (add `/qn` for a silent install).

The installers are not code-signed yet, so Windows may show a blue **"Windows protected your PC"** screen. Press **More info**, then **Run anyway**. Timewizer needs Microsoft's WebView2, which is already part of Windows 10/11; if it is missing, the installer downloads it (internet needed once).

Double-clicking a `.twz` school file opens it in Timewizer.

## Install (Ubuntu / Linux)

Download from the project's Releases page (or build it yourself, below), then either:

- **.deb** (recommended): `sudo apt install ./Timewizer_0.1.0_amd64.deb`, then open **Timewizer** from the applications menu.
- **AppImage** (no install): `chmod +x Timewizer_0.1.0_amd64.AppImage` and double-click it, or run it from a terminal.

New to the app? Read the short guide: [docs/Timewizer-User-Guide.pdf](docs/Timewizer-User-Guide.pdf).
Sample school data to try it with is in [samples/](samples/).

## Make a release (maintainers)

Push a tag: `git tag v0.1.0 && git push origin v0.1.0`. GitHub builds the Linux and Windows installers
and attaches them to a **draft** release (Releases page) for you to check and publish. You can also run the
**Release** workflow by hand from the Actions tab to just get the files.

## Build it yourself

On Windows, install [Node.js](https://nodejs.org), [Rust](https://rustup.rs) and the Visual Studio C++ Build Tools, then run the same `npm` commands below (skip the `apt` line).


```
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf
npm ci
npm run release           # the installers for this computer appear in ./release
npm run tauri dev         # run the app while developing
npm run test:ui           # automated UI tests (see tests/ui/README.md)
npm run guide             # rebuild the PDF user guide
```

Example exports (PDF, Excel, CSV, picture) are in [docs/examples/](docs/examples/) and screenshots
of every page, in light and dark, are in [docs/screenshots/](docs/screenshots/).
