# Richard's Reader

**Richard's Reader is a local-first, dual-view accessibility reader. It can run
as a local web server or as a LAN service at `https://reader.local/`. Documents
stay in the browser on the device that opens them.**

On desktop and iPad, Reader shows the original PDF beside a reflowed reading
view. On a phone, the reading view fills the screen and the original opens in
a source-linked panel. Each extracted block links back to its page and source
coordinates. The server delivers
application files only; it has no document upload, storage, OCR, TTS,
analytics, or URL-proxy endpoint.

It supports local PDFs, source-linked navigation and search, reading controls,
verified device speech by default, and an optional browser-local neural voice.
Reader targets current iPadOS Safari
and Edge, plus desktop Safari and Chromium-based browsers. Phone layout tests
are automated; an actual iPhone Safari result is still pending. See
[TESTING.md](TESTING.md) for tested cases and browser limits.

## Quick start

Use Node.js 22.13 or newer in the 22.x series, or Node.js 24.x, with npm.
`npm start` is macOS-only because it registers `reader.local` with Bonjour.
From a terminal on the Mac, run the following for a first manual session. If
the LaunchAgent below is already running, use its restart command instead.

```sh
git clone https://github.com/rhematt/richards-reader.git
cd richards-reader
npm ci
npm run build
npm start
```

`npm start` runs the application server on `127.0.0.1:4173` and advertises
`reader.local` with Bonjour. Caddy serves the canonical LAN URL
`https://reader.local/`. Ctrl-C stops both the server and advertisement. Do
not use `sudo` for Reader. Run `npm test` separately when checking a build.

Open `https://reader.local/` on a device that trusts this installation's Caddy
local root CA. Configure Caddy and device trust as described below.
`npm run dev` starts Vite for source development. Use the production build for
normal LAN use; its server applies Reader's Content Security Policy.

To use Reader on the same computer without a LAN route or Bonjour, serve the
built app directly. In a macOS or Linux shell:

```sh
HOST=127.0.0.1 node server.mjs
```

In Windows PowerShell:

```powershell
$env:HOST = '127.0.0.1'
node server.mjs
```

Open `http://localhost:4173/` on that computer. This mode serves the same app
and does not advertise `reader.local`. Reader needs `dist/`, so run
`npm run build` first. Only one Reader process can use port 4173 at a time. If
the LaunchAgent below is already running, restart it with `launchctl kickstart`
instead of starting a second copy. For an isolated local test, set a different
port as well, for example `PORT=4184 HOST=127.0.0.1 node server.mjs`.

| Setup | Availability | URL |
| --- | --- | --- |
| `npm start` with Caddy | Until the terminal session ends | `https://reader.local/` |
| Caddy system service + Reader LaunchAgent | After user login, while the Mac is awake | `https://reader.local/` |

Choose **Open PDF**, drop a local PDF onto the source pane, or enter a public
URL. A direct URL can be opened with either `/?url=<encoded URL>` or
`/https://example.com/document.pdf`. In URL mode, the browser contacts the
named site directly; the site may block extraction through CORS. Local PDF
mode does not connect to remote sites.

## LAN access and `reader.local`

1. Keep the Mac and iPad on the same LAN. Allow incoming connections to Caddy
   in the Mac firewall if prompted, and ensure the router allows devices to
   reach each other. Run `npm start`; the printed LAN IP requires no DHCP
   reservation or configuration change.
2. Open `https://reader.local/` on the iPad after installing and trusting the
   local CA as described below. The
   launcher uses the interface with the default IPv4 LAN gateway. It ignores
   VPN tunnels and virtual adapters and stops with an error if no routed LAN
   IPv4 is available. It runs `/usr/bin/dns-sd -P` as the current user; no
   privileged port or Bonjour configuration is needed for Reader.
3. Run Caddy on HTTPS port 443 using the configuration below.

`PORT` can change the manual server port. The Caddy configuration and
LaunchAgent below use 4173, so leave that default in place
for persistent deployment.

`reader.local` is a Bonjour/mDNS hostname, not a public DNS name. A competing
host already using `reader.local` can prevent reliable resolution; resolve
that name conflict before using the canonical URL. On networks that block
mDNS or isolate Wi-Fi clients, repair LAN name resolution before using the
canonical HTTPS URL; an IP address will not match the `reader.local` certificate.
The server never needs an internet connection for local PDFs once npm
dependencies are installed and the application assets have loaded.

## Persistent macOS LAN deployment

A persistent macOS deployment uses a Caddy system service for HTTPS port 443 and a
Reader LaunchAgent for port 4173 and Bonjour:

