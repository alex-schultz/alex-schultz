import { defineConfig, type Plugin } from "vitest/config";
import path from "node:path";

// Vite 5 doesn't know about Node's newer built-ins (notably `node:sqlite`,
// added in Node 22.5) and strips the `node:` prefix before resolution,
// which then fails as "no package named 'sqlite'". This plugin tells Vite
// to leave anything in the `node:` namespace alone and let Node resolve
// it at runtime.
function externalNodeBuiltins(): Plugin {
  return {
    name: "external-node-builtins",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith("node:")) return { id, external: true };
    },
  };
}

export default defineConfig({
  plugins: [externalNodeBuiltins()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
