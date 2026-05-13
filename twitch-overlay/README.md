# Twitch Chat Overlay

A zero-dependency, pure vanilla JS Twitch chat overlay for OBS Studio.

## File Structure

```
twitch-overlay/
├── index.html   — Entry point, loaded by OBS Browser Source
├── config.js    — Edit this to customize the overlay
├── chat.js      — WebSocket connection + DOM rendering logic
├── style.css    — All visual styles
└── README.md    — This file
```

---

## Quick Start

1. Open `config.js` and set `channel` to the Twitch channel you want to display.
2. Open `index.html` in Chrome (or serve with a local HTTP server).
3. Add as a Browser Source in OBS (see below).

---

## OBS Setup

1. In OBS, click **+** under **Sources**.
2. Choose **Browser**.
3. Check **Local file** and browse to `index.html`.
4. Set **Width: 1920**, **Height: 1080**.
5. Check **Shutdown source when not visible**.
6. Check **Refresh browser when scene becomes active**.
7. Click **OK**.

To reposition the chat box:
- Right-click the source → **Transform** → **Edit Transform**
- Or drag the source edges in the OBS preview canvas.

To apply config changes in OBS:
- Right-click the Browser Source → **Interact** → right-click inside → **Reload Page**

---

## Configuration (`config.js`)

| Option | Default | Description |
|---|---|---|
| `channel` | `""` | Twitch channel name to connect to |
| `maxMessages` | `20` | Max chat messages visible at once |
| `fontSize` | `"16px"` | Font size of messages |
| `fontFamily` | `"'Segoe UI', sans-serif"` | Font family |
| `messageColor` | `"#ffffff"` | Text color |
| `usernameColor` | `"#a970ff"` | Default username color (Twitch purple) |
| `backgroundColor` | `"rgba(0,0,0,0.5)"` | Message bubble background |
| `badgeSize` | `"18px"` | Badge image size |
| `animationDuration` | `"0.3s"` | Slide-in / fade-out speed |
| `showBadges` | `true` | Show broadcaster/mod/sub badges |
| `showTimestamps` | `false` | Show HH:MM timestamp on each message |
| `highlightMentions` | `true` | Highlight messages mentioning @channel |
| `mentionColor` | `"#ffb31a"` | Highlight border color |
| `fadeMessageAfter` | `0` | Seconds before a message fades (0 = never) |
| `textShadow` | `true` | Subtle shadow for legibility |
| `maxWidth` | `"340px"` | Width of the chat container |
| `position` | `"bottom-left"` | Corner position: `bottom-left`, `bottom-right`, `top-left`, `top-right` |

---

## Local Testing

1. Open `index.html` directly in Chrome (`file://` protocol) **or** serve it with:
   ```
   npx serve .
   ```
   Then visit `http://localhost:3000`.

2. Open Chrome DevTools → **Console** tab.

3. A successful connection looks like:
   ```
   [Twitch Overlay] Connected
   [Twitch Overlay] Joining #xqc
   [Twitch Overlay] Receiving messages ✓
   ```

4. A failed connection shows:
   ```
   Connection failed. Retrying in 3s...
   ```
   The overlay will auto-retry every 3 seconds.

5. Messages should appear at the bottom-left of the page, sliding in from the left.

---

## Troubleshooting

### Chat not showing
- Double-check `channel` in `config.js` — it must be the exact lowercase channel name (e.g. `"xqc"`, not `"XQC"`).
- Open the browser console and look for parse errors or WebSocket errors.

### Blank screen in OBS
- Make sure you selected **Local file** and pointed OBS to the correct `index.html` path.
- Try clicking **Refresh** in the Browser Source properties.

### Emotes not loading
- When opened via `file://` in Chrome, CORS restrictions may block emote image loads.
- Solution: serve the files using a local HTTP server (`npx serve .`) and use `http://localhost:PORT` as the URL in OBS instead.

### Reconnection loops
- Usually caused by a network issue or Twitch rate-limiting anonymous connections.
- The overlay will retry every 3 seconds automatically.
- If it persists, try a different network or wait a few minutes.

### Username colors look dark / unreadable
- The overlay automatically brightens colors with luminance below 0.3 toward white (40% mix). This is handled by `getLegibleColor()` in `chat.js`.
