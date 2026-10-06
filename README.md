# Richard's Reader

**Richard's Reader is a local-first, dual-view accessibility reader. It can run
as a local web server or as a LAN service at `http://reader.local/`. Documents
stay in the browser on the device that opens them.**

Reader shows the original PDF beside a reflowed reading view. Each extracted
block links back to its page and source coordinates. The server delivers
application files only; it has no document upload, storage, OCR, TTS,
analytics, or URL-proxy endpoint.

## Run locally

Requires Node.js 22.13 or newer (or Node.js 24+) and npm. From a checkout:

```sh
npm ci
npm test
npm run build
npm start
```

`npm start` starts a manual Reader session on macOS. It finds the IPv4 address
on the LAN gateway route, starts the static server on `0.0.0.0:4173`, checks
it locally, and advertises `reader.local` through Bonjour. It prints the
current localhost and LAN URLs. Ctrl-C removes the Bonjour registration and
stops the server. `PORT` changes the server and advertised port together. Run
Reader as your normal user, without `sudo`.

Open `http://localhost:4173/` on the Mac or `http://reader.local:4173/` on
another LAN device. A separate Caddy service provides the port-free URL.
`npm run dev` starts Vite for source development. Use the production build for
LAN use; its server applies Reader's Content Security Policy.

| Setup | Availability | URL |
| --- | --- | --- |
| `npm start` in a terminal | Until the terminal session ends | `http://reader.local:4173/` |
| Reader LaunchAgent | Automatically after user login, while the Mac is awake | `http://reader.local:4173/` |
| Caddy system service + Reader LaunchAgent | Port-free access after user login, while the Mac is awake | `http://reader.local/` |

Choose **Open PDF**, drop a local PDF onto the source pane, or enter a public
URL. The canonical entry point is `/`. A direct URL can be opened with either
`/?url=<encoded URL>` or `/https://example.com/document.pdf`. Both routes
call the same browser `open(target)` function. URL mode makes a direct browser
request to the named origin; sites may block it through CORS. Local-file mode
has no permission to connect to remote origins.

## LAN access and `reader.local`

1. Keep the Mac and iPad on the same LAN. Allow incoming connections to Node.js
   in the Mac firewall if prompted, and ensure the router allows devices to
   reach each other. Run `npm start`; the printed LAN IP requires no DHCP
   reservation or configuration change.
2. Open the printed LAN URL or `http://reader.local:4173/` on the iPad. The
   launcher uses the interface with the default IPv4 LAN gateway. It ignores
   VPN tunnels and virtual adapters and stops with an error if no routed LAN
   IPv4 is available. It runs `/usr/bin/dns-sd -P` as the current user; no
   privileged port or Bonjour configuration is needed for port 4173.
3. For `http://reader.local/` without a port number, configure a separate
   port-80 Caddy service as shown below.

`reader.local` is a Bonjour/mDNS hostname, not a public DNS name. A competing
host already using `reader.local` can prevent reliable resolution; resolve
that name conflict before using the canonical URL. On networks that block
mDNS or isolate Wi-Fi clients, use the printed laptop IP address and port.
The server never needs an internet connection for local PDFs once npm
dependencies are installed and the application assets have loaded.

## Persistent macOS LAN deployment

Goliath uses a Caddy system service for port 80 and a Reader LaunchAgent for
port 4173 and Bonjour. This is the supported persistent macOS setup:

```text
LAN device → http://reader.local → Bonjour/mDNS → Caddy :80
                                                → 127.0.0.1:4173 → Reader
```

Reader runs under the logged-in user's account. Caddy forwards application
requests to `127.0.0.1:4173`; it does not need the Mac's DHCP-assigned LAN
address. Reader's launcher advertises the current address. No static IP or
separate persistent `dns-sd` service is needed. The Mac must be awake, and
the user must be logged in for the LaunchAgent to run.

### 1. Run Caddy as a system service

