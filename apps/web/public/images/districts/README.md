# District photographs

Eight slots, one per card in the "Where to, and when" grid. Drop a file in,
then add the district to `DISTRICTS_WITH_PHOTO` in
`apps/web/src/lib/districts.ts` — two steps, and the card switches from its
painted tone to the photograph.

A district that is not listed there keeps its tone. That is a finished state,
not a broken one, so photographs can arrive one at a time.

## Where each file goes

One folder per card, already created. The card reads `cover.webp` and nothing
else, so the file must be named exactly that — the path is derived from the
district in code, not configured anywhere.

| Path                      | Card                                 |
| ------------------------- | ------------------------------------ |
| `coxs-bazar/cover.webp`   | Cox's Bazar — **the large one, 2×2** |
| `rangamati/cover.webp`    | Rangamati (Sajek) — wide, 2×1        |
| `saint-martin/cover.webp` | Saint Martin                         |
| `sreemangal/cover.webp`   | Sreemangal                           |
| `bandarban/cover.webp`    | Bandarban                            |
| `sundarbans/cover.webp`   | Sundarbans                           |
| `sylhet/cover.webp`       | Sylhet                               |
| `khagrachari/cover.webp`  | Khagrachari                          |

The other eight districts render as name chips and take no photograph.

Anything else you put in a district's folder is ignored for now — the folders
exist so a district can grow a gallery later without this turning into a flat
directory of `sylhet-2-final.webp`. The `.gitkeep` in each is only there
because git does not track empty folders; delete it once a real file lands.

## Specification

- **Format** WebP. Convert with `cwebp -q 82 in.jpg -o out.webp`.
- **Size** 1400 × 950 or thereabouts. The cards crop to fill, so the exact
  ratio does not matter — landscape does.
- **Weight** under 180 KB each. Eight of these load together on a phone; at
  1 MB apiece the section costs more than the rest of the page combined.
- **Orientation** landscape. Every card is wider than it is tall, including
  the large one, and a portrait photograph will be cropped to its middle band.

## What the picture has to survive

**The name sits along the bottom of the card, in white, over a dark wash.**
So:

- Keep the subject in the **upper two thirds**. The lower third is where the
  name, the line and the season bar go, and it is darkened to make them
  readable — a face or a horizon down there disappears.
- Avoid a bright bottom edge. Pale sand or open sky at the foot of the frame
  fights the white type, and no amount of scrim fixes it without also turning
  the picture to mud.
- Busy detail at the bottom reads as noise behind the text. Water, grass and
  open ground are all fine; a crowd is not.

`coxs-bazar.webp` is displayed roughly twice the size of the others, so it
wants the strongest picture of the eight, not merely a wide one.

---

This file is documentation and is served publicly along with the images.
Delete it before a production deploy if that matters to you; nothing reads it
at runtime.
