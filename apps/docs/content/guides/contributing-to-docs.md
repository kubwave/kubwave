---
title: Contributing to the docs
description: How to edit, preview, and publish the kubwave documentation site.
---

The kubwave documentation is an [Astro](https://astro.build) site built with the
[Starlight](https://starlight.astro.build) theme. Content lives in
`apps/docs/src/content/docs/` as **MDX** (Markdown with JSX components).

## Quickstart: run the docs locally

1. **Install dependencies** from the repo root:

   ```sh
   bun install
   ```

2. **Start the dev server:**

   ```sh
   bun run --filter=docs dev
   ```

3. Open [http://localhost:4321](http://localhost:4321). The site hot-reloads on every save.

## Where files live

```
apps/docs/
├── astro.config.mjs          # Site config + sidebar structure
├── src/
│   ├── content/docs/         # ← All doc pages (.md / .mdx)
│   │   ├── index.mdx         # Landing page (splash hero)
│   │   ├── start/            # "Get Started" section
│   │   ├── guides/           # How-to guides
│   │   └── reference/        # API / CLI / Helm reference
│   ├── components/           # Custom Astro components
│   ├── assets/               # Images, logos
│   └── styles/custom.css     # Branding & dark theme overrides
└── public/                   # Static files (favicon, etc.)
```

## Adding a new page

1. Create a `.mdx` file in the right folder under `src/content/docs/`:

   ```sh
   touch apps/docs/src/content/docs/guides/my-new-guide.mdx
   ```

2. Add frontmatter at the top:

   ```mdx
   ---
   title: My New Guide
   description: What this page covers in one sentence.
   ---

   Content goes here.
   ```

3. Add the page to the sidebar in [`astro.config.mjs`](https://github.com/kubwave/kubwave/blob/main/apps/docs/astro.config.mjs):

   ```js
   {
     label: 'Guides',
     items: [
       { label: 'Deploy a service', slug: 'guides/deploy-a-service' },
       { label: 'Configure a service', slug: 'guides/configure-a-service' },
       { label: 'My New Guide', slug: 'guides/my-new-guide' }, // ← add here
     ],
   },
   ```

4. Check that navigation works in the dev server.

## Nuxt Content components you can use

The Nuxt docs app uses MDC components directly in Markdown; no imports are needed.

| Component syntax                                 | Use for                 |
| ------------------------------------------------ | ----------------------- |
| `::callout{type="note\|tip\|caution\|danger"}`   | Callout boxes           |
| `::tabs` + `:::tab{label="..."}`                 | Tabbed content sections |
| `::steps`                                        | Numbered step lists     |
| `::card-grid` + `::card{title="..." icon="..."}` | Link card grids         |
| `::link-card{title="..." to="..."}`              | Single next-step link   |

## Code blocks

Code blocks use [Shiki](https://shiki.style) with `github-dark`/`github-light` themes:

````mdx
```sh
kubwave install --domain app.example.com
```
````

The docs site uses a terminal-frame style for code blocks. Add a language tag to
get syntax highlighting; leave it blank for plain text.

## Frontmatter reference

Every page must have at least `title`. All supported fields:

```yaml
---
title: Page Title # required
description: SEO description # recommended
sidebar:
  label: Short Title # override the sidebar label
  order: 1 # manual sort order within a group
---
```

## Style conventions

- Use the documented docs design system and shared shadcn primitives for UI work.
- Use sentence-case for headings and sidebar labels.
- Keep pages self-contained. Link to related pages at the bottom with `::link-card`.
- The docs are **English-only** for v1.

## Testing your changes

```sh
# From the repo root:
bun run --filter=docs-nuxt dev    # hot-reload dev server

# Production build (verifies everything compiles):
bun run --filter=docs-nuxt build

# Format check:
bun run format:check
```

## Publishing

The docs site is deployed to Cloudflare Pages on every push to `main`. No manual
deployment step is needed — just open a PR and merge.

---

::link-card{title="Contributing to kubwave" description="Code contributions, dev setup, and the PR process." to="https://github.com/kubwave/kubwave/blob/main/CONTRIBUTING.md"}
::

::link-card{title="Starlight docs" description="Full Starlight documentation for advanced customization." to="https://starlight.astro.build"}
::
