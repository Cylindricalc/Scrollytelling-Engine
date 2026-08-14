/* ============================================================================
   SCROLLYTELLING ENGINE
   ----------------------------------------------------------------------------
   Everything needed to RUN a scrollytelling story, isolated into one
   importable file. Drop it in with a plain <script src="..."> tag, then in
   your own page write a CONFIG object and call Scrollytelling.init(CONFIG).

     <script src="scrollytelling-engine.js"></script>
     <script>
       const CONFIG = {
         theme:  { ... },
         scene:  { ... },
         sway:   { ... },
         jolt:   { ... },  flash: { ... },  punch: { ... },
         desaturate: { ... },  slowmo: { ... },
         layers: [ ... ],
         ui:     { ... },
         panels: [ ... ],
       };
       Scrollytelling.init(CONFIG);
     </script>

   This file injects its own <style> block and the DOM skeleton it needs
   (progress bar, camera viewport, chapter nav, settings bar, scroll hint)
   the first time init() runs, so the host page doesn't need any markup of
   its own beyond the two <script> tags above.

   Extending the engine: Scrollytelling.PANEL_BEHAVIORS, .PANEL_EFFECTS, and
   .LAYER_RENDERERS are exposed on the returned object, so you can add a new
   behavior/effect/layer type from your own script BEFORE calling init(),
   e.g. `Scrollytelling.PANEL_BEHAVIORS.myBehavior = (panelEl, innerEl, win,
   panelCfg, ctx) => { ... }`. See README.md ("Extending") for the contract
   each registry expects.

   See README.md for how to write CONFIG.panels and everything else that
   goes in the object you hand to init() — nothing in this file should need
   editing for typical use.
   ============================================================================ */
