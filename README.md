# Reader

Reader is a browser-based, PDF-first accessibility reader. It keeps the exact
PDF page beside a reflowed reading view and links extracted blocks to page
coordinates in the source. It is intended to be served from a laptop on a
local network and opened on that laptop or an iPad.

**Privacy rule:** the server only returns application files. Local PDF bytes,
extracted text, page images, annotations, and speech text stay in the browser
on the device that opened the document. The server has no document upload,
storage, OCR, TTS, analytics, or URL-proxy endpoint.

## Run locally

Requires Node.js 22.13 or newer (or Node.js 24+) and npm. From a checkout:

```sh
npm ci
npm test
npm run build
npm start
```

On macOS, `npm start` discovers the IPv4 address on the gateway-routed LAN
interface, starts the static server on `0.0.0.0:4173`, checks it locally, and
advertises that address as `reader.local` with Bonjour. It prints the current
localhost and LAN URLs. Stop it with Ctrl-C; the launcher removes its Bonjour
registration before stopping the server. `PORT` can change the server and
advertised port together. Do not run `npm start` with `sudo`.

Open `http://localhost:4173/` on the Mac or `http://reader.local:4173/` on
another LAN device. The port-free `http://reader.local/` also works when a
separate, persistent port-80 proxy is configured as described below.
`npm run dev` starts Vite for source development; use the production build and
`npm start` for privacy testing and routine LAN use because the production
server applies the mode-specific Content Security Policy.

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
3. To use the canonical port-free `http://reader.local/`, configure Caddy as a
   **separate persistent system service** listening on port 80. Its local
   configuration can be:

   ```caddyfile
   http://reader.local {
       reverse_proxy 127.0.0.1:4173
   }
   ```

   Start and manage Caddy through your normal macOS service setup, with only
   the permission that service needs to bind port 80. Do not start Caddy from
   `npm start`; the Reader launcher remains an ordinary unprivileged process.
   Caddy does not process documents: it forwards requests for static app files
   to Reader. Keep the Caddy service restricted to the trusted LAN.

`reader.local` is a Bonjour/mDNS hostname, not a public DNS name. A competing
host already using `reader.local` can prevent reliable resolution; resolve
that name conflict before using the canonical URL. On networks that block
mDNS or isolate Wi-Fi clients, use the printed laptop IP address and port.
The server never needs an internet connection for local PDFs once npm
dependencies are installed and the application assets have loaded.

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

The repository contains a **source generator** and an automated compatibility
regression, not committed document fixtures. Run `npm test` to exercise
`IPAD-PDF-001` with synthetic PDFs while stream async iteration is unavailable.
With Python plus `reportlab` and `Pillow` installed:

```sh
python3 scripts/generate-fixtures.py /tmp/reader-fixtures
```

Generated PDFs are ignored by Git. The generator creates ordinary prose, a
two-column academic paper with numbered and author/date citations, a footnote
and references, an image/table paper, an irregular table, and an image-only
scan. These files are
synthetic and safe for local demos. The manual checklist and current results
are in [TESTING.md](TESTING.md).

## GitHub publication

The intended public repository name is `richards-reader`. Publish only after
the full checklist, including actual iPad Safari and Edge LAN checks, passes and a
history/security review finds no private documents or secrets. The generated
PDFs, `dist/`, caches, logs, machine configuration, and credentials are
ignored. No GitHub credential is needed to run Reader locally.
