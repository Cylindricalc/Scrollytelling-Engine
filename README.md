# Scrollytelling Engine

A scroll-driven "camera flythrough" story engine: as the page scrolls, a
virtual camera flies past text panels placed at different depths. No build
step, no dependencies.

**Files:**

| File | What it is |
|---|---|
| `scrollytelling-engine.js` | The engine. CSS, DOM, and all the JS — import this, don't edit it. |
| `story.html` | Every panel type, behavior, effect, and layer, in one showcase. |
| `neon-drift.html` | Example: fast, glitchy cyberpunk night-drive. |
| `quiet-morning.html` | Example: slow, calm, minimalist morning — sway and every jarring effect turned off. |

## Quick start

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Story</title>
  <script src="scrollytelling-engine.js"></script>
</head>
<body>
<script>
  const CONFIG = {
    panels: [
      { behavior: 'fade', type: 'title', text: 'MY STORY', chapter: true },
      { behavior: 'fade', type: 'body', text: 'Scroll to begin.' },
    ],
  };
  Scrollytelling.init(CONFIG);
</script>
</body>
</html>
```

Open it in Chrome, Edge, or another Chromium-based browser (see
[Browser support](#browser-support)) and scroll. `init()` injects all the
CSS and DOM the engine needs — your page just needs the two `<script>` tags.

## `CONFIG.panels`

Each entry is one panel the camera flies past:

```js
{
  type:     'title' | 'body' | 'small' | 'quote',           // typography
  behavior: 'fade' | 'zoom' | 'scroll' | 'pin' | 'split' | 'typewriter',
  text:     'Your line here',
  effects:  ['jolt'],       // optional, see Effects below
  chapter:  true,           // optional, adds a chapter-nav dot
}
```

For anything longer than one line, use `behavior: 'scroll'` with a
`sections` array — the main way to fit a whole chapter into one panel:

```js
{
  behavior: 'scroll',
  sections: [
    { type: 'body',  text: 'First line.' },
    { type: 'small', text: 'A quieter aside.', effects: ['flash'] },
    { type: 'body',  text: 'Something sudden happens.', effects: ['jolt'] },
  ],
}
```

Each section can have its own `type`, `image`, and `effects`. A section's
effect fires the moment that section is centered on screen.

**Images:** add `image: 'https://...'` to any panel or section (plus
optional `imageAlt`, `imageCaption`, `imageWidth`).

**Split panels:** use `left`/`right` instead of `text`:
`{ behavior: 'split', left: 'BEFORE', right: 'AFTER' }`.

### Behaviors

| | |
|---|---|
| `fade` | Blurs in, holds, fades out. Default. |
| `zoom` | Grows from small/blurred to full size, then keeps growing and blurs past. |
| `scroll` | Sections crawl upward through frame as you scroll. |
| `pin` | Hard appear/disappear cut — no fade. |
| `split` | Two lines slide in from opposite edges and meet. |
| `typewriter` | Characters type in, hold, then fade. |

### Effects

Not tied to scroll speed — each fires once, in real time, the instant
scroll crosses its trigger point.

| | |
|---|---|
| `jolt` | One big sudden hit — shakes the whole scene. |
| `flash` | A full-screen light hit, e.g. lightning. |
| `punch` | A fast scale-up snap — reads as impact, not shake. |
| `desaturate` | A grayscale pulse for a shock/flashback beat. |
| `slowmo` | Temporarily slows the ambient sway. |

`jolt` and `punch` move the same elements — don't combine them on one
trigger.

## Other `CONFIG` keys

```js
theme: { background, ink, accent, dim, fontFamily },

scene: {
  perspective,            // lower = more extreme depth "fisheye"
  depthPerPanel,           // scroll room per panel (scales with content)
  scrollPxPerDepthUnit,    // main "how long is this story" dial
  fadeWindowPercent: 'auto', // per-panel reveal window; 'auto' recommended
},

sway:       { enabled, amplitudeDeg, amplitudePx, durationSec }, // ambient rocking
jolt:       { enabled, durationSec, intensity },
flash:      { enabled, color, durationSec },
punch:      { enabled, durationSec, scaleAmount },
desaturate: { enabled, durationSec },
slowmo:     { enabled, durationSec, rate },        // rate: 0.2 = 1/5 speed

ui: { progressBar, chapterNav, fullscreenToggle, scrollHint, textDrift },

layers: [
  { type: 'backdrop', gradient: '...', image: '...' },              // distant sky/photo
  { type: 'rain', enabled: true, windAngle: 0.18 },                  // canvas rain
  { type: 'fgProp', side: 'left', color: '#050607', clipPath: '...' }, // or image: '...'
],
```

`layers` is an array, any order, any quantity. Set `enabled: false` on a
layer (or omit it) to skip it entirely.

## Extending

Registries are exposed on `Scrollytelling` — add to them *before* calling
`init()`:

```html
<script src="scrollytelling-engine.js"></script>
<script>
  Scrollytelling.PANEL_BEHAVIORS.myBehavior = (panelEl, innerEl, win, panelCfg, ctx) => { /* ... */ };

  Scrollytelling.init({ panels: [{ behavior: 'myBehavior', text: '...' }] });
</script>
```

- **New behavior** → `Scrollytelling.PANEL_BEHAVIORS`, matching CSS under
  `.panel.behavior-yourname` (add your own `<style>` for it — the engine's
  CSS is injected, not written in your HTML).
- **New effect** → `Scrollytelling.PANEL_EFFECTS`, calling `el.animate(...)`.
- **New layer type** → `Scrollytelling.LAYER_RENDERERS`, registered in
  `Scrollytelling.LAYER_SLOT`.

## Browser support

The camera motion uses `animation-timeline: scroll()` (current
Chromium-based browsers). Elsewhere, panels fall back to stacked and fully
visible — no content lost, just no camera effect. Effects use the Web
Animations API, which has much broader support.

## License

None specified — add one appropriate to how you're using this.