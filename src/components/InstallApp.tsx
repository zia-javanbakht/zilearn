"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes ziLearn installable on a phone or desktop. Only in a
 * production build: in development it would cache pages that hot reloading is changing.
 */
export function InstallApp() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Browsers only allow service workers on https or localhost; the app works without one.
    });
  }, []);
  return null;
}