Install Caddy with Homebrew if needed, then put this in the Caddyfile used by
the system service (on an Apple Silicon Homebrew installation, usually
`/opt/homebrew/etc/Caddyfile`):

```caddyfile
http://reader.local {
    reverse_proxy 127.0.0.1:4173
}
```

Start Caddy once and use Homebrew to check or restart its system service:

```sh
sudo brew services start caddy
sudo brew services list
sudo brew services restart caddy
```

`brew services list` without `sudo` checks user-level jobs, not this system
service. Use one Caddy service for port 80. Do not launch Caddy from
`npm start` or run Reader with `sudo`. The port-80 endpoint uses plain HTTP,
so use it on a trusted LAN.

### 2. Run Reader as a LaunchAgent

Build Reader first with `npm ci && npm run build`. Save this local script as
`run-reader.sh` in the checkout, replacing `YOUR_USERNAME` and the npm path if
your installation differs:

```zsh
#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "/Users/YOUR_USERNAME/src/richards-reader" || exit 1
exec /opt/homebrew/bin/npm start
```

Make it executable with `chmod 700 run-reader.sh`. Save the following as
`~/Library/LaunchAgents/com.richard.richards-reader.plist`, replacing every
`YOUR_USERNAME` with your macOS account name. LaunchAgent paths must be absolute;
`~` is not expanded inside the plist.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.richard.richards-reader</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOUR_USERNAME/src/richards-reader/run-reader.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/src/richards-reader</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/Library/Logs/richards-reader.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/Library/Logs/richards-reader-error.log</string>
</dict>
</plist>
```

Load the agent once, then use `kickstart` for later restarts:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.richard.richards-reader.plist
launchctl print gui/$(id -u)/com.richard.richards-reader
launchctl kickstart -k gui/$(id -u)/com.richard.richards-reader
```

The process hierarchy is `launchd → npm start → Reader server + dns-sd`.
`npm start` owns the Bonjour registration and removes it when Reader exits.
Keep the script and plist local; they contain account-specific paths.

### 3. Check the endpoint

From another device on the same LAN, open `http://reader.local/`. On the Mac,
check the HTTP response and the two listeners:

```sh
curl -I http://reader.local/
lsof -nP -iTCP:4173 -sTCP:LISTEN
sudo lsof -nP -iTCP:80 -sTCP:LISTEN
launchctl print gui/$(id -u)/com.richard.richards-reader
tail -f ~/Library/Logs/richards-reader.log ~/Library/Logs/richards-reader-error.log
```

The HTTP check should return a success status. The Reader log should show the
current LAN IPv4, the `reader.local` record, and the
`Richard's Reader._http._tcp` registration. If the Mac gets a new DHCP
address, restart Reader with `launchctl kickstart -k` as above; its launcher
will advertise the new address. Caddy still proxies to `127.0.0.1:4173`.

Neither Caddy nor Reader's server receives local documents. A file selected
on an iPad or other device is processed in that device's browser. PDF bytes,
extracted text, annotations, and reading content are not uploaded to the Mac.

## Use

- Click a reflowed block to highlight its source bounding box. Click a PDF page
  to select the nearest source block and reveal it in the reading view. Scroll
  sync uses block anchors and pauses when the other pane was just manipulated.
- Use page arrows, heading navigation, source zoom, pane divider, or maximise
  the original. Search returns blocks and focuses the matching source region.
- Reading settings control typography, colours, focus ruler, visual filters,
  and speech filters separately. Presets can be edited; profiles save locally.
- Speech uses only voices whose browser `localService` property is exactly
  `true`. If the browser cannot verify a device voice, Reader disables speech.
  Sentence clicks start speech there; word highlighting follows boundary
  events where the browser supplies them.
- Bookmarks and simple notes are attached to page/bounding-box anchors and
  held only for the current document session. Closing the document destroys
  the PDF.js document, clears rendered pages and extracted blocks, and stops
  speech. The app saves preferences and a page number keyed by a hash of local
  file metadata, but no document bytes or extracted text.

