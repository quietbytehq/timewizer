# Packaging for the Snap Store and Flathub

Files:

| File | What it is |
|---|---|
| `snap/snapcraft.yaml` | The snap (name `timewizer`, strict, GNOME extension, `home` and `removable-media` access) |
| `packaging/linux/io.github.quietbytehq.timewizer.desktop` | Menu entry (also used by the Flatpak and the snap) |
| `packaging/linux/io.github.quietbytehq.timewizer.metainfo.xml` | AppStream: the store page text, screenshots, release notes |
| `packaging/linux/io.github.quietbytehq.timewizer.xml` | Tells Linux that `*.twz` files are Timewizer schools |
| `packaging/flatpak/io.github.quietbytehq.timewizer.yml` | The Flatpak manifest (offline build from source) |
| `packaging/flatpak/cargo-sources.json`, `node-sources.json` | Every Rust crate and npm package, so Flathub can build without network |
| `packaging/flatpak/build/` | The npm package list used for the Flatpak build (no test tools) |

Checked here: the AppStream file and the menu entry pass `appstreamcli validate --pedantic` and
`desktop-file-validate`; the YAML files parse; the version is the same everywhere
(`npm run check:versions`); the Rust program compiles with the settings the Flatpak uses.
**Not run here** (no Snapcraft or Flatpak in the build machine): the snap build, the Flatpak build,
and running either one. Do the "Try it first" steps before you publish.

## Every release (both stores)

1. Change the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
   (and run `npm install --package-lock-only`), add a `<release>` at the top of the `<releases>`
   list in the AppStream file, and set `tag: vX.Y.Z` in the Flatpak manifest.
2. `npm run check:versions` must say the version is the same everywhere.
3. If `Cargo.lock` or `package-lock.json` changed: `bash packaging/flatpak/update-sources.sh`.
4. Commit, then publish to the public repository (see the export script), then
   `git tag vX.Y.Z && git push origin vX.Y.Z` there. The tag builds the installers and publishes the snap.
5. Flathub: put the tag's full commit id in the manifest (`git rev-parse vX.Y.Z`) and send it to Flathub.

## Snap Store

### One time: let GitHub publish for you

The snap name `timewizer` is already registered. GitHub needs a *login that may only upload this snap*.

1. On an Ubuntu computer: `sudo snap install snapcraft --classic`
2. Log in to the Snap Store: `snapcraft login`
3. Make the credentials file (change the date to about one year from now):
   ```
   snapcraft export-login --snaps timewizer \
     --acls package_access,package_push,package_update,package_release \
     --expires "2027-10-17T00:00:00" credentials.txt
   ```
4. Open the file `credentials.txt` and copy **everything** in it.
5. On GitHub open the public repository, then **Settings → Secrets and variables → Actions →
   New repository secret**. Name: `SNAPCRAFT_STORE_CREDENTIALS`. Value: paste the text. Save.
6. Delete `credentials.txt` from your computer (`shred -u credentials.txt`). Do not email it or commit it.
7. Put a reminder in your calendar a few weeks before the date in step 3: the login stops working then,
   and you must repeat these steps.

### Try it first

On Ubuntu 24.04: `sudo snap install snapcraft --classic`, then in the project folder
`snapcraft pack --use-lxd` (or `sudo snapcraft pack --destructive-mode`).
Install it with `sudo snap install --dangerous ./timewizer_*.snap` and start **Timewizer**.
Check: it opens, you can create and save a school in your home folder, import the sample files, build a
timetable, and export a PDF. If a window stays empty or closes at once, run `snap run timewizer` in a
terminal and send me the messages. The most likely trouble is WebKit finding its helper programs;
the two `WEBKIT_` lines and the `layout` in `snapcraft.yaml` are there for that.

### Publish

Pushing a tag like `v0.1.2` runs the **snap** job, which builds the snap and uploads it to the
**stable** channel. You can also run the **Release** workflow by hand (Actions tab): it then only builds
the snap and attaches it to the run, without publishing.

