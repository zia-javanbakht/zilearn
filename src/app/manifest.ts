import type { MetadataRoute } from "next";

/** Lets a phone or laptop install ziLearn as an app (Add to Home Screen / Install). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ziLearn",
    short_name: "ziLearn",
    description: "Your study suite: brainmaps, study plans, flashcards, mock exams and answers from your own course materials.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#3b5bdb",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
