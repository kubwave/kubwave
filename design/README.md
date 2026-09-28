# kubwave design prototype

Static, clickable redesign preview of the console (Next.js, shadcn/ui, Tailwind v4). Mock data only, no backend. Standalone project with its own lockfile, not part of the Bun workspace.

```sh
bun install
bun run dev          # http://localhost:3100
bun run build        # static export to out/
bun run check-types
```

Host `out/` on any static file server.
