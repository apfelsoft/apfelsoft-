import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works from any URL prefix,
  // including GitHub Pages project sites (…github.io/<repo>/).
  base: "./",
});
