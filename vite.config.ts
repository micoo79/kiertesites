import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages szolgálja a `/<repo-név>/` útvonalon, ezért így állítjuk a base-t.
export default defineConfig({
  base: "/kiertesites/",
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
