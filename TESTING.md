# Reader V1 test checklist

Use `npm ci`, `npm run build`, and `npm start`. Test with synthetic files from
`scripts/generate-fixtures.py` or public documents only. Never add private
documents to the repository.

| Check | Expected result | Local result on 6 Oct 2026 |
| --- | --- | --- |
| Ordinary text-heavy PDF | Exact original page, readable reflow, clickable source region | Passed with `ordinary.pdf` in the in-app desktop browser |
| Two-column academic paper | Left column reads before right; headings and anchors stay distinct | Passed after line-splitting correction with `academic.pdf` |
| PDF containing an image | Figure crop appears beside its caption | Passed with `image-table.pdf` |
| PDF containing a table | Aligned cells become a real table; uncertain layouts use source crop | Passed with `image-table.pdf` and `irregular-table.pdf` |
| Numbered inline citations | Remain visible by default; speech can skip them | Visual classification passed with `[17, 21, 34]`; speech stream filter should be listened to on target devices |
| Author/date citations | Visual and speech filters work separately | `Example and Sample (2021)` classified; visual text retained and speech text omitted it; target-device listening still needed |
| Footnotes | Source-anchored; show/collapse/hide and independent speech control | Detected and visual collapse checked in `academic.pdf`; speech control should be checked on iPad |
| Reference section | Detect, collapse/hide visually, skip in speech by default | Detected and visual hide checked in `academic.pdf`; speech control should be checked on iPad |
| Search/source sync | Match highlights accessible block and original bounding box | Passed in desktop browser |
| Speech playback | Verified local voice, play/pause, sentence/word highlight | Passed with macOS local voice in desktop browser |
| Image-only scan | Original renders; persistent no-text-layer notice | Passed with `scan.pdf` |
| Direct public PDF URL | Browser fetch, no laptop proxy | Passed with Mozilla's public PDF.js sample PDF |
| Browser security failure | Clear CORS/framing explanation | CORS failure passed with `example.com`; a CORS-permitted W3C page extracted, while its framing policy blocks the embedded original |
| Local privacy boundary | No app network connections in local mode; no POST endpoint | Production CSP verified as `connect-src 'none'`; synthetic POST returned 405 and nonexistent document GET route returned 404 |
| LAN address | App responds on laptop LAN IP and port | Passed from the laptop using its LAN IP; a second device was not available |
| iPad-size layout | Both panes, settings, and controls remain usable | Checked in desktop browser at 1024×768 and 820×1180; this is not an iPad Safari test |
| iPad Safari over LAN | Open file from iPad, sync both panes, local voice and touch ruler | **Pending actual iPad access** |
| Desktop Safari/Chrome/Edge | Same PDF checks in each target browser | **Pending target-browser checks**; in-app desktop browser tested |
| Dependency security | No reported high-severity advisories | `npm audit --audit-level=high` passed after upgrading PDF.js to 6.4.299 |
| Document close | PDF worker, rendered pages, and extracted blocks are released | Passed in desktop browser; a second PDF opened successfully afterward |

Before a public push, complete the pending rows, inspect the staged file list
and full Git history, scan for secrets and private paths, and confirm `gh auth
status` succeeds. Do not publish an incomplete or insecure intermediate state.
