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
      workbox: {
        // The avatar editor lazy-imports @imgly/background-removal,
        // which pulls in onnxruntime-web's ~400 KB JS shim + a
        // 24 MB WASM binary. None of it should be in the offline
        // precache — bg removal is opt-in, and the bytes are
        // already streamed lazily on first toggle. Excluding them
        // from precache keeps the PWA install footprint at the
        // ~380 KB baseline instead of bloating to multi-MB.
        globIgnores: [
          // The 24 MB WASM model runtime — unconditionally too big
          "**/ort-wasm*.wasm",
          "**/ort-wasm*.mjs",
          "**/onnxruntime-web*.wasm",
          // The onnxruntime-web JS shim (CPU + WebGPU variants,
          // ~400 KB each). Vite emits these as separate chunks the
          // dynamic import already code-splits — no point shipping
          // them in the precache when they're only fetched by the
          // editor's bg-removal toggle.
          "**/ort.bundle.min-*",
          "**/ort.webgpu.bundle.min-*",
        ],
        // Keep the precache cap at 2 MiB (Workbox default) so a
        // future heavy-asset slip-up trips this same error and we
        // get to make a deliberate decision instead of bloating
        // the install footprint.
      },
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
