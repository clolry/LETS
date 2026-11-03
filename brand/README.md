# Brand artwork

**Not pushed to Apps Script.** This folder sits outside `lets_app/`, so
`clasp push` never sees it. Keep source artwork here, never in `lets_app/`.

## Files

| File | What it is |
|---|---|
| `ASD Bracketed Logo on Blue.png` | **The master.** 1562x1007, white ink on an opaque blue field. Highest resolution available |
| `ASD_logo_200x129.png` | 200x129, blue ink on opaque white. **Too low-res for the splash** — this is what caused the graininess on 2026-10-30 |
| `ASD_mark_1002x636_blue_transparent.png` | **Derived, and the one to reuse.** The master with the blue field keyed out and the ink recoloured to `#064C9A`. Transparent background |

## Where the logo is embedded in the application

All four are base64 data URIs. **There is no shared logo file** — each
location carries its own copy at its own resolution.

| Location | File | Size | Rendered at |
|---|---|---|---|
| Splash animation | `lets_app/client/components/welcomeSvg.html`, the `<image id="ASD">` | 426x270 | ~213x135 CSS px |
| Page header (5 pages) | `lets_app/client/components/aasLogo.html`, `base64` and `base64White` | 400x254 | 22-36 px tall |
| Email header | `lets_app/server/30_services/Email.js`, `TRAVEL_LOGO_BASE64` | 480x160 | 240 px wide |

**The email copy is pinned by CI.** The `branding must stay configurable`
guard in `.github/workflows/verify.yml` holds the SHA-256 of the *inherited
AAS* payload and fails if it reappears, and `test_branding.js` §12 asserts the
live payload decodes to an RGBA PNG at least 480 px wide. Both exist because a
base64 blob is unreviewable in a diff — two of them look identical to a human,
so a logo regression is otherwise invisible. **If you legitimately replace the
email logo, neither needs updating** unless the new asset is narrower than
480 px, in which case fix the asset rather than the test.

## Regenerating

Work from `ASD_mark_1002x636_blue_transparent.png` — it is already keyed and
recoloured. Downscale with an **area-average** filter (not nearest-neighbour)
and keep alpha premultiplied, or the antialiased edges will fringe.

**Sizing rule:** a raster asset needs ~2x its CSS size to stay sharp on a
retina display. The splash renders at 213 CSS px wide, so 426 px is the floor;
the email logo renders at 240 px, so 480 px is its floor.

**Keep the alpha channel.** All three embedded copies are colour-type 6
(RGBA). `ASD_logo_200x129.png` is opaque RGB on white and will show a white
box anywhere the background is not white — which is most of them.

## Ink colour

`#064C9A`, measured from `ASD_logo_200x129.png`. Verified: every one of the
15,685 opaque pixels in the email asset is exactly this value.

## Still outstanding

The master is **raster, not vector**. 1002 px of ink is enough for every
current use, but a logo is the one asset that should be vector. **If an `.svg`,
`.ai`, `.eps` or `.pdf` of this mark exists, add it here** — the splash could
then go back to being resolution-independent, as it was before the rebrand.

## Known gaps — identifiers still say AAS or TRIP

None of these is user-visible, and renaming them is a large diff with no
benefit to a user, so they are deliberately left alone:

| Identifier | Where |
|---|---|
| `window.AAS_LOGO`, `aasLogo.html` | the page-header logo component |
| `_buildAASLogo` | `Email.js` |
| `.aas-brand-header`, `--aas-*` | `travelBaseStyles.html`, `tokens.html` |
| `TRIP_FAVICON_ID`, `TripConfig.js` | `00_config` |
| `trip-blocked-*` | `travelAccessBlockedPage.html` |
| `Test_Submitters`, `'AAS FO'` | **stored data** — renaming needs a migration and a half-done rename would misroute requests |

**The favicon is still the inherited image.** `TRIP_FAVICON_ID` points at a
Drive file nobody here controls; replacing it means uploading an ASD favicon
and setting the ID. Not done.

`client/components/Loader.html` still carries the AAS lettermark and the old
"Travel Request, Intake & Processing" tagline. **Nothing `include()`s it** —
`welcomeSvg.html` superseded it. It is excluded by name from both the CI guard
and `test_branding.js` §11, each of which *also* asserts it is still
unreachable, so the exclusion cannot quietly become a hole. The right fix is
deletion.
