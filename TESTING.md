# Reader V1 test checklist

## Mobile UI acceptance — `mobile-ui` branch

The phone presentation uses the existing PDF model, source anchors, reading
stream, settings and privacy boundary. Test at 390×844 and 430×932 portrait,
and at 844×390 and 932×430 landscape. Also check 768×1024 iPad portrait and
desktop widths to protect the existing dual-pane layout. Automated viewport
checks cover layout and interactions; an actual iPhone Safari run is required
before calling the mobile interface fully verified.

| Requirement | Acceptance check | Automated coverage | Real-device check |
| --- | --- | --- | --- |
| MOBILE-001 No compressed desktop layout | Phone viewports show one full-width reading pane, touch-sized controls and no application-level horizontal scroll or hover-only action. | `test/mobile-ui.test.mjs`: phone geometry and visible controls. | iPhone portrait and landscape. |
| MOBILE-002 Primary reading view | Accessible content opens as the default surface; typography, colours, filters, ruler, anchors, search, TTS and sentence navigation remain reachable. | `test/mobile-ui.test.mjs`: default surface and controls. | Open a text PDF and use each control. |
| MOBILE-003 Original PDF drawer | Original opens from an obvious control at the current reading anchor, shows its source box, supports page/zoom inspection, and closes to the same reading position. | `test/mobile-ui.test.mjs`: drawer state, anchor and preserved scroll position. | Inspect a selected paragraph on iPhone. |
| MOBILE-004 Touch ruler | Ruler is a viewport overlay; document scrolling leaves it fixed. Only its grip drags it. Grip dragging does not scroll the document; settings still change size and opacity. | `test/mobile-ui.test.mjs`: grip drag and document scroll. | Finger drag grip, then scroll prose. |
| MOBILE-005 TTS integration | Compact bar keeps play/pause, previous/next sentence and speed available; verified local voice selection and highlighting remain. Speech can follow the ruler. | Existing speech logic plus `test/mobile-ui.test.mjs` control checks. | Speak and navigate sentences on iPhone. |
| MOBILE-006 Source-linked structures | Tapping a table, figure or equation source link opens the original at its bounding box and returns to the previous reading position. | `test/mobile-ui.test.mjs`: source-link action. | Use a figure/table PDF on iPhone. |
| MOBILE-007 Settings | Settings open in a touch-sized sheet without occupying reading width; saved profiles still apply. | `test/mobile-ui.test.mjs`: settings sheet visibility. | Change a profile on iPhone. |
| MOBILE-008 Landscape | Phone landscape keeps the mobile interaction model and has no horizontal application scroll. | `test/mobile-ui.test.mjs`: both landscape sizes. | Rotate an iPhone while reading. |
| MOBILE-009 Regression protection | Desktop and iPad remain dual-pane. PDF coordinates, columns, figures, tables, filters, local TTS, privacy, Bonjour/Caddy and existing tests remain intact. | Existing PDF, model and launcher suites plus `test/mobile-ui.test.mjs` tablet/desktop geometry. | Repeat iPad Safari/Edge and desktop spot checks. |
| MOBILE-010 Mobile options access | A labelled menu button stays visible at the top in phone portrait and landscape. Its Reading settings action opens the full settings sheet, including typography, colours, focus, filters, profiles and local voice. The menu and sheet can be closed without losing reading position. | `test/mobile-ui.test.mjs`: top menu visibility, touch target and settings access. | Open the menu and change a reading setting on the actual phone. |

**Automated result, 6 Oct 2026:** Passed in headless Edge at 390×844 and
430×932 portrait, 844×390 and 932×430 landscape, 768×1024 tablet, and
1280×800 desktop. The test opens synthetic text and figure/table PDFs; checks
the full-width reading pane, 44-pixel primary touch controls, source box and
original canvas, drawer zoom and return position, original-to-reading selection,
search/source linkage, a figure crop,
complex-content source link, settings sheet and saved profile, ruler position
during document scrolling, mouse and emulated touch grip dragging, and the
desktop/tablet dual-pane layout. It passed against both Vite's development
server and the built static app with Reader's production CSP. `npm test`
passed 9/9 and `npm run build` succeeded. The existing multi-column and
iPadOS PDF extraction regressions remain in the passing suite.

**Real-device status:** iPhone Safari portrait/landscape, ruler grip,
source drawer and device TTS are pending. The post-change iPad Safari/Edge
regression check is also pending. Emulation and prior iPad results do not
establish these new real-device passes. Record device/browser versions and
results here after testing.