```text
Name lookup: reader.local --Bonjour/mDNS--> Mac's current LAN IPv4
HTTPS:       LAN browser --> Caddy :443 --> 127.0.0.1:4173 --> Reader
```

Reader runs under the logged-in user's account. Caddy forwards application
requests to `127.0.0.1:4173`; it does not need the Mac's DHCP-assigned LAN
address. Reader's launcher advertises the current address. No static IP or
separate persistent `dns-sd` service is needed. The Mac must be awake, and
the user must be logged in for the LaunchAgent to run.

### 1. Run Caddy as a system service

Install Caddy with `brew install caddy` if needed, then put this in the
Caddyfile used by the system service. On Apple Silicon Homebrew installations,
it is typically `/opt/homebrew/etc/Caddyfile`; use `brew --prefix` to find the
Homebrew directory on another Mac. A copy is in
[`deploy/Caddyfile.example`](deploy/Caddyfile.example). Preserve any other
sites already configured in the installed Caddyfile.

```caddyfile
reader.local {
    tls internal
    reverse_proxy 127.0.0.1:4173
}
```

Start Caddy as a system service and check its status:

```sh
sudo brew services start caddy
sudo brew services list
```

Use `sudo brew services restart caddy` after changing its Caddyfile.

`brew services list` without `sudo` checks user-level jobs, not this system
service. Use one Caddy service. Do not launch Caddy from `npm start` or run
Reader with `sudo`. Caddy's internal CA issues the private `reader.local`
certificate; Caddy normally redirects HTTP requests to HTTPS.

### Trust the local CA on each device

Export the **root certificate only**, never its private key. When the local
Caddy admin API is enabled, it serves the active public CA chain at
`http://127.0.0.1:2019/pki/ca/local/certificates`. From the checkout, run:

```sh
npm run export-caddy-root
curl --noproxy '*' --cacert reader-local-root.crt -I https://reader.local/
```

The script extracts the self-signed root into the ignored
`reader-local-root.crt` and prints its SHA-256 fingerprint. The `curl` command
confirms it authenticates the live endpoint before transfer.
If the admin API is unavailable, inspect the service account and data
directory with `sudo brew services list`,
`sudo launchctl print system/homebrew.mxcl.caddy`, and `sudo caddy environ`,
then locate `pki/authorities/local/root.crt` under that service's actual data
directory. Do not assume the interactive user's Caddy data path is the system
service's path. `caddy trust` can install the active local root on the Mac.
Copy only the verified root certificate to additional devices by a private
transfer method.

