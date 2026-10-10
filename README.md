# Emberwake

A 2D arena survival game for 1 to 4 players, with its website, sign-in and
multiplayer server. Plain HTML, CSS and JavaScript. No build step, no
dependencies.

## Play

```
node server.js
```

Open http://localhost:8080. The server also prints a network address
(for example http://192.168.1.20:8080) that other devices on the same Wi-Fi
can open to join your games.

## What's inside

```
index.html          Website: features, modes, install guide, FAQ
play.html           The game
account.html        Player profile and stats (sign-in required)
privacy.html        Privacy Policy
terms.html          Terms of Use
server.js           Web server + multiplayer rooms over WebSocket (/ws)
shared/sim.js       Game rules, shared by the browser and the server
js/game/            Renderer, audio, input, networking, menus and game loop
js/auth.js          Sign-in (Firebase: Google, email + password)
js/auth-config.js   Firebase settings
js/profile.js       Player name and stats (saved in the browser)
js/pwa.js, sw.js    Installable app + offline support
manifest.webmanifest
tools/              make-icons.mjs, build-zip.mjs
```

## Game modes

- **Solo**: survive the waves.
- **Local multiplayer**: 2 to 4 players on one computer (WASD + Space, arrows + Enter, gamepads).
- **LAN**: one computer runs `node server.js`, everyone on the Wi-Fi joins with a room code.
- **Online**: deploy `server.js` to a Node host and share the address.

## Putting it online

Any host that runs Node.js and supports WebSockets works. For example on
Render (free tier): create a **Web Service** from this folder, build command
empty, start command `node server.js`. Then:

1. Add the site's domain in Firebase → Authentication → Settings → Authorized domains.
2. Replace `privacy@example.com` and `legal@example.com` in `privacy.html` and `terms.html`.
3. If you add or rename files, add them to `CORE` in `sw.js` and bump `VERSION`.
4. Run `node tools/build-zip.mjs` to refresh `downloads/emberwake.zip`.

## Installing the game

Players install it from the browser (Chrome, Edge, Safari "Add to Dock" or
"Add to Home Screen"). It gets its own window and icon, works offline for solo
and local play, and updates itself. No unsigned .exe, so no SmartScreen warning.

## Installers (Windows, macOS, Linux, Android)

The desktop app (`desktop/main.js`, Electron) bundles the game and its server,
so it can also host LAN games. The Android app (`android/`, Capacitor) bundles
the game with touch controls. iPhone/iPad use "Add to Home Screen" in Safari:
Apple only allows App Store apps.

| Platform | Files | Build |
|---|---|---|
| Windows | `.msi`, `.exe` | `npm run dist:win` (on Windows) |
| Linux | `.AppImage`, `.deb` | `npm run dist:linux` (on Linux) |
| macOS | `.dmg` (Apple silicon + Intel) | `npm run dist:mac` (on a Mac) |
| Android | `.apk` | `npm run android:sync`, then `cd android && ./gradlew assembleDebug` (needs Android Studio) |

Run `npm install` once first. Builds land in `dist/`.

### Build everything automatically with GitHub (free)

`.github/workflows/build.yml` builds all installers on GitHub's Windows, Linux
and macOS machines:

1. Create a repository on github.com and push this folder to it.
2. Push a version tag: `git tag v1.0.0 && git push --tags`.
3. After ~15 minutes the installers are on the repository's **Releases** page.
4. Run `node tools/list-downloads.mjs v1.0.0` (with the new tag) so the website
   lists the new files. `js/downloads.js` already points to
   https://github.com/haydarcreator/emberwake/releases/latest/download/.
5. For a new version, bump `version` in `package.json`, `js/downloads.js` and
   `android/app/build.gradle`, then tag again (v1.1.0, ...).

To sign the Android app (needed for updates to install over older versions),
create a keystore once and add these repository secrets:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`. Without them the workflow builds a debug APK, which
installs fine for testing.

### Hosting installers on this site instead

Copy the files from `dist/` into `downloads/`, then run
`node tools/list-downloads.mjs`. The website lists every installer it finds
there and greys out the rest.

### Security warnings

The installers are not code-signed, so Windows SmartScreen ("Windows protected
your PC" → More info → Run anyway) and macOS Gatekeeper (right-click → Open)
warn on first launch. To remove the warnings: sign Windows builds (for example
Azure Trusted Signing, about 10 USD/month) and sign + notarize macOS builds
(Apple Developer Program, 99 USD/year). electron-builder picks up the
certificates from environment variables.

## Website hosting (Firebase)

The site is live at https://emberwake.web.app (Firebase Hosting, project
`java-sev`, site `emberwake`). To publish changes:

```
npx firebase-tools deploy --only hosting
```

`firebase.json` publishes the site and game only (no server, tools or
installers). Firebase Hosting can't run `server.js`, so online multiplayer
needs the server hosted elsewhere (for example Render); LAN play works with
the desktop app.
