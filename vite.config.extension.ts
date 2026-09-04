import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

const copyStaticAssets = () => ({
  name: "copy-static-assets",
  writeBundle() {
    const srcDir = path.resolve(__dirname, "public");
    const destDir = path.resolve(__dirname, "dist-extension");
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const filesToCopy = ["manifest.json", "icons"];
    for (const file of filesToCopy) {
      const src = path.join(srcDir, file);
      const dest = path.join(destDir, file);
      if (fs.existsSync(src)) {
        if (fs.lstatSync(src).isDirectory()) {
          fs.cpSync(src, dest, { recursive: true });
        } else {
          fs.copyFileSync(src, dest);
        }
      }
    }

    // The manifest references "popup.html" at the dist root. Vite's HTML entry
    // processing emits the built file under public/, and the raw public/popup.html
    // is copied verbatim to the root (still pointing at /src/popup.tsx). That broken
    // copy is what the extension loads, so a blank popup results. Overwrite the root
    // popup.html with the correct references to the compiled bundle.
    const popupHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Recallish - Universal AI Memory</title>
    <script type="module" crossorigin src="/popup.js"></script>
    <link rel="stylesheet" crossorigin href="/popup.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
    fs.writeFileSync(path.join(destDir, "popup.html"), popupHtml, "utf-8");
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), copyStaticAssets()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist-extension",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: "public/popup.html",
        background: "src/background.ts",
        contentScript: "src/content/contentScript.ts",
        contextMenu: "src/content/contextMenu.ts",
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") return "background.js";
          if (chunkInfo.name === "contentScript") return "contentScript.js";
          if (chunkInfo.name === "contextMenu") return "contextMenu.js";
          return "[name].js";
        },
        chunkFileNames: "chunks/[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "popup.css";
          return "[name].[ext]";
        },
      },
    },
    target: "es2022",
    minify: "esbuild",
    cssCodeSplit: false,
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});