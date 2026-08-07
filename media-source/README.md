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

## Specification

- **Format** WebP.
- **Size** 1300 × 1000. Match the card's own aspect, near enough — the cards
  are about 1.26:1 on desktop and 1.26–1.32:1 on phones. This matters more
  than it sounds: `bg-cover` on a 1.47:1 image in a 1.26:1 card trims the
  sides and keeps the full height, so a picture cropped to remove its sky gets
  all of that sky back.
- **Weight** under 180 KB each. Eight of these load together on a phone; at
  1 MB apiece the section costs more than the rest of the page combined.
- **Grading** most stock is exposed for the sky, which leaves water and sand a
  stop brighter than a page whose cards are indigo and forest green. Bringing
  the brightness to around 0.72 (with a little saturation back, or it reads
  grey) both fixes that and gives the white type a surface. Saint Martin went
  from 3.9:1 to 7.1:1 on that change alone.
- **Orientation** landscape. A portrait photograph is cropped to its middle
  band.

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

Cox's Bazar is displayed roughly twice the size of the others, so it wants the
strongest picture of the eight, not merely a wide one.

Do not guess at any of this. Hide the type, screenshot what is behind it and
compute the contrast ratio for the rectangles the name and blurb occupy — a
photograph that looks fine at full size can put the name at 1.7:1 once the card
crops it, and that is invisible until it is measured.

## Licensing

Unsplash and Pexels are safe: free for commercial use, no attribution required.

Two things that turned up here and cannot be used, both small enough to spot by
file size alone:

- `istockphoto-*-612x612.jpg` — a watermarked preview of an image that has to
  be bought. Using it on a commercial site is infringement.
- `images.jfif`, `images` — search-result thumbnails. Too small to render, and
  with no known owner.
