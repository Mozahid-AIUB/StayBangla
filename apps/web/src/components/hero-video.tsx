"use client";

import { useEffect, useRef, useState } from "react";
import { useInViewport } from "@/lib/in-viewport";
import { useHeavyMediaAllowed } from "@/lib/media-connection";

const SOURCES = ["/videos/hero-1.mp4", "/videos/hero-2.mp4"] as const;

/** How long each clip holds before crossfading to the next. */
const CLIP_MS = 11000;

/** Crossfade duration. Long enough to read as a dissolve, not a cut. */
const FADE_MS = 1600;

/**
 * Optional video layer over the hero photograph.
 *
 * The photograph is always what loads first and is always what a slow
 * connection gets — 142 KB, effectively instant. This layer only ever fades in
 * on top, and only when the visitor has not asked for reduced motion, is not in
 * data-saver mode, and is not on a genuinely slow link.
 *
 * Both clips are mounted as their own <video> elements and crossfaded by
 * opacity. An earlier version swapped `src` on a single element, which forced
 * the browser to tear down and re-buffer on every turn — that gap is what made
 * the transition snap. Two elements means the incoming clip is already buffered
 * before it becomes visible.
 *
 * Exactly one of them is ever *playing*, and only while the hero is on screen.
 * Leaving both looping cost two simultaneous decodes for the entire session,
 * including the whole time the visitor was reading a section eight hundred
 * pixels further down — and that decode comes out of the same budget the
 * browser needs to keep scrolling at frame rate. Pausing is not the same
 * mistake as swapping `src`: a paused clip keeps everything it has buffered, so
 * resuming is immediate and the crossfade still has nothing to wait for.
 */
export function HeroVideo() {
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);
  // Reduced motion, data-saver and slow links all live in one place now, since
  // the ad panel has to answer the question identically.
  const allowed = useHeavyMediaAllowed();

  // A little ahead of arrival, so the clip is running by the time it is seen
  // rather than starting with a stall the moment it appears.
  const { ref: frameRef, inView: onScreen } =
    useInViewport<HTMLDivElement>("250px");

  const elements = useRef<(HTMLVideoElement | null)[]>([]);

  // Rotate on a timer rather than on `ended`: a clip that stalls mid-buffer
  // must not be able to freeze the rotation. Paused while off screen too —
  // otherwise the rotation runs on in the background and the visitor scrolls
  // back to a clip mid-fade.
  useEffect(() => {
    if (!visible || !onScreen) return;
    const t = window.setTimeout(
      () => setActive((i) => (i + 1) % SOURCES.length),
      CLIP_MS,
    );
    return () => window.clearTimeout(t);
  }, [visible, onScreen, active]);

  // The only place play/pause is decided, so there is one answer rather than
  // one per element.
  useEffect(() => {
    elements.current.forEach((element, i) => {
      if (!element) return;
      if (onScreen && i === active) {
        // Muted playback is never blocked by autoplay policy, but the promise
        // still rejects if the element is torn down mid-call.
        void element.play().catch(() => {});
      } else {
        element.pause();
      }
    });
  }, [onScreen, active, allowed]);

  if (!allowed) return null;

  return (
    // Wrapper exists to be observed. The videos keep their own -inset-px bleed
    // against this box, which is the same box they had before.
    <div ref={frameRef} className="absolute inset-0">
      {SOURCES.map((src, i) => (
        <video
          key={src}
          ref={(element) => {
            elements.current[i] = element;
          }}
          // aria-hidden: decorative. The hero's meaning is in its text, and a
          // screen reader announcing a silent background loop is only noise.
          aria-hidden
          muted
          playsInline
          loop
          // No autoPlay: the effect above owns playback, and letting the
          // browser start both on mount would spend a decode on the clip that
          // is about to be paused a frame later.
          //
          // The second clip is metadata-only until the first is actually
          // playing, then it starts buffering in earnest. Preloading both on
          // first paint would put 7.8 MB in flight at once — exactly the stall
          // this design exists to avoid — but it cannot stay at metadata
          // either: it used to arrive buffered because it was playing along
          // underneath, and now that it is paused, nothing would fetch it
          // before its turn. Downloading is not decoding; a paused clip filling
          // its buffer costs bandwidth, not frames.
          preload={i === 0 || visible ? "auto" : "metadata"}
          // canplaythrough alone is unreliable: the browser only fires it once
          // it predicts the whole file will play without stalling, which on a
          // 5 MB clip can be very late or never. loadeddata fires as soon as
          // the first frame exists, which is all the fade-in needs.
          onLoadedData={i === 0 ? () => setVisible(true) : undefined}
          onPlaying={i === 0 ? () => setVisible(true) : undefined}
          // -inset-px, not inset-0: the browser rounds a video's painted box to
          // whole pixels, and at fractional viewport heights that leaves a
          // hairline of the layer beneath showing along an edge — which is the
          // stray coloured rule this bleed removes.
          className="absolute -inset-px h-[calc(100%+2px)] w-[calc(100%+2px)] object-cover"
          style={{
            opacity: visible && active === i ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease-in-out`,
          }}
          src={src}
        />
      ))}
    </div>
  );
}
