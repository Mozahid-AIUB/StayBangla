"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Lang } from "./copy";

const STORAGE_KEY = "staybangla:lang";

interface LangValue {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const LangContext = createContext<LangValue>({ lang: "en", setLang: () => {} });

/**
 * Language state for the whole page.
 *
 * English is the initial value on both server and client so hydration matches;
 * a stored Bengali preference is applied in an effect straight after. The
 * alternative — reading localStorage during render — would make the server and
 * client disagree and React would discard the markup.
 */
export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "bn") queueMicrotask(() => setLangState("bn"));
    } catch {
      // Storage disabled. English is a fine fallback; nothing to recover.
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Preference just will not persist. The switch still works this visit.
    }
    // Keep the document's language honest — screen readers and the browser's
    // own translation prompt both key off it.
    document.documentElement.lang = l === "bn" ? "bn" : "en";
  }, []);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangValue {
  return useContext(LangContext);
}
