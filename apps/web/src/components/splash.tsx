"use client";

import { useEffect, useState } from "react";

const SEEN_KEY = "staybangla:splash-seen";

/** How long the brand mark holds before the curtains start moving. */
const HOLD_MS = 450;

/** How long the curtains take to part. Matches the CSS duration below. */
const PART_MS = 550;

/**
 * Hard ceiling on the whole thing — hold plus part, one second total, as
 * specified. If anything stalls (slow image, busy main thread) the splash
 * leaves anyway. On Bangladeshi mobile networks a stuck overlay is the
 * difference between a visit and a bounce, so this ceiling is not optional.
 */
const MAX_VISIBLE_MS = HOLD_MS + PART_MS;

type Phase = "hidden" | "showing" | "parting";

/**
 * First-visit splash: a full-bleed image parts left and right like curtains to
 * reveal the hero already rendered beneath it.
 *
 * It is an overlay, never a gate. The page is fully server-rendered underneath,
 * so crawlers, no-JS visitors, and anyone who has been here before get the real
 * page immediately. This component only ever adds something on top.
 *
 * Starts as "hidden" rather than "showing" for the same reason: the first
 * server-rendered paint must not contain the overlay, or a returning visitor
 * would see it flash before the effect that dismisses it can run.
 */
export function Splash() {
  const [phase, setPhase] = useState<Phase>("hidden");

  useEffect(() => {
    // Anyone who has asked for less motion never sees this.
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) return;

    let alreadySeen = false;
    try {
      alreadySeen = window.sessionStorage.getItem(SEEN_KEY) === "1";
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Private mode or storage disabled. Showing the splash once more is a
      // far better failure than crashing the page over a cosmetic flourish.
    }
    if (alreadySeen) return;

    // Deferred to the next frame rather than set synchronously here: React 19
    // flags a synchronous setState in an effect as a cascading render, and
    // waiting a frame also guarantees the hero beneath has painted before the
    // overlay covers it — so a skip lands on real content, never a blank.
    let partTimer = 0;
    let doneTimer = 0;
    const frame = window.requestAnimationFrame(() => {
      setPhase("showing");
      partTimer = window.setTimeout(() => setPhase("parting"), HOLD_MS);
      doneTimer = window.setTimeout(() => setPhase("hidden"), MAX_VISIBLE_MS);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(partTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  // Any interaction skips it. Deliberately not gated on `showing` alone, so a
  // visitor can cut it short mid-part too.
  useEffect(() => {
    if (phase === "hidden") return;

    const dismiss = () => setPhase("hidden");
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) =>
      window.addEventListener(e, dismiss, { once: true, passive: true }),
    );
    return () => events.forEach((e) => window.removeEventListener(e, dismiss));
  }, [phase]);

  if (phase === "hidden") return null;

  const parting = phase === "parting";

  return (
    <div
      // aria-hidden: this is decoration. A screen reader should be reading the
      // real page underneath, not announcing a transition.
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {[
        { side: "left" as const, shift: parting ? "-100%" : "0%" },
        { side: "right" as const, shift: parting ? "100%" : "0%" },
      ].map(({ side, shift }) => (
        <div
          key={side}
          className="absolute inset-y-0 w-1/2 overflow-hidden will-change-transform"
          style={{
            [side]: 0,
            transform: `translate3d(${shift}, 0, 0)`,
            // Compositor-only: transform and opacity, nothing that triggers
            // layout. Mid-range Android is the target, not a desktop GPU.
            transition: `transform ${PART_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`,
          }}
        >
          {/*
            Each half holds a full-width backdrop offset so the two together
            read as one continuous image rather than two tiles.

            Replace this gradient with the real photograph:
              backgroundImage: "url(/images/splash/splash.jpg)"
            and keep backgroundSize: "200% 100%" so the halves still line up.
          */}
          <div
            className="absolute inset-y-0 w-[200%] bg-[linear-gradient(140deg,#0b4b2f_0%,#10643f_38%,#0f5b73_100%)] bg-cover bg-center"
            style={{ [side]: 0 }}
          />
        </div>
      ))}

      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          opacity: parting ? 0 : 1,
          transition: "opacity 400ms ease-out",
        }}
      >
        <span className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
          StayBangla
        </span>
      </div>
    </div>
  );
}
