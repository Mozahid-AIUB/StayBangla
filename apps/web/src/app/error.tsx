"use client";

import { useEffect } from "react";

/**
 * The boundary that was missing.
 *
 * Without this file, a render error anywhere in the tree takes down the whole
 * page: in production the visitor gets Next's bare "Application error" screen
 * with no way back, and — worse — nothing anywhere records that it happened.
 *
 * `reset` re-renders the segment. It is offered because a good share of client
 * render failures are transient (a chunk that failed to fetch, a hydration race
 * on a slow connection), and retrying costs the visitor one tap instead of a
 * reload that starts the whole page again.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Console for now, deliberately. Wiring this to a real reporter is its own
    // change — it needs a service, a DSN in the environment, and a decision
    // about what personal data may leave the country. Logging the digest here
    // at least means the server-side stack can be matched to the report a user
    // describes, which is more than the default screen offers.
    console.error("Unhandled render error", { digest: error.digest, error });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col justify-center px-4 py-24 sm:px-6">
      <p className="text-muted-foreground text-sm">Something broke</p>
      <h1 className="font-display mt-4 text-3xl font-light sm:text-5xl">
        That did not load
      </h1>
      <p className="text-muted-foreground mt-4 text-base leading-relaxed">
        The fault is on our side, not yours. Trying again often works — if it
        does not, the page will be back shortly.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="bg-primary text-on-primary hover:bg-primary-hover inline-flex rounded-lg px-5 py-3 text-sm font-medium transition-colors"
        >
          Try again
        </button>
        {/*
          A plain anchor, and the lint rule is switched off on purpose rather
          than worked around.

          next/link exists to avoid a full document reload and keep the client
          cache. In an error boundary, discarding that cache is the entire
          point: whatever state produced the crash is still in memory, and a
          client-side navigation carries it to the next screen. `reset` above
          is the soft retry; this is the one that starts over.
        */}
        { }
        <a
          href="/"
          className="border-border text-foreground hover:bg-surface inline-flex rounded-lg border px-5 py-3 text-sm font-medium transition-colors"
        >
          Back to the start
        </a>
      </div>
      {error.digest && (
        <p className="text-muted-foreground mt-8 font-mono text-xs">
          {error.digest}
        </p>
      )}
    </main>
  );
}