(function (global) {
  'use strict';

  /* ---- CSS injected once, on first init() ---- */
  const ENGINE_CSS = `
  :root {
    --bg: #0b0d10;
    --ink: #eae6dd;
    --accent: #d9663f;
    --dim: rgba(234,230,221,0.35);
    --font-family: Georgia, 'Times New Roman', serif;
    --total-depth: 4800px;
    --perspective: 900px;
    --panel-width: 640px;
    --sway-deg: 1.4deg;
    --sway-px: 10px;
    --sway-duration: 8.5s;
    --crawl-distance: 100vh;
    --section-gap: 16vh;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-family); }

  .scene-wrapper { position: relative; }

  .camera-viewport {
    position: sticky;
    top: 0;
    height: 100vh;
    overflow: hidden;
    perspective: var(--perspective);
    background: radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--bg) 80%, white 8%) 0%, var(--bg) 70%);
  }

  /* ---------- LAYER SLOTS ----------
     Renderers append into these; #layer-background sits behind the boat/
     camera, #layer-foreground sits in front of it. This is what guarantees
     correct stacking no matter what order CONFIG.layers lists things in. */
  #layer-background, #layer-foreground {
    position: absolute;
    inset: 0;
  }
  #layer-foreground { pointer-events: none; }

  /* ---------- backdrop layer type ---------- */
  .layer-backdrop {
    position: absolute;
    inset: -10% -10%;
    background-size: 100% 100%, 220% 220%;
  }
  .layer-backdrop::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(100deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 60px);
  }
  .layer-backdrop.no-grain::after { display: none; }
  @keyframes layer-drift {
    from { background-position: 0 0; }
    to   { background-position: 100% 40%; }
  }

  /* ---------- rain layer type ---------- */
  .layer-rain-canvas { position: absolute; inset: 0; }

  /* ---------- fgProp layer type ---------- */
  .layer-fg-prop {
    position: absolute;
    bottom: -4%;
    width: 34vw;
    max-width: 420px;
    height: 46vh;
    object-fit: cover; /* only affects <img> props; harmless no-op on <div> props */
    opacity: 0.9;
    animation: sway var(--sway-duration) ease-in-out infinite;
    animation-delay: -1.2s;
    transform-origin: 50% 140%;
  }

  /* ---------- boat sway (always-on ambient rocking) ---------- */
  .boat-sway {
    position: absolute;
    inset: 0;
    transform-origin: 50% 130%;
    animation: sway var(--sway-duration) ease-in-out infinite;
    will-change: transform;
  }
  @keyframes sway {
    0%   { transform: rotate(calc(var(--sway-deg) * -1))   translateY(0px); }
    22%  { transform: rotate(calc(var(--sway-deg) * 0.65))  translateY(calc(var(--sway-px) * -1)); }
    48%  { transform: rotate(calc(var(--sway-deg) * -0.4))  translateY(calc(var(--sway-px) * 0.6)); }
    70%  { transform: rotate(calc(var(--sway-deg) * 0.9))   translateY(calc(var(--sway-px) * -0.6)); }
    100% { transform: rotate(calc(var(--sway-deg) * -1))    translateY(0px); }
  }
  .no-sway .boat-sway, .no-sway .layer-fg-prop { animation: none !important; }
  @media (prefers-reduced-motion: reduce) {
    .boat-sway, .layer-fg-prop, .panel-inner { animation: none !important; }
  }

  /* ---------- flash effect (PANEL_EFFECTS: 'flash') ----------
     A full-viewport light overlay, independent of the jolt/camera —
     screen-blended so it brightens rather than just painting flat white
     over everything. Sits above the layers but below UI chrome. Its
     keyframes live in JS (see PANEL_EFFECTS.flash) and play via
     Element.animate() at a fixed real-world duration, triggered once when
     scroll crosses this effect's point — not scroll-scrubbed. */
  .effect-flash {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
    background: var(--flash-color, #ffffff);
    opacity: 0;
    mix-blend-mode: screen;
  }

  /* ---------- camera jolt (PANEL_EFFECTS: 'jolt') ----------
     Sits between the sway wrapper and the camera. No animation is
     declared here in CSS — see playJolt()/el.animate() in the script.
     Using the Web Animations API instead of a named CSS @keyframes here
     means there's nothing that can go silently out of sync (an animation
     -name typo or a keyframes rule that gets edited/removed elsewhere
     just fails silently in CSS; el.animate() keyframes live right next to
     the code that plays them). It fires once, in real time, the instant
     scroll crosses its trigger point — never scrubbed to scroll speed. */
  .camera-jolt {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    will-change: transform;
  }

  /* ---------- the camera itself ---------- */
  .camera {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    transform-style: preserve-3d;
  }
  @supports (animation-timeline: scroll()) {
    .camera { animation: fly-through linear both; animation-timeline: scroll(root block); }
  }
  @keyframes fly-through {
    /* The camera's Z position follows a linear curve through the depth
       budget. Each stop is total-depth * t for t = 0, 0.1, 0.2 ... 1.0.
       The result: consistent movement through the scene at a constant speed.
       Panel depths are matched to this same linear progression in JS. */
    0%   { transform: translate3d(0, 0, calc(var(--total-depth) * 0)); }
    10%  { transform: translate3d(0, 0, calc(var(--total-depth) * 0.1)); }
    20%  { transform: translate3d(0, 0, calc(var(--total-depth) * 0.2)); }
    30%  { transform: translate3d(0, 0, calc(var(--total-depth) * 0.3)); }
    40%  { transform: translate3d(0, 0, calc(var(--total-depth) * 0.4)); }
    50%  { transform: translate3d(0, 0, calc(var(--total-depth) * 0.5)); }
    60%  { transform: translate3d(0, 0, calc(var(--total-depth) * 0.6)); }
    70%  { transform: translate3d(0, 0, calc(var(--total-depth) * 0.7)); }
    80%  { transform: translate3d(0, 0, calc(var(--total-depth) * 0.8)); }
    90%  { transform: translate3d(0, 0, calc(var(--total-depth) * 0.9)); }
    100% { transform: translate3d(0, 0, var(--total-depth)); }
  }

  /* ---------- panels ---------- */
  .panel {
    position: absolute;
    top: 0;
    left: 0;
    width: var(--panel-width);
    max-width: 80vw;
    text-align: center;
    transform: translate3d(-50%, -50%, var(--z));
    opacity: 0;
    overflow: hidden; /* needed for the 'scroll' behavior's crawling text */
  }
  .panel p {
    font-size: 1.4rem;
    line-height: 1.6;
    text-shadow: 0 2px 20px rgba(0,0,0,0.8);
    margin: 0;
  }
  .panel.small p { font-size: 1.05rem; color: var(--dim); }
  .panel.title p { font-size: 3rem; font-weight: bold; letter-spacing: 0.05em; color: var(--accent); }

  /* behavior: fade — the default. Wide hold (55% of its own window stays
     fully opaque) so text has real reading time before it fades. */
  @supports (animation-timeline: scroll()) {
    .panel.behavior-fade { animation: panel-fade linear both; animation-timeline: scroll(root block); }
  }
  @keyframes panel-fade {
    0%   { opacity: 0; filter: blur(6px); }
    20%  { opacity: 1; filter: blur(0); }
    80%  { opacity: 1; filter: blur(0); }
    100% { opacity: 0; filter: blur(6px); }
  }

  /* behavior: zoom — text scales up from small/blurred (as if approaching
     from a distance) to full size and sharp, holds, then keeps growing and
     blurs past the camera. Same window/setRange mechanics as 'fade', just
     a different visual treatment — good for a single big emphatic beat. */
  @supports (animation-timeline: scroll()) {
    .panel.behavior-zoom { animation: panel-zoom linear both; animation-timeline: scroll(root block); }
  }
  @keyframes panel-zoom {
    /* transform must repeat translate3d(-50%,-50%,var(--z)) in every stop
       — an animated transform replaces the base .panel rule's transform
       entirely while running, so the depth (--z) component has to be
       carried along here or the panel would snap to z:0 during the zoom. */
    0%   { opacity: 0; filter: blur(10px); transform: translate3d(-50%, -50%, var(--z)) scale(0.4); }
    20%  { opacity: 1; filter: blur(0);     transform: translate3d(-50%, -50%, var(--z)) scale(1); }
    75%  { opacity: 1; filter: blur(0);     transform: translate3d(-50%, -50%, var(--z)) scale(1.08); }
    100% { opacity: 0; filter: blur(8px);   transform: translate3d(-50%, -50%, var(--z)) scale(1.6); }
  }
  .panel.behavior-zoom .panel-inner { display: inline-block; }

  /* behavior: pin — no fade, no crawl, just a hard appear/disappear cut.
     Built the same way as fade (identical opacity values held at nearly-
     adjacent keyframe percentages, so there's no meaningful interpolation
     window to visibly transition through) rather than via animation-
     timing-function: steps(), so it can reuse the same scroll(root block)
     + animation-range plumbing as every other behavior. Good for a stat
     callout or label that should feel abrupt rather than cinematic. */
  @supports (animation-timeline: scroll()) {
    .panel.behavior-pin { animation: panel-pin linear both; animation-timeline: scroll(root block); }
  }
  @keyframes panel-pin {
    0%, 3%      { opacity: 0; }
    3.01%, 97%  { opacity: 1; }
    97.01%, 100% { opacity: 0; }
  }

  /* behavior: split — two short pieces of text slide in from opposite
     edges and meet in the middle, then separate back out as the camera
     passes. Good for a contrast/comparison beat: BEFORE / AFTER,
     THEN / NOW. Config: { behavior: 'split', left: '...', right: '...' } —
     \`type\` styles both sides together the same way it styles a normal
     panel's text. */
  .panel.behavior-split {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.35em;
    flex-wrap: wrap;
    opacity: 1;      /* children handle their own visibility, not the panel */
    overflow: visible; /* let the incoming text travel from outside the panel's own box */
  }
  .split-left, .split-right {
    display: inline-block;
    font-size: 1.4rem;
    line-height: 1.6;
    white-space: nowrap;
    text-shadow: 0 2px 20px rgba(0,0,0,0.8);
  }
  .split-left { margin-right: 0.1em; }
  .split-right { margin-left: 0.1em; }
  .panel.title .split-left, .panel.title .split-right { font-size: 3rem; font-weight: bold; letter-spacing: 0.05em; color: var(--accent); }
  .panel.small .split-left, .panel.small .split-right { font-size: 1.05rem; color: var(--dim); }
  .panel.quote .split-left, .panel.quote .split-right { font-style: italic; font-size: 1.9rem; }
  @supports (animation-timeline: scroll()) {
    .split-left  { animation: split-in-left linear both;  animation-timeline: scroll(root block); }
    .split-right { animation: split-in-right linear both; animation-timeline: scroll(root block); }
  }
  /* Entry/exit stretched to 34% of the window (was 20%) and travel distance
     cut from 60vw to 38vw — the old version covered a lot of screen width
     in a short slice of scroll, which read as a sudden snap rather than a
     slide. Same total window, just a gentler approach/departure so the
     meeting-in-the-middle moment is easier to catch. */
  @keyframes split-in-left {
    0%   { transform: translateX(-38vw); opacity: 0; }
    34%  { transform: translateX(0);     opacity: 1; }
    66%  { transform: translateX(0);     opacity: 1; }
    100% { transform: translateX(-38vw); opacity: 0; }
  }
  @keyframes split-in-right {
    0%   { transform: translateX(38vw); opacity: 0; }
    34%  { transform: translateX(0);    opacity: 1; }
    66%  { transform: translateX(0);    opacity: 1; }
    100% { transform: translateX(38vw); opacity: 0; }
  }

  /* behavior: typewriter — characters appear one at a time as you scroll
     through the panel's window. This is the one behavior that ISN'T pure
     CSS: "how many characters so far" isn't something animation-timeline
     can drive on its own, so a scroll listener (see updateTypewriters in
     the engine) sets textContent directly based on scroll progress within
     [win.start, win.end]. The panel's own opacity is still handled here in
     CSS, same shape as fade but without the blur (a blurred typewriter
     reads as a rendering glitch, not a stylistic choice). */
  @supports (animation-timeline: scroll()) {
    .panel.behavior-typewriter { animation: panel-typewriter-fade linear both; animation-timeline: scroll(root block); }
  }
  @keyframes panel-typewriter-fade {
    0%   { opacity: 0; }
    15%  { opacity: 1; }
    85%  { opacity: 1; }
    100% { opacity: 0; }
  }
  /* NOTE: the 15%/85% stops above are read by name (not by value) in
     updateTypewriters() in the engine — TYPEWRITER_REVEAL_START/END there
     are set to finish typing well before 85%, so the fully-typed line gets
     real hold time before this fade-out begins. If you change 15/85 here,
     update those two constants to match. */
  .panel.behavior-typewriter .panel-inner { display: inline-block; }
  /* a blinking caret at the end of the typed text, purely decorative */
  .panel.behavior-typewriter p::after {
    content: '';
    display: inline-block;
    width: 0.5ch;
    height: 1em;
    margin-left: 0.05em;
    background: currentColor;
    vertical-align: -0.15em;
    animation: caret-blink 0.9s step-end infinite;
  }
  @keyframes caret-blink { 50% { opacity: 0; } }

  /* behavior: scroll — the panel becomes a full-viewport-tall clipping
     window (so text can travel the whole screen height, not just nudge a
     few pixels), and .panel-inner sweeps top-to-bottom through it via
     panel-crawl-move. Only a very slight edge-fade remains (mostly to
     avoid an instant pop at the very first/last moment of the whole
     document's scroll) — the "reveal" itself comes from real clipping,
     the same way normal page text scrolls into and out of view. */
  .panel.behavior-scroll {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  @supports (animation-timeline: scroll()) {
    .panel.behavior-scroll { animation: panel-scroll-fade linear both; animation-timeline: scroll(root block); }
    .panel.behavior-scroll .panel-inner { animation: panel-crawl-move linear both; animation-timeline: scroll(root block); }
  }
  .panel.behavior-scroll .panel-inner {
    display: block;
    width: 100%;
    /* Sections aren't positioned, so without this their offsetTop would
       resolve against .panel (the nearest positioned ancestor) instead of
       this element — which is wrong, since .panel-inner is vertically
       centered inside .panel via flex and that centering offset would
       leak into every section's measured position. Making this the
       positioning context keeps offsetTop == "distance from the top of
       the actual content stack", matching stackHeight in JS. */
    position: relative;
  }
  @keyframes panel-scroll-fade {
    0% { opacity: 0; } 5% { opacity: 1; } 95% { opacity: 1; } 100% { opacity: 0; }
  }
  @keyframes panel-crawl-move {
    /* amplitude is set per-panel via --crawl-distance (computed in JS from
       the actual measured height of that panel's sections), not a fixed
       value — a panel with 2 short sections and one with 8 long sections
       both travel exactly as far as they need to. */
    from { transform: translateY(var(--crawl-distance, 100vh)); }
    to   { transform: translateY(calc(var(--crawl-distance, 100vh) * -1)); }
  }

  /* ---------- SECTIONS ----------
     A 'scroll' panel can hold ONE OR MANY sections, stacked and spaced with
     --section-gap. As the panel scrolls through frame, you scroll past each
     section in turn — this is the primary way to write a lot of content
     into a single depth "slot," and each section can independently request
     its own effect (e.g. \`effects: ['jolt']\` on just that section). */
  .section { width: 100%; margin-bottom: var(--section-gap, 16vh); }
  .section:last-child { margin-bottom: 0; }
  .section p {
    font-size: 1.4rem;
    line-height: 1.6;
    text-shadow: 0 2px 20px rgba(0,0,0,0.8);
    margin: 0;
  }
  .section.small p { font-size: 1.05rem; color: var(--dim); }
  .section.title p { font-size: 3rem; font-weight: bold; letter-spacing: 0.05em; color: var(--accent); }

  /* ---------- images (panel/section \`image\` field) ---------- */
  .panel img, .section img {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    border-radius: 3px;
    margin: 0 auto 0.9rem;
    box-shadow: 0 14px 44px rgba(0,0,0,0.55);
  }
  .image-caption {
    font-size: 0.85rem;
    color: var(--dim);
    font-style: italic;
    margin: -0.4rem 0 1rem;
  }

  /* ---------- type: 'quote' — pull-quote styling for fade or scroll ---------- */
  .panel.quote p, .section.quote p {
    font-style: italic;
    font-size: 1.9rem;
    line-height: 1.5;
    color: var(--ink);
    padding: 0 0.4em;
  }
  .panel.quote p::before, .section.quote p::before {
    content: '\\201C';
    color: var(--accent);
    font-size: 1.4em;
    line-height: 0;
    vertical-align: -0.3em;
    margin-right: 0.05em;
  }

  /* independent text bob (behavior 'fade' only — 'scroll' uses its own crawl) */
  .panel.behavior-fade .panel-inner {
    display: inline-block;
    animation: text-float 7s ease-in-out infinite;
  }
  @keyframes text-float {
    0%   { transform: translateY(0px)   rotate(0deg); }
    25%  { transform: translateY(-5px)  rotate(-0.6deg); }
    50%  { transform: translateY(3px)   rotate(0.4deg); }
    75%  { transform: translateY(-3px)  rotate(-0.3deg); }
    100% { transform: translateY(0px)   rotate(0deg); }
  }
  .panel:nth-child(2n).behavior-fade .panel-inner { animation-duration: 6s;   animation-delay: -2s; }
  .panel:nth-child(3n).behavior-fade .panel-inner { animation-duration: 8.5s; animation-delay: -4s; }
  .no-text-drift .panel.behavior-fade .panel-inner { animation: none !important; }

  @supports not (animation-timeline: scroll()) {
    .camera { position: static; }
    .panel {
      position: relative; top: auto; left: auto; transform: none;
      margin: 40vh auto; opacity: 1; overflow: visible;
    }
    .panel-inner { animation: none !important; }
  }

  /* ---------- UI chrome ---------- */
  #progress-bar { position: fixed; top: 0; left: 0; height: 3px; background: var(--accent); z-index: 10; width: 100%; transform-origin: left; }
  @supports (animation-timeline: scroll()) {
    #progress-bar { animation: progress-fill linear both; animation-timeline: scroll(root block); }
  }
  @keyframes progress-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  .no-progress-bar #progress-bar { display: none; }

  #chapter-nav { position: fixed; right: 24px; top: 50%; transform: translateY(-50%); z-index: 10; display: flex; flex-direction: column; gap: 10px; }
  #chapter-nav a { width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--dim); display: block; text-indent: -9999px; transition: background .2s, transform .2s; }
  #chapter-nav a.active { background: var(--accent); border-color: var(--accent); transform: scale(1.3); }
  .no-chapter-nav #chapter-nav { display: none; }

  #settings-bar { position: fixed; left: 24px; bottom: 20px; z-index: 10; display: flex; gap: 18px; font-family: system-ui, sans-serif; font-size: .75rem; color: var(--dim); }
  #settings-bar label { cursor: pointer; user-select: none; }
  .no-fullscreen-toggle #settings-bar { display: none; }

  #scroll-hint { position: fixed; bottom: 20px; right: 24px; z-index: 10; font-family: system-ui, sans-serif; font-size: .7rem; color: var(--dim); letter-spacing: .1em; text-transform: uppercase; transition: opacity .4s; }
  .no-scroll-hint #scroll-hint { display: none; }`;

  /* ---- DOM skeleton injected once, on first init() ---- */
  const ENGINE_HTML = `
<div id="progress-bar"></div>

<div class="scene-wrapper">
  <div class="camera-viewport">
    <div id="layer-background"></div>
    <div class="boat-sway">
      <div class="camera-jolt" id="camera-jolt">
        <div class="camera" id="camera"></div>
      </div>
    </div>
    <div id="layer-foreground"></div>
    <div class="effect-flash" id="effect-flash"></div>
  </div>
</div>

<div id="chapter-nav"></div>
<div id="settings-bar"><label><input type="checkbox" id="full-screen"> Full Screen</label></div>
<div id="scroll-hint">Scroll to continue ↓</div>
`;

  function injectStyles() {
    if (document.getElementById('scrollytelling-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'scrollytelling-engine-styles';
    style.textContent = ENGINE_CSS;
    document.head.appendChild(style);
  }

  function injectSkeleton() {
    if (document.getElementById('camera')) return; // already present (e.g. a second init() call)
    document.body.insertAdjacentHTML('afterbegin', ENGINE_HTML);
  }

  /* Set by init() — the registries below close over this variable, so they
     always see whatever CONFIG the page most recently passed to init(). */
  let CONFIG = null;

  /* Typewriter reveal window, as a fraction of the panel's own
     [win.start, win.end] — kept separate from the fade window (15%/85%,
     see @keyframes panel-typewriter-fade above) so the full line finishes
     typing with time to spare before the fade-out starts, instead of the
     last characters landing exactly as the text disappears. Typing starts
     right as the fade-in finishes (0.15) and finishes well before the
     fade-out begins (0.70), leaving the gap up to 0.85 as a silent hold on
     the complete line. */
  const TYPEWRITER_REVEAL_START = 0.15;
  const TYPEWRITER_REVEAL_END = 0.70;

/* ============================================================================
   PANEL_BEHAVIORS registry
   ----------------------------------------------------------------------------
   Each function receives (panelEl, innerEl, win, panelCfg, ctx):
     panelEl / innerEl   the empty <div class="panel"> and its <div
                         class="panel-inner"> — the behavior is responsible
                         for filling innerEl with content.
     win                 { start, end, peak } — this panel's own
                         animation-range window (already computed from depth).
     panelCfg            the raw CONFIG.panels entry.
     ctx.registerEffect(name, triggerPct)  hook into PANEL_EFFECTS — triggerPct
                                           is the scroll % where the effect fires,
                                           not a range
     ctx.registerChapter(peakPct, label) add a chapter-nav entry
   To add a new behavior: write a function here, add matching CSS rules
   keyed off `.panel.behavior-yourname`, and reference it via `behavior:
   'yourname'`.
   ============================================================================ */
// Shared image renderer — used by both 'fade' and 'scroll' so any panel or
// section can carry an `image` alongside (or instead of) `text`. Fields:
//   image        url (nothing rendered if omitted)
//   imageAlt     alt text — always set this for real content
//   imageCaption optional small italic line rendered under the image
//   imageWidth   CSS width, e.g. '70%' or '360px' (default: fills the panel)
function renderMedia(container, cfg) {
  if (!cfg.image) return;
  const img = document.createElement('img');
  img.src = cfg.image;
  img.alt = cfg.imageAlt || '';
  img.loading = 'lazy';
  if (cfg.imageWidth) img.style.width = cfg.imageWidth;
  container.appendChild(img);
  if (cfg.imageCaption) {
    const cap = document.createElement('p');
    cap.className = 'image-caption';
    cap.textContent = cfg.imageCaption;
    container.appendChild(cap);
  }
}

// Shared by anything that needs the type-based typography class
// ('title' | 'small' | 'quote' — 'body' and anything else is the default,
// no class needed).
function addTypeClass(el, type) {
  if (type === 'title') el.classList.add('title');
  if (type === 'small') el.classList.add('small');
  if (type === 'quote') el.classList.add('quote');
}

// Shared by any single-content behavior (fade, zoom, pin, ...): applies
// the type-based typography class and fills innerEl with image + text.
function fillSingleContent(panelEl, innerEl, panelCfg) {
  addTypeClass(panelEl, panelCfg.type);
  renderMedia(innerEl, panelCfg);
  if (panelCfg.text) {
    const p = document.createElement('p');
    p.textContent = panelCfg.text;
    innerEl.appendChild(p);
  }
}

const PANEL_BEHAVIORS = {
  fade(panelEl, innerEl, win, panelCfg) {
    panelEl.classList.add('behavior-fade');
    setRange(panelEl, win);
    fillSingleContent(panelEl, innerEl, panelCfg);
  },

  // zoom — same window mechanics as fade, different visual: text grows in
  // from small/blurred (as if approaching from a distance), holds sharp,
  // then keeps growing and blurs past. Good for a single emphatic beat —
  // a big number, a name, a place — where scale reads as "closing in".
  zoom(panelEl, innerEl, win, panelCfg) {
    panelEl.classList.add('behavior-zoom');
    setRange(panelEl, win);
    fillSingleContent(panelEl, innerEl, panelCfg);
  },

  // pin — no fade, no crawl, just a hard appear/disappear cut. Same
  // window mechanics as fade, reuses fillSingleContent for its content.
  pin(panelEl, innerEl, win, panelCfg) {
    panelEl.classList.add('behavior-pin');
    setRange(panelEl, win);
    fillSingleContent(panelEl, innerEl, panelCfg);
  },

  // split — two short pieces of text slide in from opposite edges and
  // meet in the middle. Config: { left: '...', right: '...' } instead of
  // `text`. `type` styles both sides the same way it styles normal text.
  split(panelEl, innerEl, win, panelCfg) {
    panelEl.classList.add('behavior-split');
    addTypeClass(panelEl, panelCfg.type);
    setRange(panelEl, win); // no opacity animation of its own (children handle it), but
                            // still needed so any per-panel effect fallback (win.start) works
    const left = document.createElement('span');
    left.className = 'split-left';
    left.textContent = panelCfg.left || '';
    const right = document.createElement('span');
    right.className = 'split-right';
    right.textContent = panelCfg.right || '';
    innerEl.appendChild(left);
    innerEl.appendChild(right);
    setRange(left, win);
    setRange(right, win);
  },

  // typewriter — characters appear one at a time as scroll progresses
  // through this panel's window. The only behavior that needs a live
  // scroll listener rather than pure CSS — see updateTypewriters() in the
  // engine, wired up via ctx.registerTypewriter here.
  typewriter(panelEl, innerEl, win, panelCfg, ctx) {
    panelEl.classList.add('behavior-typewriter');
    addTypeClass(panelEl, panelCfg.type);
    setRange(panelEl, win);
    renderMedia(innerEl, panelCfg);
    const p = document.createElement('p');
    innerEl.appendChild(p);
    ctx.registerTypewriter(p, panelCfg.text || '', win);
  },

  // 'scroll' panels hold one or more SECTIONS, stacked vertically and swept
  // through the frame as one continuous crawl. The crawl distance is
  // measured from the actual rendered content (so it always exactly fits,
  // whether there's one line or ten paragraphs), and each section's own
  // moment of being centered on screen is used to fire that section's own
  // effects/chapter registrations.
  scroll(panelEl, innerEl, win, panelCfg, ctx) {
    panelEl.classList.add('behavior-scroll');
    setRange(panelEl, win);
    setRange(innerEl, win);

    // Shorthand: a plain `text` (no `sections`) becomes a single section.
    const sections = panelCfg.sections || [{
      text: panelCfg.text, type: panelCfg.type, effects: panelCfg.effects, chapter: panelCfg.chapter,
    }];

    const sectionEls = sections.map(s => {
      const sec = document.createElement('div');
      sec.className = 'section';
      addTypeClass(sec, s.type);
      renderMedia(sec, s);
      if (s.text) {
        const p = document.createElement('p');
        p.textContent = s.text;
        sec.appendChild(p);
      }
      innerEl.appendChild(sec);
      return sec;
    });

    // Measure AFTER appending, so the crawl distance matches real content.
    const stackHeight = innerEl.scrollHeight;
    const crawlDistance = stackHeight / 2 + window.innerHeight / 2 + 40;
    panelEl.style.setProperty('--crawl-distance', crawlDistance + 'px');

    // Map each section's position within the stack to a scroll % in this
    // panel's own [win.start, win.end] window — this is what an effect or
    // chapter-nav dot registers against.
    //
    // IMPORTANT: this is NOT elTop/stackHeight. The crawl doesn't move the
    // stack directly from "all visible" to "all visible" across the window
    // — it travels from fully off-screen below (+crawlDistance) to fully
    // off-screen above (-crawlDistance), and crawlDistance itself pads
    // stackHeight by a full viewport height on each side (see crawlDistance
    // above) so content always enters/exits from off-screen instead of
    // popping. A naive elTop/stackHeight mapping ignores that padding
    // entirely — it treats 0% of the window as "top of stack centered,"
    // which is actually somewhere around the middle of the window once the
    // padding is accounted for. That mismatch is what made effects on a
    // multi-section panel fire well before or after the section they were
    // meant to land on. toFrac() below inverts the actual crawl motion —
    // .panel-inner's translateY(t) goes linearly from +crawlDistance at t=0
    // to -crawlDistance at t=1 (see panel-crawl-move) — so a section at
    // stack-offset `d` lands centered on screen (translateY == stackHeight/2 - d)
    // at exactly the fraction this computes, matching what's on screen.
    const clamp01 = f => Math.max(0, Math.min(1, f));
    const toFrac = d => crawlDistance > 0
      ? clamp01((crawlDistance - stackHeight / 2 + d) / (2 * crawlDistance))
      : 0.5;
    const toPct = f => win.start + f * (win.end - win.start);

    sections.forEach((s, idx) => {
      const el = sectionEls[idx];
      const centerD = el.offsetTop + el.offsetHeight / 2;
      const peakPct = toPct(toFrac(centerD));
      // Effects fire at peakPct too — the moment the section is actually
      // centered on screen, i.e. as readable as it'll ever be — rather than
      // some earlier "starts entering frame" point that (with the fix
      // above) would just be an unnecessary extra fraction to compute for
      // no real sync benefit.
      (s.effects || []).forEach(name => ctx.registerEffect(name, peakPct));
      if (s.type === 'title' || s.chapter) ctx.registerChapter(peakPct, s.text);
    });
  },
};

/* ============================================================================
   PANEL_EFFECTS registry
   ----------------------------------------------------------------------------
   These are NOT scroll-linked animations — they're one-shot: the engine
   watches scroll position, and the instant it crosses a registered trigger
   point (see registerEffect/effectTriggers below), the matching function
   here fires via el.animate() (Web Animations API) at a fixed real-world
   duration. Scrolling fast doesn't rush it, scrolling slowly doesn't drag
   it out, and stopping mid-scroll doesn't freeze it mid-animation — once
   triggered it just plays, like clicking a button would.
   Keyframes are defined in JS right here rather than as named CSS
   @keyframes, specifically so a rule can't quietly drift out of sync with
   (or get edited/removed independently of) the code that plays it.
   To add a new effect: add a shared element in the HTML/CSS (see
   .camera-jolt / .effect-flash), write a function here that builds its
   keyframes and calls el.animate(...), and reference it via a panel or
   section's `effects: ['yourname']`.
   ============================================================================ */
const PANEL_EFFECTS = {
  // shakeWholeScene(buildKeyframes, durationMs) is shared by any effect
  // meant to read as something happening to the CAMERA/scene itself
  // (jolt now, and future ones like a dolly-punch) — it plays the same
  // shake across three targets at once:
  //   #camera-jolt      moves the panels/text (full strength)
  //   #layer-foreground  moves foreground props (full strength — closest
  //                      to camera, should react the most)
  //   #layer-background  moves the backdrop AND rain, since rain's canvas
  //                      lives inside this element (half strength — a
  //                      distant backdrop shaking as hard as something
  //                      right in front of the camera would look like the
  //                      whole image just slid, not a camera in 3D space)
  // UI chrome (progress bar, chapter nav, settings, scroll hint) lives
  // outside .camera-viewport entirely, so it's structurally untouched by
  // this — no special-casing needed to keep it still.
  shakeWholeScene(buildKeyframes, durationMs) {
    [
      { id: 'camera-jolt', scale: 1 },
      { id: 'layer-foreground', scale: 1 },
      { id: 'layer-background', scale: 0.5 },
    ].forEach(({ id, scale }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.getAnimations().forEach(a => a.cancel()); // interrupt + restart cleanly if re-triggered
      el.animate(buildKeyframes(scale), { duration: durationMs, easing: 'linear', fill: 'both' });
    });
  },

  // jolt — ONE big, sudden hit: a large translate/rotate/skew that snaps
  // in almost instantly (5% of the duration — with a ~0.8s default that's
  // under 40ms, i.e. a single frame or two), one small corrective nudge
  // right after, then settles and holds. Deliberately NOT a multi-beat
  // decaying oscillation — that reads as rocking/shaking rather than a
  // single impact, which is the wrong feeling for e.g. a wave slamming
  // the boat or any other one-time hit. Plays across the whole scene (see
  // shakeWholeScene above) so it reads as the camera getting hit, not
  // just the text jumping in place. On a 'scroll' section this fires
  // right as that subsection enters frame; on a standalone panel it fires
  // as the panel starts becoming visible.
  jolt() {
    if (!CONFIG.jolt.enabled) return;
    const k = CONFIG.jolt.intensity;
    const px = (n, scale) => `${n * k * scale}px`;
    const deg = (n, scale) => `${n * k * scale}deg`;
    const buildKeyframes = (scale) => [
      { transform: 'translate3d(0,0,0) rotate(0deg) skewX(0deg)', offset: 0 },
      { transform: `translate3d(${px(55, scale)}, ${px(-70, scale)}, 0) rotate(${deg(-9, scale)}) skewX(${deg(11, scale)})`, offset: 0.05 },
      { transform: `translate3d(${px(-14, scale)}, ${px(10, scale)}, 0) rotate(${deg(2.5, scale)}) skewX(${deg(-3, scale)})`, offset: 0.22 },
      { transform: 'translate3d(0,0,0) rotate(0deg) skewX(0deg)', offset: 0.5 },
      { transform: 'translate3d(0,0,0) rotate(0deg) skewX(0deg)', offset: 1 },
    ];
    PANEL_EFFECTS.shakeWholeScene(buildKeyframes, CONFIG.jolt.durationSec * 1000);
  },

  // flash — a full-viewport light hit (see .effect-flash), for a beat like
  // lightning or a camera flash. This one stays screen-space rather than
  // going through shakeWholeScene: a light hit doesn't have a position to
  // move, it's already covering everything at once. Independent of jolt:
  // use one, the other, or both together (a wave slam + a flash of
  // lightning at the same moment reads very differently from either alone).
  flash() {
    if (!CONFIG.flash.enabled) return;
    const el = document.getElementById('effect-flash');
    document.documentElement.style.setProperty('--flash-color', CONFIG.flash.color);
    el.getAnimations().forEach(a => a.cancel());
    el.animate([
      { opacity: 0,    offset: 0 },
      { opacity: 0.9,  offset: 0.06 },
      { opacity: 0.15, offset: 0.18 },
      { opacity: 0.5,  offset: 0.26 },
      { opacity: 0,    offset: 1 },
    ], { duration: CONFIG.flash.durationSec * 1000, easing: 'linear', fill: 'both' });
  },

  // punch — a sharp, fast scale-up that snaps back, reading as a hit or
  // impact rather than jolt's "thrown off balance" skew/rotate feeling.
  // Reuses shakeWholeScene so it moves the same three targets jolt does —
  // don't combine punch and jolt on the same trigger, they'd both animate
  // the same elements' transform and the second call cancels the first.
  punch() {
    if (!CONFIG.punch.enabled) return;
    const amount = CONFIG.punch.scaleAmount;
    const buildKeyframes = (scale) => [
      { transform: 'scale(1)', offset: 0 },
      { transform: `scale(${1 + amount * scale})`, offset: 0.08 },
      { transform: 'scale(1)', offset: 0.4 },
      { transform: 'scale(1)', offset: 1 },
    ];
    PANEL_EFFECTS.shakeWholeScene(buildKeyframes, CONFIG.punch.durationSec * 1000);
  },

  // desaturate — a grayscale/contrast pulse across the whole viewport, for
  // a shock or memory-flashback beat. Screen-space like flash (a filter
  // doesn't have a position to move), applied directly to .camera-viewport
  // — which already contains exactly background + camera + foreground and
  // excludes all UI chrome, so no separate whole-scene wiring is needed
  // here the way jolt/punch need shakeWholeScene. Don't combine with
  // 'chroma' if you build it — both would animate the same element's
  // `filter` property and the later call wins.
  desaturate() {
    if (!CONFIG.desaturate.enabled) return;
    const el = document.querySelector('.camera-viewport');
    el.getAnimations().forEach(a => a.cancel());
    el.animate([
      { filter: 'grayscale(0) contrast(1)' , offset: 0 },
      { filter: 'grayscale(0.9) contrast(1.3)', offset: 0.15 },
      { filter: 'grayscale(0.9) contrast(1.3)', offset: 0.75 },
      { filter: 'grayscale(0) contrast(1)', offset: 1 },
    ], { duration: CONFIG.desaturate.durationSec * 1000, easing: 'ease-in-out', fill: 'both' });
  },

  // slowmo — temporarily slows the ambient sway (the boat rocking, and any
  // fgProp layers) rather than playing a new one-shot animation. Uses
  // getAnimations() to reach into the already-running CSS `animation` on
  // those elements and adjust playbackRate directly, then restores it
  // after durationSec. Structurally different from every other effect
  // here for exactly that reason — there's no keyframe list, it's just
  // speed control on something already playing.
  slowmo() {
    if (!CONFIG.slowmo.enabled) return;
    const targets = [document.querySelector('.boat-sway'), ...document.querySelectorAll('.layer-fg-prop')];
    targets.forEach(el => {
      if (!el) return;
      el.getAnimations().forEach(anim => { anim.playbackRate = CONFIG.slowmo.rate; });
    });
    clearTimeout(PANEL_EFFECTS._slowmoRestoreTimer);
    PANEL_EFFECTS._slowmoRestoreTimer = setTimeout(() => {
      targets.forEach(el => {
        if (!el) return;
        el.getAnimations().forEach(anim => { anim.playbackRate = 1; });
      });
    }, CONFIG.slowmo.durationSec * 1000);
  },

  // More ideas for effects — not built:
  //   'chroma' — a true per-channel RGB split (chromatic aberration) is a
  //              bigger lift than the others: it needs an SVG <filter>
  //              with feOffset primitives animated via their dx/dy
  //              attributes (WAAPI can animate SVG presentation attributes,
  //              but support and edge-case behavior is less consistent
  //              than animating `transform`/`opacity`/`filter` the way
  //              every other effect here does). A cheap approximation —
  //              hue-rotate/saturate/contrast pulses via the same pattern
  //              as desaturate() — reads as a color glitch rather than a
  //              true optical split, which is why it's left as an idea
  //              rather than shipped under a name that overpromises.
};

/* ============================================================================
   LAYER_RENDERERS registry
   ----------------------------------------------------------------------------
   Each function receives (layerConfig, slotEl) and appends whatever DOM/canvas
   it needs into slotEl. 'backdrop' and 'rain' render into #layer-background;
   'fgProp' renders into #layer-foreground — that's what keeps stacking order
   correct regardless of how CONFIG.layers is ordered. To add a new layer
   type: write a renderer here, add it to LAYER_SLOT below, and reference it
   via `{ type: 'yourname', ... }` in CONFIG.layers.

   backdrop and fgProp ship with real customization, not just their preset
   look: gradient AND/OR your own image, size/position/blendMode/opacity for
   backdrop; color+clipPath (default) OR your own image, width/height/
   bottom/offset/opacity and per-prop sway overrides for fgProp. rain is
   kept deliberately minimal — see the comment inside rain() below for why.
   ============================================================================ */
const LAYER_RENDERERS = {
  backdrop(cfg, slot) {
    const div = document.createElement('div');
    div.className = 'layer-backdrop';
    // `image` and `gradient` can be combined — image renders as the bottom
    // background layer, gradient composites over it as the second (the
    // same multi-background trick CSS itself uses), so you can drop in a
    // photo/texture and still keep a color-grading gradient on top. Pass
    // only one of them if you just want a photo, or just a gradient.
    const images = [cfg.image ? `url("${cfg.image}")` : null, cfg.gradient || null].filter(Boolean);
    div.style.backgroundImage = images.join(', ');
    div.style.backgroundSize = cfg.size || (cfg.image ? 'cover, 100% 100%' : '100% 100%');
    div.style.backgroundPosition = cfg.position || 'center';
    div.style.backgroundBlendMode = cfg.blendMode || 'normal';
    if (cfg.opacity != null) div.style.opacity = cfg.opacity;
    if (cfg.grain === false) div.classList.add('no-grain');
    div.style.animation = `layer-drift ${cfg.driftSec ?? 60}s linear infinite`;
    if (CONFIG.sway.enabled === false || cfg.drift === false) div.style.animation = 'none';
    slot.appendChild(div);
  },
  // Kept intentionally lean: one canvas, one rAF loop, drops as plain
  // {x,y,len,speed} objects, stroked as lines. `enabled: false` (or
  // omitting the layer) is the way to turn it off — that's a full skip,
  // no canvas element, no draw loop, zero runtime cost.
  rain(cfg, slot) {
    if (cfg.enabled === false) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'layer-rain-canvas';
    slot.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    function size() { canvas.width = innerWidth; canvas.height = innerHeight; }
    size();
    window.addEventListener('resize', size);

    function makeDrops(opts) {
      return Array.from({ length: opts.count }, () => ({
        x: Math.random() * (innerWidth + 300) - 150,
        y: Math.random() * innerHeight,
        len: opts.lenMin + Math.random() * (opts.lenMax - opts.lenMin),
        speed: opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin),
      }));
    }
    const bg = makeDrops(cfg.background);
    const fg = makeDrops(cfg.foreground);
    const windAngle = cfg.windAngle ?? 0.18;

    function drawLayer(drops, opacity, width) {
      ctx.strokeStyle = `rgba(210,220,230,${opacity})`;
      ctx.lineWidth = width;
      drops.forEach(d => {
        d.x += Math.sin(windAngle) * d.speed;
        d.y += Math.cos(windAngle) * d.speed;
        if (d.y > canvas.height + d.len) { d.y = -d.len; d.x = Math.random() * (innerWidth + 300) - 150; }
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - Math.sin(windAngle) * d.len, d.y - Math.cos(windAngle) * d.len);
        ctx.stroke();
      });
    }
    (function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawLayer(bg, cfg.background.opacity, cfg.background.width);
      drawLayer(fg, cfg.foreground.opacity, cfg.foreground.width);
      if (cfg.vignette) {
        const v = ctx.createRadialGradient(canvas.width/2, canvas.height/2, canvas.height*0.25, canvas.width/2, canvas.height/2, canvas.height*0.75);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, 'rgba(0,0,0,0.45)');
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      requestAnimationFrame(draw);
    })();
  },
  fgProp(cfg, slot) {
    // With `image` set, this renders a real <img> — still swayable, still
    // positionable, and still cropped by `clipPath` if you supply one
    // (omit clipPath for a plain rectangular cutout). Without `image` it
    // falls back to the original solid-color silhouette div.
    const el = cfg.image ? document.createElement('img') : document.createElement('div');
    el.className = 'layer-fg-prop';
    if (cfg.image) {
      el.src = cfg.image;
      el.alt = cfg.imageAlt || '';
      if (cfg.clipPath) el.style.clipPath = cfg.clipPath;
    } else {
      el.style.background = cfg.color || '#050607';
      el.style.clipPath = cfg.clipPath || 'polygon(0 100%, 0 0, 100% 0, 100% 100%)';
    }
    el.style[cfg.side === 'right' ? 'right' : 'left'] = cfg.offset ?? '-6%';
    if (cfg.width) el.style.width = cfg.width;
    if (cfg.height) el.style.height = cfg.height;
    if (cfg.bottom) el.style.bottom = cfg.bottom;
    if (cfg.opacity != null) el.style.opacity = cfg.opacity;
    // Per-prop sway override — falls back to the global --sway-* values on
    // :root (via CSS cascade) if these aren't given, so two fgProps can
    // sway at different rates/amplitudes without touching the shared vars.
    if (cfg.swayDeg != null) el.style.setProperty('--sway-deg', cfg.swayDeg + 'deg');
    if (cfg.swayPx != null) el.style.setProperty('--sway-px', cfg.swayPx + 'px');
    if (cfg.swayDurationSec != null) el.style.animationDuration = cfg.swayDurationSec + 's';
    slot.appendChild(el);
  },
};
const LAYER_SLOT = { backdrop: 'layer-background', rain: 'layer-background', fgProp: 'layer-foreground' };

/* ============================================================================
   ENGINE — reads CONFIG + the three registries above. Shouldn't need edits
   for typical use.
   ============================================================================ */
function setRange(el, win) {
  el.style.animationRangeStart = win.start + '%';
  el.style.animationRangeEnd = win.end + '%';
}

  /* ============================================================================
     init(userConfig) — call this once with your CONFIG object. Injects the
     engine's CSS + DOM skeleton (if not already present), then builds every
     panel, layer, and UI control from CONFIG.
     ============================================================================ */
  function init(userConfig) {
    CONFIG = userConfig;
    injectStyles();
    injectSkeleton();

      const root = document.documentElement;
      const body = document.body;

      // theme + motion custom properties
      root.style.setProperty('--bg', CONFIG.theme.background);
      root.style.setProperty('--ink', CONFIG.theme.ink);
      root.style.setProperty('--accent', CONFIG.theme.accent);
      root.style.setProperty('--dim', CONFIG.theme.dim);
      root.style.setProperty('--font-family', CONFIG.theme.fontFamily);
      root.style.setProperty('--perspective', CONFIG.scene.perspective + 'px');
      root.style.setProperty('--panel-width', CONFIG.scene.panelWidth + 'px');
      root.style.setProperty('--sway-deg', CONFIG.sway.amplitudeDeg + 'deg');
      root.style.setProperty('--sway-px', CONFIG.sway.amplitudePx + 'px');
      root.style.setProperty('--sway-duration', CONFIG.sway.durationSec + 's');
      root.style.setProperty('--section-gap', CONFIG.scene.sectionGapVh + 'vh');

      body.classList.toggle('no-sway', !CONFIG.sway.enabled);
      body.classList.toggle('no-text-drift', !CONFIG.ui.textDrift);
      body.classList.toggle('no-progress-bar', !CONFIG.ui.progressBar);
      body.classList.toggle('no-chapter-nav', !CONFIG.ui.chapterNav);
      body.classList.toggle('no-fullscreen-toggle', !CONFIG.ui.fullscreenToggle);
      body.classList.toggle('no-scroll-hint', !CONFIG.ui.scrollHint);

      // ---- depth for every panel (auto-space honoring explicit overrides) ----
      // A panel's slot size scales with how much content it holds — a 'scroll'
      // panel with 5 sections needs roughly 5x the timeline room of a single
      // fade panel, so it gets 5x the depth step, keeping pacing proportional
      // to content regardless of how many top-level panels you write.
      //
      // `boundaries` records the cursor BEFORE and after each panel is placed,
      // so boundaries[i] -> boundaries[i+1] is exactly the depth range reserved
      // for panel i. This matters: it's the fix for fade panels that used to
      // fade in too early, mid-way through the previous scroll panel's crawl.
      // The old code sized a panel's reveal window off the gap between its own
      // peak and its NEIGHBORS' peaks — fine when every panel is the same size,
      // but wrong the moment a small fade panel sits right after a big
      // multi-section scroll panel: the gap on the "previous" side collapsed to
      // just the fade panel's own (small) slot, so its window shrank and
      // clustered right on top of the still-crawling scroll panel. Sizing off
      // each panel's OWN reserved slot (below) removes that dependency on
      // neighbor size entirely.
      let cursor = 0;
      const boundaries = [0];
      CONFIG.panels.forEach(p => {
        if (p.z != null) { cursor = -Math.abs(p.z); }
        else {
          const slots = p.sections ? p.sections.length : 1;
          cursor -= CONFIG.scene.depthPerPanel * Math.max(1, slots);
        }
        boundaries.push(cursor);
      });
      const depths = boundaries.slice(1); // end-of-slot depth for each panel (kept for --z / total-depth)
      const totalDepth = Math.abs(Math.min(...depths)) + CONFIG.scene.depthPerPanel;
      root.style.setProperty('--total-depth', totalDepth + 'px');

      // The camera's Z position is linear in scroll %. Given how far along
      // the depth budget a point sits (f = -z/totalDepth), find the scroll %
      // at which the camera actually reaches it, so panel timing matches
      // camera timing.
      function depthToScrollPercent(f) {
        return Math.min(1, Math.max(0, f));
      }
      const depthToPct = z => depthToScrollPercent(-z / totalDepth) * 100;

      // Each panel's own reserved slot, converted to scroll %, plus its center
      // — the center (not the far edge) is what the panel's 3D --z position and
      // "peak" now use, so the moment it's spatially in focus lines up with the
      // middle of its own reveal window instead of the edge of the next one.
      const slotStartPct = boundaries.slice(0, -1).map(depthToPct);
      const slotEndPct = boundaries.slice(1).map(depthToPct);
      const centerDepths = CONFIG.panels.map((_, i) => (boundaries[i] + boundaries[i + 1]) / 2);
      const centerPcts = centerDepths.map(depthToPct);

      // ---- fade window per panel: 'auto' sizes it to that panel's own slot ----
      // Special case: panel 0 always starts its window at 0%. The eased camera
      // curve (see @keyframes fly-through) barely moves during the first slice
      // of scroll by design (slow start) — if the first panel's window also
      // waited to start partway in, you'd get a stretch of scrolling where
      // NOTHING is visible yet. Starting at 0% means the very first panel is
      // already fading in from the top of the page.
      function windowFor(i) {
        const explicit = CONFIG.panels[i].fadeWindowPercent;
        let win;
        if (typeof explicit === 'number') {
          win = { start: Math.max(0, centerPcts[i] - explicit), end: Math.min(100, centerPcts[i] + explicit) };
        } else if (CONFIG.scene.fadeWindowPercent !== 'auto') {
          const half = CONFIG.scene.fadeWindowPercent;
          win = { start: Math.max(0, centerPcts[i] - half), end: Math.min(100, centerPcts[i] + half) };
        } else {
          // auto: half-window = crossfadeFactor x this panel's OWN slot width.
          // crossfadeFactor 0.5 means the window exactly matches the reserved
          // slot (no overlap with neighbors); >0.5 lets it bleed slightly past
          // the boundary on each side for a softer crossfade. Either way the
          // window scales with THIS panel's own content, never a neighbor's.
          //
          // IMPORTANT: no artificial minimum here. An earlier version floored
          // this at 6 percentage points "so tiny panels don't get a sliver of
          // window" — but several real panels (a one-line beat wedged between
          // a title card and a scroll panel, or several short panels stacked
          // near the end of the timeline) legitimately own only 2-4% of the
          // scroll. Flooring their half-window at 6 blew that up to 12%+,
          // which is what caused chapter titles and neighboring beats to sit
          // on screen simultaneously ("text behind/in front of it"). Let the
          // window follow the panel's actual reserved room; a slot can never
          // be zero-width by construction, so no floor is needed.
          const slotWidth = slotEndPct[i] - slotStartPct[i];
          const half = slotWidth * CONFIG.scene.crossfadeFactor;
          win = { start: Math.max(0, centerPcts[i] - half), end: Math.min(100, centerPcts[i] + half) };
        }
        if (i === 0) win.start = 0;
        if (i === CONFIG.panels.length - 1) win.end = 100;
        return win;
      }

      // ---- build panel DOM, apply behavior, collect effects ----
      const camera = document.getElementById('camera');
      const chapterTargets = [];
      const effectTriggers = []; // flat list of { pct, name }, checked against scroll position later
      const typewriterPanels = []; // { el, text, win } — needs a live scroll listener, see below

      const ctx = {
        registerEffect(name, pct) { effectTriggers.push({ pct, name }); },
        registerChapter(peakPct, label) { chapterTargets.push({ pct: peakPct, label }); },
        registerTypewriter(el, text, win) { typewriterPanels.push({ el, text, win }); },
      };

      CONFIG.panels.forEach((p, i) => {
        const win = { ...windowFor(i), peak: centerPcts[i] };

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.style.setProperty('--z', centerDepths[i] + 'px');
        camera.appendChild(panel);

        const inner = document.createElement('div');
        inner.className = 'panel-inner';
        panel.appendChild(inner);

        const behaviorFn = PANEL_BEHAVIORS[p.behavior] || PANEL_BEHAVIORS.fade;
        behaviorFn(panel, inner, win, p, ctx);

        // Panel-level effects/chapter (for simple panels without a sections
        // array — 'scroll' panels with sections register their own, per
        // section). Trigger point is win.start — the moment this panel starts
        // becoming visible, same "gets on screen" rule the section-level
        // trigger uses.
        (p.effects || []).forEach(name => ctx.registerEffect(name, win.start));
        if (p.type === 'title' || p.chapter) {
          ctx.registerChapter(win.peak, p.text || (p.sections && p.sections[0] && p.sections[0].text) || 'Chapter');
        }
      });

      // ---- scroll length ----
      function sizeSceneWrapper() {
        document.querySelector('.scene-wrapper').style.height =
          (totalDepth * CONFIG.scene.scrollPxPerDepthUnit + window.innerHeight) + 'px';
      }
      sizeSceneWrapper();
      window.addEventListener('resize', sizeSceneWrapper);

      // ---- scroll-position-driven updates: effect triggers + typewriter ----
      // One rAF-throttled scroll listener computing scroll % once and feeding
      // both consumers, rather than each maintaining its own listener. Runs
      // after sizeSceneWrapper() above so the very first computed percentage
      // (used for the initial paint call below) is accurate — scrollHeight
      // wouldn't reflect the real document length yet if this ran earlier.
      //   effectTriggers   fire once when scroll crosses a trigger point (see
      //                    PANEL_EFFECTS above) — sorted purely for
      //                    readability when debugging, lookup doesn't depend
      //                    on order. Crossing is checked in either scroll
      //                    direction, so scrolling back up past a trigger
      //                    fires it again too.
      //   typewriterPanels get their character count updated continuously
      //                    based on progress through their own [win.start,
      //                    win.end] window — this one DOES care about
      //                    absolute scroll position, not just crossings,
      //                    since "how many characters so far" needs to track
      //                    scroll position the whole time you're inside the
      //                    panel's window, not just at the moment you enter it.
      effectTriggers.sort((a, b) => a.pct - b.pct);
      let lastScrollPct = 0;
      let scrollTickScheduled = false;
      function updateTypewriters(pct) {
        typewriterPanels.forEach(({ el, text, win }) => {
          const span = win.end - win.start;
          // Type across [REVEAL_START, REVEAL_END] of the window, not the
          // whole thing — see TYPEWRITER_REVEAL_START/END above for why.
          const typeStart = win.start + span * TYPEWRITER_REVEAL_START;
          const typeEnd = win.start + span * TYPEWRITER_REVEAL_END;
          const progress = typeEnd > typeStart
            ? Math.max(0, Math.min(1, (pct - typeStart) / (typeEnd - typeStart)))
            : 1;
          const shown = text.slice(0, Math.round(progress * text.length));
          if (el.textContent !== shown) el.textContent = shown;
        });
      }
      function onScrollTick() {
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        const pct = scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0;
        const lo = Math.min(lastScrollPct, pct), hi = Math.max(lastScrollPct, pct);
        effectTriggers.forEach(t => {
          if (t.pct > lo && t.pct <= hi && PANEL_EFFECTS[t.name]) PANEL_EFFECTS[t.name]();
        });
        if (typewriterPanels.length) updateTypewriters(pct);
        lastScrollPct = pct;
        scrollTickScheduled = false;
      }
      if (effectTriggers.length || typewriterPanels.length) {
        window.addEventListener('scroll', () => {
          if (scrollTickScheduled) return;
          scrollTickScheduled = true;
          requestAnimationFrame(onScrollTick);
        });
        onScrollTick(); // initial paint, so a typewriter panel isn't blank-then-jumps on first scroll
      }

      // ---- layers ----
      const bgSlot = document.getElementById('layer-background');
      const fgSlot = document.getElementById('layer-foreground');
      CONFIG.layers.forEach(layerCfg => {
        const renderer = LAYER_RENDERERS[layerCfg.type];
        if (!renderer) { console.warn('Unknown layer type:', layerCfg.type); return; }
        const slot = LAYER_SLOT[layerCfg.type] === 'layer-foreground' ? fgSlot : bgSlot;
        renderer(layerCfg, slot);
      });

      // ---- chapter nav ----
      const nav = document.getElementById('chapter-nav');
      chapterTargets.forEach((ch, i) => {
        const a = document.createElement('a');
        a.href = '#'; a.title = ch.label; a.textContent = String(i + 1);
        if (i === 0) a.classList.add('active');
        a.addEventListener('click', e => {
          e.preventDefault();
          const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo({ top: (ch.pct / 100) * scrollHeight, behavior: 'smooth' });
        });
        nav.appendChild(a);
      });
      if (chapterTargets.length) {
        window.addEventListener('scroll', () => {
          const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
          const progressPct = scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0;
          let activeIndex = 0;
          chapterTargets.forEach((ch, i) => { if (progressPct >= ch.pct - 2) activeIndex = i; });
          nav.querySelectorAll('a').forEach((a, i) => a.classList.toggle('active', i === activeIndex));
        });
      }

      // ---- fullscreen toggle ----
      document.getElementById('full-screen')?.addEventListener('change', e => {
        e.target.checked ? document.documentElement.requestFullscreen?.() : document.exitFullscreen?.();
      });

      // ---- hide scroll hint after first scroll ----
      window.addEventListener('scroll', () => {
        const hint = document.getElementById('scroll-hint');
        if (hint && window.scrollY > 50) hint.style.opacity = '0';
      }, { once: true });
  }

  global.Scrollytelling = {
    init,
    PANEL_BEHAVIORS,
    PANEL_EFFECTS,
    LAYER_RENDERERS,
    LAYER_SLOT,
  };
})(window);