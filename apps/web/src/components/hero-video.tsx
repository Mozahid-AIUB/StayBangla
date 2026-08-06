"use client";

import { useEffect, useState } from "react";

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
 * the transition snap. Two elements means the incoming clip is already decoded
 * and playing underneath before it becomes visible.
 */
export function HeroVideo() {
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // navigator.connection is Chromium-only. Where it is missing we opt in
    // rather than out.
    const conn = (
      navigator as Navigator & {
        connection?: { effectiveType?: string; saveData?: boolean };
      }
    ).connection;

    // Respect an explicit data-saver request without argument.
    if (conn?.saveData) return;

    // Only genuinely slow links are excluded. Requiring "4g" also blocked plain
    // wifi — the API reports a round-trip-time estimate, and a desktop on a
    // good connection is routinely classified "3g".
    if (conn?.effectiveType && /^(slow-)?2g$/.test(conn.effectiveType)) return;

    // Queued rather than set straight from the effect body, which React 19
    // flags as a cascading render.
    queueMicrotask(() => setAllowed(true));
  }, []);

  // Rotate on a timer rather than on `ended`: a clip that stalls mid-buffer
  // must not be able to freeze the rotation.
  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(
      () => setActive((i) => (i + 1) % SOURCES.length),
      CLIP_MS,
    );
    return () => window.clearTimeout(t);
  }, [visible, active]);

  if (!allowed) return null;

  return (
    <>
      {SOURCES.map((src, i) => (
        <video
          key={src}
          // aria-hidden: decorative. The hero's meaning is in its text, and a
          // screen reader announcing a silent background loop is only noise.
          aria-hidden
          autoPlay
          muted
          playsInline
          // Each clip loops on its own. The rotation decides which one is
          // *seen*; letting them run underneath means the incoming clip is
          // never mid-buffer at the moment it becomes visible.
          loop
          // Only the first clip is worth eagerly buffering. The second has a
          // full CLIP_MS to be ready, and preloading both at once would put
          // 7.8 MB in flight on first paint — exactly the stall this design
          // exists to avoid.
          preload={i === 0 ? "auto" : "metadata"}
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
    </>
  );
}
