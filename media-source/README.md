# Media staging

Originals live here. Nothing here is committed, and nothing here is served —
the site fetches its media from the R2 bucket `staybangla-media`.

```
media-source/
  districts/<slug>/   photographs as downloaded or shot, any size or format
  videos/             source footage and old encodes
```

**This folder is deliberately outside `apps/web/public/`.** It used to be
inside it, which was a mistake worth writing down: `public/` is not a
convenient place to keep files, it _is_ the site. `next build` copies all of it
into `out/`, and `wrangler deploy` publishes that — so 42 MB of unconverted
originals went live, including a watermarked iStock preview and two photographs
of hotel rooms. Adding them to `.gitignore` had kept them out of the repository
and did nothing about the deploy, because git and the build read different
lists. Outside `public/` there is no list to get wrong.

## Getting a photograph onto a card

1. Drop the original into `districts/<slug>/`. Any name, any size.
2. Convert it to a cover — cropped to roughly the card's aspect, graded down,
   under the weight budget.
3. Upload to `staybangla-media` as `images/districts/<slug>/cover.webp`.
4. Add the district to `DISTRICTS_WITH_PHOTO` in
   `apps/web/src/lib/districts.ts`.

A district that is not listed in step 4 keeps its painted tone — a finished
state, not a broken one, so photographs can arrive one at a time.

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
