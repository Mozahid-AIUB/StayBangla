"use client";

import { useEffect, useState } from "react";

/**
 * Whether this visitor should be served heavy autoplaying media at all.
 *
 * Shared by the hero and the ad panel because the answer must be the same in
 * both: a rule written twice is a rule that gets fixed once.
 *
 * False on the server and on the first client frame, so nothing heavy is in
 * the initial HTML and there is no hydration mismatch to reconcile. Callers
 * render their still image and let this upgrade them.
 *
 * Three ways to be excluded, in order of how much they matter here:
 *
 * - prefers-reduced-motion: an accessibility setting, not a preference to
 *   weigh against anything.
 * - saveData: the visitor has explicitly asked their browser to spend less of
 *   their money. Autoplaying video against that is taking it.
 * - a genuinely slow link. On a Bangladeshi mobile connection a background
 *   video is the visitor's own data spent on decoration they did not ask for.
 */
export function useHeavyMediaAllowed(): boolean {
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

    if (conn?.saveData) return;

    // Only genuinely slow links are excluded. Requiring "4g" also blocked plain
    // wifi — the API reports a round-trip-time estimate, and a desktop on a
    // good connection is routinely classified "3g".
    if (conn?.effectiveType && /^(slow-)?2g$/.test(conn.effectiveType)) return;

    // Queued rather than set straight from the effect body, which React 19
    // flags as a cascading render.
    queueMicrotask(() => setAllowed(true));
  }, []);

  return allowed;
}
