# kubwave docs prototype

Static redesign preview of the public docs (Next.js, MDX, shadcn/ui, Tailwind v4), matching the console prototype in `../design`. Content is a one-off copy of `apps/docs/content` converted to MDX; the two are not kept in sync. Standalone project with its own lockfile, not part of the Bun workspace.

```sh
bun install
bun run dev          # http://localhost:3200
bun run build        # static export to out/
bun run check-types
```

Host `out/` on any static file server.
