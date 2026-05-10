import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Hand the icons + favicon to Workbox's `globPatterns` baseline
      // so the install footprint precaches them — Add-to-Home-Screen
      // works offline on the first launch.
      includeAssets: [
        "favicon.ico",
        "icons/apple-touch-icon.png",
        "icons/favicon-16.png",
        "icons/favicon-32.png",
        "icons/favicon-48.png",
      ],
      manifest: {
        name: "Howler",
        short_name: "Howler",
        // Match index.html's `<meta name="theme-color">` (paper-toned).
        // Splash + status-bar paint with this; mismatched values cause
        // a flash of the wrong colour during PWA launch on Android.
        theme_color: "#F5EFE3",
        background_color: "#F5EFE3",
        display: "standalone",
        start_url: "/",
        scope: "/",
        // Keep PWA "any" + "maskable" entries separate. Android picks
        // the maskable one for adaptive icons (so the artwork survives
        // the OS-applied circle / squircle mask); iOS uses the
        // <link rel="apple-touch-icon"> in index.html.
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-192-maskable.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        // Mirrors the Pages Functions proxy in production. Set
        // VITE_WORKER_ORIGIN if your `wrangler dev` lives elsewhere.
        target: process.env["VITE_WORKER_ORIGIN"] ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
