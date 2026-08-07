"use client";

import { useEffect, useState } from "react";

/**
 * Whether the visitor has asked their system for reduced motion.
 *
 * Separate from useHeavyMediaAllowed, which also refuses on data-saver and
 * slow connections. Those are bandwidth answers: rotating a panel of text
 * costs no bandwidth, so a metered connection is no reason to stop it, while
 * reduced motion is exactly a reason to.
 *
 * False until the client says otherwise, so the server and the first frame
 * agree. Subscribed rather than read once, because the setting can be toggled
 * mid-session and a carousel that keeps moving after someone switches it on is
 * the failure the setting exists to prevent.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);

    // Queued rather than called straight from the effect body, which React 19
    // flags as a cascading render.
    queueMicrotask(sync);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}