On iPad/iPhone, transfer and open the certificate file, install the downloaded
profile in Settings, then go to **Settings → General → About → Certificate
Trust Settings** and enable **full trust** for that local root CA as described
by [Apple](https://support.apple.com/en-au/102390). Other Macs must explicitly trust the
same root in Keychain Access. Repeat for any other LAN client according to
that platform's trust-store procedure. Only devices that trust this private
CA should accept Reader's HTTPS certificate. Never install a CA private key
on a client device.

### 2. Run Reader as a LaunchAgent

Build Reader first with `npm ci && npm run build`. Save this local script as
`run-reader.sh` in the checkout. Replace `YOUR_USERNAME`, the checkout path,
and the npm path with values from your Mac (`command -v npm` shows that path).
On Intel Homebrew installations, npm is often at `/usr/local/bin/npm`:

```zsh
#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "/Users/YOUR_USERNAME/src/richards-reader" || exit 1
exec /opt/homebrew/bin/npm start
```

Make it executable with `chmod 700 run-reader.sh`. Create the agent and log
directories with `mkdir -p ~/Library/LaunchAgents ~/Library/Logs`, then save
the following as
`~/Library/LaunchAgents/com.richard.richards-reader.plist`. Replace
`YOUR_USERNAME` and the checkout path in every entry. LaunchAgent paths must
be absolute; `~` is not expanded inside the plist.

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

Load the agent once:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.richard.richards-reader.plist
launchctl print gui/$(id -u)/com.richard.richards-reader
```

For later restarts, including after a new DHCP lease or a rebuild, use:

```sh
launchctl kickstart -k gui/$(id -u)/com.richard.richards-reader
```

After pulling a new Reader version, update the dependencies and built app in
the checkout, then restart the agent:

```sh
git pull --ff-only
npm ci
npm run build
launchctl kickstart -k gui/$(id -u)/com.richard.richards-reader
```

To stop the LaunchAgent for the current login session, use
`launchctl bootout gui/$(id -u)/com.richard.richards-reader`. Remove its plist
if you no longer want Reader to start at login. Caddy is managed separately.

The process hierarchy is
`launchd → npm start → start-local.mjs → server.mjs + dns-sd`. The launcher
owns the Bonjour registration and removes it when Reader exits.
The script and plist contain account-specific paths.

### 3. Check the endpoint

From another trusted device on the same LAN, open `https://reader.local/`. On
the Mac, check the HTTPS response and the two listeners:

```sh
curl --cacert reader-local-root.crt -I https://reader.local/
lsof -nP -iTCP:4173 -sTCP:LISTEN
sudo lsof -nP -iTCP:443 -sTCP:LISTEN
launchctl print gui/$(id -u)/com.richard.richards-reader
tail -f ~/Library/Logs/richards-reader.log ~/Library/Logs/richards-reader-error.log
```

The HTTPS check should return a success status. The Reader log should show the
current LAN IPv4, the `reader.local` record, and the
`Richard's Reader._https._tcp` registration. If the Mac gets a new DHCP
address, restart Reader with `launchctl kickstart -k` as above; its launcher
will advertise the new address. Caddy still proxies to `127.0.0.1:4173`.

If the URL returns a proxy error, check the Reader listener and LaunchAgent
log first. If `reader.local` does not resolve, check that the network allows
mDNS between devices. A port-4173 address
conflict usually means a manual Reader session is running alongside the agent.

Neither Caddy nor Reader's server receives local documents. A file selected
on an iPad or other device is processed in that device's browser. PDF bytes,
extracted text, annotations, and reading content are not uploaded to the Mac.

## Use

- On a phone, read in the full-width accessible view. Tap **Original PDF** to
  inspect the source at the current reading position, then **Close** to return.
  A block's source link opens the same panel at its page and bounding box.
  Page and zoom controls are inside the original panel.
- On a phone, **Aa** opens the settings sheet. The bottom bar keeps sentence
  navigation, play/pause and speed available while reading. Choose a verified
  device voice or the optional local neural voice in the settings sheet. The accessible view and Original PDF
  each have a viewport ruler with their own position. Drag the round grip in
  either view without moving the other ruler or scrolling the page. Both use
  the same appearance settings. **Follow speech with ruler** can be changed in
  Reading focus settings.
- Click a reflowed block to highlight its source bounding box. Click a PDF page
  to select the nearest source block and reveal it in the reading view. Scroll
  sync uses block anchors and pauses when the other pane was just manipulated.
- Use page arrows, the nested **Outline** sheet, source zoom, pane divider, or maximise
  the original. Search returns blocks and focuses the matching source region.
- Reading settings control typography, colours, focus ruler, visual filters,
  and speech filters separately. Sentence and current-word highlight colours
  have separate controls. Presets can be edited; profiles save locally and can
  be exported or imported as JSON without document or annotation content.
- Device speech uses only voices whose browser `localService` property is exactly
  `true`; it remains the default. The **English neural voice · local model** is
  an explicit alternative. Its model, English pronunciation data and WASM
  runtime load from Reader's own origin only after it is chosen and Play is
  pressed. Synthesis runs in the opening device's browser; there is no cloud
  fallback. If no verified device voice is available, select the neural voice
  explicitly. If its assets fail, Reader reports a local error and keeps any
  verified device voice available. Neural speech has sentence highlighting;
  word timing is unavailable for this voice, so current-word highlighting is
  limited to device voices that emit word boundary events.
  A single sentence click starts speech there after a brief double-click
  window. Double-clicking a word opens its offline definition without changing
  speech or source position. Drag selection and touch selection also offer
  **Define**. Word highlighting follows speech boundary events where the
  browser supplies them.
- Bookmarks and simple notes are attached to page/bounding-box anchors and
  held only for the current document session. Closing the document destroys
  the PDF.js document, clears rendered pages and extracted blocks, and stops
  speech. The app saves preferences and a page number keyed by a hash of local
  file metadata, but no document bytes or extracted text.
- On desktop and tablet, **Review Mode** enables PDF-coordinate ink, highlight,
  underline, strikeout, anchored comments and text boxes. Select, edit,
  delete, undo/redo and annotation navigation are available there. On phone,
  annotations can be viewed and navigated without precision authoring tools.
  Marks remain in this browser session until **Export marked PDF** creates a
  separate `-marked.pdf`; the authoritative source PDF is never overwritten.

## Architecture and security

| Layer | What it contains | Where it runs |
| --- | --- | --- |
| Static server | Built HTML, CSS, JS, PDF.js worker, fonts, local models and WASM | Laptop; returns files only through Caddy HTTPS |
| Source model | PDF.js document, page dimensions, text blocks, categories, bounding boxes, image/table regions | Opening browser and its PDF.js worker |
| Accessible view | Reflowed prose, detected headings, source crops, visual filters | Opening browser DOM and memory |
| Reading stream | Sentence sequence and independent speech filters | Opening browser; verified device or optional local neural voice |
| Review layer | Session annotations in PDF page coordinates; new marked-PDF export | Opening browser only |

For a **local PDF**, File API bytes go from the device's file picker into a
`Uint8Array`, then into PDF.js in that device's browser. PDF.js parses and
renders pages there. Each PDF block records a page number and bounding box in
the PDF.js page viewport at scale 1. Cropped source regions are generated from
local canvases.
No client code sends PDF bytes or derived content to the laptop or elsewhere.
The production CSP allows same-origin connections for lazy-loaded layout and
neural model/WASM assets, plus narrowly scoped WebAssembly compilation. It blocks
arbitrary external images and loads scripts, workers, and fonts only from the
application origin in local document mode.
The server rejects methods other than GET/HEAD and does not read request bodies.

For a **requested URL**, the laptop receives the requested URL as part of the
app-page address, solely to return a CSP allowing that URL's origin. The laptop
does not fetch the URL. The browser fetches it directly with omitted
credentials and no referrer. Website source frames, where allowed, connect
directly to the requested site under normal browser frame policies. The
URL-mode CSP limits connections and frames to that origin plus application
assets. A redirect to another origin can fail. Reader does not proxy around
the site's security policy. The URL itself may be visible in the laptop's
HTTP request and browser history, so avoid sensitive tokens in URLs.

No service worker, remote fonts, CDN, remotely hosted third-party JS, telemetry, cloud OCR,
cloud TTS, or backend document route is included. `node_modules` is installed
at build time; runtime assets are served locally from `dist/`. See
[third-party notices](THIRD_PARTY_NOTICES.md) and the [MIT licence](LICENSE).

Caddy protects application traffic on the LAN with a private local CA;
documents still remain entirely on the device opening them. Each client must
explicitly trust that CA. `window.readerDiagnostics.secureContext` exposes the
browser's local secure-context state without sending telemetry.

## Extraction policy and limits

The original PDF remains authoritative. Reader uses PDF.js text geometry and
source-object ownership for page-linked blocks. On structurally complex pages,
a lazy-loaded browser-local PP-DocLayout-S detector proposes additional regions;
PDF geometry still determines which text objects belong to them. Trivial prose
pages use the deterministic path. Headings, notes, citations, references, code,
captions, and tables use source-aware classification. Repeated page furniture is suppressed
from reading by default but remains in the source model. Aligned text tables
become HTML tables only when columns are consistent; otherwise a source crop
is shown. Embedded PDF image operators are cropped from the rendered source.
Equations detected from text or a high-confidence layout region are shown as
source regions, including aligned matrices without extractable math symbols.
Complex vector
figures, untagged structure, unusual writing directions, rotated text, and
some multi-column layouts can still be misidentified; inspect the original before
relying on the projection. Reader does not invent missing structure.

Review Mode on desktop and tablet stores pen, markup, comment, and free-text
annotations in a separate PDF-coordinate layer. Export writes a new
`-marked.pdf` with standard PDF annotations and preserves selectable source
text. Session marks are not uploaded or written into the original file. Phones
can view and navigate annotations without precision authoring controls.

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

`npm test` runs `IPAD-PDF-001` and the mobile viewport checks with synthetic
PDFs. The mobile browser test uses Microsoft Edge on macOS; on another system,
set `READER_TEST_BROWSER` to a Chromium or Edge executable. If no browser is
available, that test is skipped. To check the built application rather than
the development server, run `npm run build` followed by
`READER_TEST_PRODUCTION=1 node --test test/mobile-ui.test.mjs`.

To create more local test files, install Python with
`reportlab` and `Pillow`, then run:

```sh
python3 scripts/generate-fixtures.py /tmp/reader-fixtures
```

The generator creates ordinary prose, a two-column academic paper with
citations, a footnote and references, papers with images and tables, and an
image-only scan. See [TESTING.md](TESTING.md) for the manual checklist and
results.

## Help

Report setup problems and bugs in
[GitHub Issues](https://github.com/rhematt/richards-reader/issues). Include the
operating system, Node.js and browser versions, plus the error message. Use
synthetic or public PDFs when sharing a reproduction.
