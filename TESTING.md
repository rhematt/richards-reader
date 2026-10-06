# Reader V1 test checklist

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