## Architecture and security

| Layer | What it contains | Where it runs |
| --- | --- | --- |
| Static server | Built HTML, CSS, JS, PDF.js worker, fonts | Laptop; returns files only |
| Source model | PDF.js document, page dimensions, text blocks, categories, bounding boxes, image/table regions | Opening browser and its PDF.js worker |
| Accessible view | Reflowed prose, detected headings, source crops, visual filters | Opening browser DOM and memory |
| Reading stream | Sentence sequence and independent speech filters | Opening browser; verified local/device speech voice |

For a **local PDF**, File API bytes go from the device's file picker into a
`Uint8Array`, then into PDF.js in that device's browser. PDF.js parses and
renders pages there. Each PDF block records a page number and bounding box in
the PDF.js page viewport at scale 1. Cropped source regions are generated from
local canvases.
No client code sends PDF bytes or derived content to the laptop or elsewhere.
The production CSP on `/` uses `connect-src 'none'`, blocks frames and arbitrary
images, and loads scripts, workers, and fonts only from the application origin.
The server rejects methods other than GET/HEAD and does not read request bodies.

For a **requested URL**, the laptop receives the requested URL as part of the
app-page address, solely to return a CSP allowing that URL's origin. The laptop
does not fetch the URL. The browser fetches it directly with omitted
credentials and no referrer. Website source frames, where allowed, connect
directly to the requested site under normal browser frame policies. The
URL-mode CSP limits connections and frames
to that origin plus application assets. A redirect to another origin can fail;
Reader will not proxy around the site's security policy. The URL itself may be
visible in the laptop's HTTP request and browser history, so avoid sensitive
tokens in URLs.

No service worker, remote fonts, CDN, third-party JS, telemetry, cloud OCR,
cloud TTS, or backend document route is included. `node_modules` is installed
at build time; runtime assets are served locally from `dist/`. See
[third-party notices](THIRD_PARTY_NOTICES.md) and the [MIT licence](LICENSE).

## Extraction policy and limits

The original PDF remains authoritative. Reader uses PDF.js text geometry for
page-linked blocks and heuristic classification for headings, notes, citations,
references, code, captions, and tables. Repeated page furniture is suppressed
from reading by default but remains in the source model. Aligned text tables
become HTML tables only when columns are consistent; otherwise a source crop
is shown. Embedded PDF image operators are cropped from the rendered source.
Equations detected from text are shown as source regions. Complex vector
figures, untagged structure, unusual writing directions, rotated text, and
some multi-column layouts can be misidentified; inspect the original before
relying on the projection. Reader does not invent missing structure.

Image-only PDFs display **“No usable text layer detected. Local OCR support is
not yet enabled.”** Their original pages still render. Browser-local OCR can
be added later. Large PDFs are parsed page by page but still retain the model
in browser memory; close them to release it.

Websites are a limited V1 path. CORS must allow browser extraction; the source
site must allow framing for an embedded original. If framing is blocked, use
the direct original-site link. Exact cross-origin DOM bounding boxes and PDF
style bidirectional sync are unavailable for websites. A future browser
extension, bookmarklet, or share action could pass the current page's DOM
inside the client browser without adding a server proxy.

## Test with synthetic material

`npm test` runs `IPAD-PDF-001` with synthetic PDFs while stream async iteration
is unavailable. To create more local test files, install Python with
`reportlab` and `Pillow`, then run:

```sh
python3 scripts/generate-fixtures.py /tmp/reader-fixtures
```

The generator creates ordinary prose, a two-column academic paper with
citations, a footnote and references, papers with images and tables, and an
image-only scan. Generated PDFs are ignored by Git. See [TESTING.md](TESTING.md)
for the manual checklist and results.

## Repository hygiene

Keep documents, generated files, logs, local service scripts and configuration,
and credentials out of Git. No GitHub account is needed to run Reader locally.
