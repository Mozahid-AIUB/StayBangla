"use client";

import { useEffect, useState } from "react";

/**
 * Whether an element is currently on screen.
 *
 * Exists for one job: nothing expensive should keep running once it has
 * scrolled away. A video decoding two hundred pixels below the fold costs the
 * same as one being watched, and on a laptop with integrated graphics that
 * cost comes straight out of the scroll's frame budget.
 *
 * Returns a *callback ref* rather than taking a RefObject, and that is the
 * whole design. The first version took a ref and read `ref.current` inside an
 * effect that only depended on the ref object — which never changes identity.
 * So if the observed element was not mounted on the same tick the hook first
 * ran, the effect saw null, returned, and never ran again: the observer was
 * never created and the element was reported off-screen for the rest of the
 * session. That is exactly what happened to the hero video, whose wrapper does
 * not exist until the connection check has finished a tick later, and the
 * result was a video that simply never played.
 *
 * A callback ref cannot fail that way. React calls it with the element the
 * moment it mounts, whenever that is, and with null when it goes — so the
 * effect below re-runs on the element itself rather than on a box that might
 * still be empty.
 *
 * `rootMargin` starts the work slightly before the element arrives, so it is
 * already running by the time it is visible rather than starting with a stall.
 */
export function useInViewport<T extends Element>(rootMargin = "0px") {
  // State, not a ref: a change here has to re-run the effect below, which is
  // the entire point.
  const [element, setElement] = useState<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!element) return;

    // Without the API, assume visible. Failing open means an old browser plays
    // the video always, which is the behaviour it had before this existed.
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setInView(true));
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, rootMargin]);

  // setElement is stable across renders, so it is safe to hand straight to a
  // ref attribute. `element` comes back too, because a caller that pauses a
  // video needs the node as well as whether it is showing.
  return { ref: setElement, element, inView };
}
