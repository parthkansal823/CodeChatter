// pnpm install hooks (https://pnpm.io/pnpmfile).
//
// better-auth lists every framework it integrates with as an optional peer.
// pnpm links an optional peer whenever that package exists anywhere in the
// workspace, so the API and collab servers inherited Next.js, Vitest and
// drizzle-kit from the web app, and their production images grew by ~600 MB.
// Nothing imports better-auth's Next/Svelte/Solid/Vue/TanStack Start helpers
// (the web app uses better-auth/react and better-auth/cookies), so drop those
// peers. react/react-dom and drizzle-orm stay; they are used.
const UNUSED_BETTER_AUTH_PEERS = [
  "next",
  "drizzle-kit",
  "vitest",
  "solid-js",
  "svelte",
  "@sveltejs/kit",
  "vue",
  "@tanstack/react-start",
  "@tanstack/solid-start",
  "@lynx-js/react",
];

function readPackage(pkg) {
  if (pkg.name === "better-auth") {
    for (const name of UNUSED_BETTER_AUTH_PEERS) {
      if (pkg.peerDependencies) delete pkg.peerDependencies[name];
      if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
