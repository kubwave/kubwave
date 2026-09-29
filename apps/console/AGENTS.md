<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Console

Repo-wide conventions, the auth model and the console layout are in the root [AGENTS.md](../../AGENTS.md).

Verify changes against the running dev server, not only with `tsc` and tests:

- The Next.js MCP server of `next dev` (`/_next/mcp`, wired up as `next-devtools` in the root `.mcp.json`) reports compilation issues (`get_compilation_issues`, `compile_route`), routes and server logs without a full `next build`.
- Browser warnings and errors are forwarded to the `next dev` terminal (`logging.browserToTerminal`, default `'warn'`).
