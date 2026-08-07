# District photographs

**The pictures do not go in this folder.** They go in the R2 bucket, under the
same paths listed below. This folder is only the map.

Media moved to object storage once the hero video made the cost obvious: 8 MB
of it sits in this repository's history permanently, serving nobody. Eight
photographs would have added the same weight for the same reason. `mediaUrl()`
in `src/lib/assets.ts` resolves every media path against the bucket, so the
paths here are bucket keys, not file paths.

Two steps to light up a card: upload the file, then add the district to
`DISTRICTS_WITH_PHOTO` in `apps/web/src/lib/districts.ts`. A district that is
not listed there keeps its painted tone — a finished state, not a broken one,
so photographs can arrive one at a time.

## Where each file goes

Bucket keys, in `staybangla-media`. The card reads `cover.webp` and nothing
else, so the name must be exactly that — the path is derived from the district
in code, not configured anywhere.

| Bucket key                                 | Card                                 |
| ------------------------------------------ | ------------------------------------ |
| `images/districts/coxs-bazar/cover.webp`   | Cox's Bazar — **the large one, 2×2** |
| `images/districts/rangamati/cover.webp`    | Rangamati (Sajek) — wide, 2×1        |
| `images/districts/saint-martin/cover.webp` | Saint Martin                         |
| `images/districts/sreemangal/cover.webp`   | Sreemangal                           |
| `images/districts/bandarban/cover.webp`    | Bandarban                            |
| `images/districts/sundarbans/cover.webp`   | Sundarbans                           |
| `images/districts/sylhet/cover.webp`       | Sylhet                               |
| `images/districts/khagrachari/cover.webp`  | Khagrachari                          |

The other eight districts render as name chips and take no photograph.

The empty folders beside this file are kept so the layout is visible from the
repository without opening the Cloudflare console. Nothing is served from
them.

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
