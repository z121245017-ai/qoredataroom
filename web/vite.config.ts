import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dianaProxies = {
  "/lcd": {
    target: "https://api-testnet.qore.host",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/lcd/, ""),
  },
  "/cosmos-rpc": {
    target: "https://rpc-testnet.qore.host",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/cosmos-rpc/, ""),
  },
  "/evm-rpc": {
    target: "https://evm-testnet.qore.host",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/evm-rpc/, ""),
  },
};

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: dianaProxies,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy: dianaProxies,
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
