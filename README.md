# scratchit

A complete Next.js/TypeScript/Tailwind app that reveals an uploaded photo through a recursive circle mosaic, extracts a dominant color palette in the browser, generates an image-aware inspirational quote through a configurable vision LLM, and exports a 1748×1240 PNG postcard.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

The app works without an API key by using its built-in fallback quotes.

## Configure quote generation

### OpenAI

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini
```

### Anthropic

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```

The browser sends only a JPEG thumbnail of at most 512 px plus the five extracted palette colors to `/api/quote`. The API key remains server-side.

## Production build

```bash
npm run build
npm start
```

## Deploy to Vercel

1. Push this folder to a Git repository and import it in Vercel.
2. Add `LLM_PROVIDER` and the matching API key/model in Project Settings → Environment Variables.
3. Deploy.

Or with the CLI:

```bash
vercel
vercel env add LLM_PROVIDER
vercel env add OPENAI_API_KEY
vercel --prod
```

## Implementation notes

- Image processing, transparent-image compositing, downscaling, integral images, k-means palette extraction, quad-tree interaction, reveal rendering, and postcard rendering all happen client-side.
- The quote route validates payloads, limits request size, applies a lightweight per-instance rate limit, and silently falls back if the provider is unavailable.
- The reveal starts with a six-cell fitted circle grid, then recursively splits each cell into four.
- “Reveal all” draws a uniform minimum-cell dot grid, stays on the reveal screen, and never substitutes square pixels.
- The postcard photo panel uses a dense circular dot matrix with a narrow, coarser circular rim.
- Refreshing intentionally resets the app.


## v4 interaction notes

- The postcard action appears only after the reveal reaches 100%.
- Reveal All animates the complete adaptive circle mosaic and remains on the reveal screen.
- Root cells are square and fitted inside the canvas; the complete source photo is contained rather than cropped.
- Every mark, including the smallest terminal mark, is rendered as a circle.


## v7 rendering and quote updates

- The reveal canvas now has an explicit viewport-relative display limit, so its intrinsic aspect ratio is contained instead of being clipped by the flex layout.
- Circle radii are clamped to the backing-canvas bounds during both static rendering and animation.
- Hover splits use a clearer 220 ms animation; Reveal All uses a 720 ms center-out wave.
- The postcard uses one aligned adaptive grid: two coarse outer layers, two medium layers, and a much larger dense center region.
- `/api/quote` calls the configured OpenAI or Anthropic vision model. Set the matching server-side API key in `.env.local` or Vercel; expanded local quotes are used only when the provider is unavailable.


## v8 motion and postcard themes

- Circle splits now use a faster 170 ms cross-fade with sinusoidal easing, subtle child staggering, and a restrained expanding ripple. Adjacent hovered cells can continue splitting concurrently.
- The postcard screen includes a Photo-derived automatic theme plus Ivory, Sage, Dusk, and Rose presets.
- Theme changes redraw the full-resolution postcard immediately and are included in the downloaded PNG.