Good to know:
- The first upload of a new snap can wait for a store review. Check the dashboard at
  <https://snapcraft.io/timewizer/releases>.
- Removable drives (the `removable-media` access) are not connected automatically. People can run
  `sudo snap connect timewizer:removable-media`. To have it connected at install, ask the Snap Store
  team on the forum (<https://forum.snapcraft.io>, category "store requests") once the snap is live.
- Each upload needs a new version number. If a release goes wrong after the snap was uploaded, fix it and release the next version (for example 0.1.2) instead of reusing the number.

## Flathub

The application ID `io.github.quietbytehq.timewizer` matches the GitHub address
`github.com/quietbytehq/timewizer`, which is what Flathub expects for GitHub projects.

### Try it first (Ubuntu or any Linux)

```
sudo apt install flatpak flatpak-builder
flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
bash packaging/flatpak/build-local.sh
flatpak run io.github.quietbytehq.timewizer
```
It builds from your working copy (no network is used for the crates and packages). Check the same things as for
the snap, and double-click a `.twz` file in the file manager.

Two things I could not check here, so look at them in this first build:
1. The GNOME runtime number in the manifest (`runtime-version`). Use the newest one Flathub supports
   (see <https://docs.flathub.org/docs/for-app-authors/runtimes>). Timewizer needs `libwebkit2gtk-4.1`
   inside the runtime: `flatpak run --command=sh org.gnome.Platform//49 -c 'ls /usr/lib/x86_64-linux-gnu | grep webkit2gtk'`.
   If your runtime number is different, change it and also check the `rust-stable` and `node22` extensions exist for it.
2. That the window opens and the file dialogs work (they use the desktop portal).

Check the manifest and store page with Flathub's own checker:
```
flatpak install --user flathub org.flatpak.Builder
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest packaging/flatpak/io.github.quietbytehq.timewizer.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder appstream packaging/linux/io.github.quietbytehq.timewizer.metainfo.xml
```
(The manifest check will say the git `commit` is a placeholder until you do step 3 below.)

### Send it to Flathub (first time)

1. Publish the release to the public repository and push the tag (`vX.Y.Z`). The screenshots in the
   AppStream file are read from the public repository's `main` branch, so it must be public first.
2. Get the full commit id: `git rev-parse vX.Y.Z` (in the public repository). In the manifest, put it as
   `commit:` (the tag's commit, 40 characters) and keep `tag: vX.Y.Z`. Commit this change to the private
   repository as well, so both stay the same.
3. On GitHub, **fork** `https://github.com/flathub/flathub`. When forking, **untick** "Copy the master branch only"
   so the `new-pr` branch comes along.
4. Clone your fork on the `new-pr` branch and make a branch from it:
   ```
   git clone --branch=new-pr git@github.com:YOUR-NAME/flathub.git
   cd flathub
   git checkout -b timewizer-submission new-pr
   ```
5. Copy three files into the **root** of the clone, with these names:
   ```
   cp PATH/TO/timewizer/packaging/flatpak/io.github.quietbytehq.timewizer.yml .
   cp PATH/TO/timewizer/packaging/flatpak/cargo-sources.json .
   cp PATH/TO/timewizer/packaging/flatpak/node-sources.json .
   git add .
   git commit -m "Add io.github.quietbytehq.timewizer"
   git push origin timewizer-submission
   ```
6. On GitHub open a pull request from `timewizer-submission` to the **`new-pr`** branch of `flathub/flathub`
   (not `master`). Title: `Add io.github.quietbytehq.timewizer`. Fill in the checklist. A Flathub reviewer will answer
   in the pull request; to start a test build comment `bot, build`.
7. When it is accepted, Flathub creates `github.com/flathub/io.github.quietbytehq.timewizer`. You will get an
   invitation to it; accept it. From then on, updates go there.

### Updating on Flathub

In the Flathub repository for the app, change `tag:` and `commit:` in the manifest (and replace
`cargo-sources.json` / `node-sources.json` if you ran `update-sources.sh`), and open a pull request.
The release notes people see come from the AppStream file in the project, so add the new `<release>` there first.