**Reported defect after the first mobile build:** On the actual mobile view,
the options buttons were not discoverable and the user could not reach reading
customisation. MOBILE-010 was added before the menu fix. A visible top-bar
menu and actual phone verification are required; the earlier automated
bottom-bar visibility assertion did not catch this usability failure.

**MOBILE-010 correction, 6 Oct 2026:** A labelled, 44-pixel top-bar Options
button now opens Reading settings without moving the reading position. The
expanded menu and settings sheet passed the development and production-CSP
browser suites (9/9 each). Actual iPhone verification remains pending.

## LAN-MDNS-001 — Dynamic `reader.local` registration

Run `npm run build && npm start` on a macOS laptop with a default IPv4 LAN
route. The launcher must select that route's interface and current IPv4 address,
bind Reader on `0.0.0.0:4173`, pass a local HTTP health check, register both the
`reader.local` address record and `Richard's Reader._http._tcp` service, and
print working localhost, LAN-IP and `reader.local:4173` URLs. A separately
managed Caddy service may forward port 80 to 4173 for `http://reader.local/`.
No static IP, privileged Reader process, document endpoint or Caddy subprocess
is permitted. SIGINT and SIGTERM must remove the Bonjour child and stop Reader.

Automated `test/start-local.test.mjs` checks IP A (`192.168.0.3`) and a changed
DHCP IP B (`192.168.0.17`) on the same route, a changed route/interface,
exclusion of VM/VPN interfaces, failure without a routed LAN IPv4, termination
order, and rejection of a renamed Bonjour service. These are simulated network
states; they do not change the Mac's real DHCP lease.

**Live Mac result, 6 Oct 2026:** Passed at the Mac's current DHCP address
on `en0`. The launcher received both `dns-sd` registration
replies; HEAD requests to `http://reader.local:4173/` and, through the
separately running Caddy service, `http://reader.local/` returned HTTP 200 with
the local-mode CSP. On separate SIGTERM and SIGINT runs, the launcher,
`dns-sd` child and port-4173 listener were absent afterward. A deliberate
duplicate manual advertisement caused Bonjour to rename the service to
`Richard's Reader (2)`; the launcher reported that conflict and cleaned up.
The actual DHCP lease was not changed during this test. After a future lease
change, stop and restart Reader and confirm the printed LAN IP and
`reader.local` resolution use the new address.

## IPAD-PDF-001 — Local PDF opens and extracts on iPadOS

Given Reader loaded over the LAN on an actual iPad, select a normal text-based
PDF using the browser file picker. In **both iPad Safari and iPad Edge**, verify
that the original pane renders, extraction completes, the accessible pane has
readable blocks, tapping a block highlights its original page and bounding box,
and TTS reads from that block without a JavaScript exception. Inspect the Reader
server requests: the PDF bytes must never be uploaded. Repeat with ordinary,
two-column academic, figure-containing and table-containing PDFs. Also repeat
the PDF checks in desktop Safari and desktop Chromium/Edge.

The automated `npm test` regression removes `ReadableStream` async iteration
while retaining `getReader()` and exercises the production PDF model with
synthetic ordinary, two-column, and figure/table PDFs. It checks extracted
text, source page identity and bounding boxes, the existing left-before-right
column order, figure and caption blocks, a real aligned table and caption,
and zero network fetches. This simulated compatibility test does not
substitute for the real-device run.

On 6 Oct 2026, this test failed **before the implementation change** with
`TypeError: readableStream is not async iterable` at PDF.js 6.4.299
`PDFPageProxy.getTextContent()` called from `openPdf()`. The installed PDF.js
implementation uses `for await` on `streamTextContent()` there. After Reader
changed to explicit `getReader()` chunk consumption, the same regression
passed. No PDF.js version or dependency was changed.

Desktop browser checks on 6 Oct 2026 using the production LAN build and only
synthetic PDFs:

| Browser | Ordinary PDF | Two-column paper | Figure and table PDF | Source tracking and local TTS |
| --- | --- | --- | --- | --- |
| macOS Safari | Original and reflow rendered | Introduction before Results; references present | Figure crop and real table present | Tapping text highlighted the source box and started a verified device voice |
| macOS Edge (Chromium) | Original and reflow rendered | Introduction before Results; references present | Figure crop and real table present | Tapping text highlighted the source box and started a verified device voice |

The iPad checks require the **same build** in both Safari and Edge. Refresh
Reader on the iPad after `npm run build`, open a synthetic or other non-private
text PDF through its file picker, tap an accessible block, tap a source region,
and start/pause TTS. Repeat with the two-column and figure/table PDFs. Check
that the `LOCAL DOCUMENT MODE` badge remains visible. To verify the network
boundary, inspect the browser or laptop network requests if available: the
laptop should receive application GET/HEAD requests only, with no PDF request
body or document-derived content. The static server has no upload route and
rejects other methods with 405.

**Real-device result: Passed, user-confirmed on 6 Oct 2026.** On the actual
iPad, both Safari and Edge completed original rendering, text extraction,
accessible reflow, source highlighting and device TTS without the reported
runtime error. The user opened ordinary, two-column, figure-containing and
table-containing PDFs in both browsers. iPadOS and browser version numbers
were not supplied. A device network trace was not captured; the no-upload
property is covered by the automated zero-fetch check, local-mode CSP, and
the server's GET/HEAD-only design. The user also confirmed the touch ruler
moves and speech skips citations, footnotes and references when configured.

Use `npm ci`, `npm run build`, and `npm start`. Test with synthetic files from
`scripts/generate-fixtures.py` or public documents only. Never add private
documents to the repository.

| Check | Expected result | Local result on 6 Oct 2026 |
| --- | --- | --- |
| Ordinary text-heavy PDF | Exact original page, readable reflow, clickable source region | Passed with `ordinary.pdf` in the in-app desktop browser |
| Two-column academic paper | Left column reads before right; headings and anchors stay distinct | Passed after line-splitting correction with `academic.pdf` |
| PDF containing an image | Figure crop appears beside its caption | Passed with `image-table.pdf` |
| PDF containing a table | Aligned cells become a real table; uncertain layouts use source crop | Passed with `image-table.pdf` and `irregular-table.pdf` |
| Numbered inline citations | Remain visible by default; speech can skip them | Visual classification passed with `[17, 21, 34]`; citation skipping confirmed on iPad |
| Author/date citations | Visual and speech filters work separately | `Example and Sample (2021)` classified; visual text retained and speech text omitted it; citation skipping confirmed on iPad |
| Footnotes | Source-anchored; show/collapse/hide and independent speech control | Detected and visual collapse checked in `academic.pdf`; speech skipping confirmed on iPad |
| Reference section | Detect, collapse/hide visually, skip in speech by default | Detected and visual hide checked in `academic.pdf`; speech skipping confirmed on iPad |
| Search/source sync | Match highlights accessible block and original bounding box | Passed in desktop browser |
| Speech playback | Verified local voice, play/pause, sentence/word highlight | Passed with macOS local voice in desktop browser and user-confirmed device TTS on iPad Safari and Edge; word-boundary highlight depends on browser events |
| Image-only scan | Original renders; persistent no-text-layer notice | Passed with `scan.pdf` |
| Direct public PDF URL | Browser fetch, no laptop proxy | Passed with Mozilla's public PDF.js sample PDF |
| Browser security failure | Clear CORS/framing explanation | CORS failure passed with `example.com`; a CORS-permitted W3C page extracted, while its framing policy blocks the embedded original |
| Local privacy boundary | No app network connections in local mode; no POST endpoint | Production CSP verified as `connect-src 'none'`; synthetic POST returned 405 and nonexistent document GET route returned 404 |
| LAN address | App responds on laptop LAN IP and port | Passed from the laptop and actual iPad over the LAN |
| iPad-size layout | Both panes, settings, and controls remain usable | Both reading panes and source tracking passed on an actual iPad; touch ruler movement user-confirmed |
| iPad Safari and Edge over LAN | Open local PDFs, render/reflow, source sync and local TTS | **Passed on the actual iPad in both browsers** for ordinary, two-column, figure and table PDFs; user-confirmed |
| Desktop Safari and Chromium/Edge | Same PDF checks in each target browser engine | macOS Safari and Edge (Chromium) passed ordinary, two-column, and figure/table PDF checks after the compatibility change; Google Chrome was not separately tested |
| Dependency security | No reported high-severity advisories | `npm audit --audit-level=high` on 6 Oct 2026 found 0 vulnerabilities; PDF.js remains 6.4.299 |
| Document close | PDF worker, rendered pages, and extracted blocks are released | Passed in desktop browser; a second PDF opened successfully afterward |

Before a public push, inspect the staged file list and full Git history, scan
for secrets and private paths, and confirm `gh auth status` succeeds. Do not
publish an incomplete or insecure intermediate state. Those checks were
performed on 6 Oct 2026 before the first push; no private document files or
credential patterns were found in the Git history. The GitHub CLI was verified
as authenticated with network access.
