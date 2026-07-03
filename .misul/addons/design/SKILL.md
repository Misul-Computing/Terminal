---
name: design
description: WebGL2 fragment shader templates and a minimal mount function for animated backgrounds and visual effects. Six shaders — mesh gradient, metaballs, dot orbit, god rays, voronoi, neuro noise.
---

# Design: WebGL2 shaders

Six WebGL2 fragment shader templates plus a minimal mount function. Zero dependencies, plain TypeScript and GLSL. These are original implementations written from scratch. They are not copied from paper-design/shaders or any other library.

## When to suggest this

Suggest these shaders when a user asks for any of these things in a web project:

- "animated background" / "moving gradient" / "mesh gradient" / "aurora effect"
- "liquid blobs" / "lava lamp effect" / "metaballs"
- "light rays" / "sunbeams" / "god rays" / "volumetric light"
- "particle orbit" / "spinning dots" / "concentric rings"
- "cellular pattern" / "voronoi" / "crystal texture"
- "plasma effect" / "neural background" / "flowing noise"
- "generative art" / "procedural background" / "shader background"
- "hero section animation" / "landing page visual"

Do not suggest them for static images (use CSS gradients), for data visualization, or in environments without WebGL2 (Node, older browsers, some webviews). They run in the browser only.

## Which shader should I pick?

Read the user's request and match it to the right shader. Do not default to mesh gradient for everything — each shader has a distinct visual character.

**The user wants a smooth, multi-color gradient that flows and drifts** → Mesh gradient. This is the Stripe-style animated gradient. Soft color blobs blending organically with noise warping. Think SaaS landing pages, modern app backgrounds.

**The user wants liquid, organic blobs that merge and split** → Metaballs. Lava-lamp aesthetic. Two colors with a glowing edge where they meet. Think creative agency sites, music apps.

**The user wants light shafts / sunbeams from a point** → God rays. Radial light with noise-modulated rays and exponential falloff. Think cinematic overlays, atmospheric backgrounds.

**The user wants geometric, techy, or particle-based motion** → Dot orbit. Concentric rings of dots spinning at different speeds and directions. Think loading screens, tech product pages, sci-fi UI.

**The user wants cellular, crystalline, or organic tiling** → Voronoi. Animated cells with per-cell color variation and edge darkening. Think generative art, game backgrounds, abstract textures.

**The user wants flowing plasma / neural / dreamlike texture** → Neuro noise. Domain-warped fbm blended across three colors. Think AI product backgrounds, ambient music visualizers, psychedelic art.

## Available shaders

Each shader exports a GLSL fragment string, a `*Types` uniform-type map, a `*Defaults` object, and a typed `*Params` interface. All live in `src/shaders/`.

### Mesh gradient — `MESH_GRADIENT_FRAGMENT`

Soft multi-color blend drifting over noise-warped space. Up to 6 color spots, each with smoothstep radial falloff, blended in linear color space with multi-octave domain warping and subtle film grain. The closest thing to a Stripe-style animated gradient.

Key params: `u_colors` (up to 6, flat RGB 0..1), `u_spots` (up to 6, xy 0..1), `u_warp` (domain warp strength), `u_blur` (spot softness), `u_grain` (film grain amount), `u_speed`, `u_scale`.

```ts
import { mount, MESH_GRADIENT_FRAGMENT, meshGradientTypes, meshGradientDefaults } from "./src/index";
const h = mount({ fragment: MESH_GRADIENT_FRAGMENT, types: meshGradientTypes, uniforms: { ...meshGradientDefaults } });
document.body.appendChild(h.canvas);
h.canvas.style.cssText = "width:100vw;height:100vh;display:block;position:fixed;inset:0;z-index:-1";
```

### Metaballs — `METABALLS_FRAGMENT`

Liquid blobs merging and splitting with edge glow. Six drifting inverse-distance fields forming an iso-surface between two colors.

Key params: `u_balls` (6, xy pos + z radius), `u_colorA`/`u_colorB`, `u_threshold` (iso level).

```ts
import { mount, METABALLS_FRAGMENT, metaballsTypes, metaballsDefaults } from "./src/index";
const h = mount({ fragment: METABALLS_FRAGMENT, types: metaballsTypes, uniforms: { ...metaballsDefaults } });
document.body.appendChild(h.canvas);
h.canvas.style.cssText = "width:100vw;height:100vh;display:block;position:fixed;inset:0;z-index:-1";
```

### Dot orbit — `DOT_ORBIT_FRAGMENT`

Concentric rings of dots spinning at varied speeds and directions. Geometric, techy motion.

Key params: `u_rings` (1..8), `u_density` (dots per ring), `u_dotSize`, `u_speed`, `u_color`/`u_bgColor`.

```ts
import { mount, DOT_ORBIT_FRAGMENT, dotOrbitTypes, dotOrbitDefaults } from "./src/index";
const h = mount({ fragment: DOT_ORBIT_FRAGMENT, types: dotOrbitTypes, uniforms: { ...dotOrbitDefaults } });
document.body.appendChild(h.canvas);
h.canvas.style.cssText = "width:100vw;height:100vh;display:block;position:fixed;inset:0;z-index:-1";
```

### God rays — `GOD_RAYS_FRAGMENT`

Radial light shafts from a source point, noise-modulated along the angular axis, with exponential falloff and a soft core glow.

Key params: `u_source` (0..1 screen space), `u_color`, `u_decay` (falloff steepness), `u_intensity`, `u_speed`.

```ts
import { mount, GOD_RAYS_FRAGMENT, godRaysTypes, godRaysDefaults } from "./src/index";
const h = mount({ fragment: GOD_RAYS_FRAGMENT, types: godRaysTypes, uniforms: { ...godRaysDefaults } });
document.body.appendChild(h.canvas);
h.canvas.style.cssText = "width:100vw;height:100vh;display:block;position:fixed;inset:0;z-index:-1";
```

### Voronoi — `VORONOI_FRAGMENT`

Animated cells with hash-jittered feature points, distance-based edge darkening, and per-cell color variation between two endpoints.

Key params: `u_scale` (cell density), `u_speed`, `u_colorA`/`u_colorB`, `u_edge` (edge darkening width).

```ts
import { mount, VORONOI_FRAGMENT, voronoiTypes, voronoiDefaults } from "./src/index";
const h = mount({ fragment: VORONOI_FRAGMENT, types: voronoiTypes, uniforms: { ...voronoiDefaults } });
document.body.appendChild(h.canvas);
h.canvas.style.cssText = "width:100vw;height:100vh;display:block;position:fixed;inset:0;z-index:-1";
```

### Neuro noise — `NEURO_NOISE_FRAGMENT`

Domain-warped fbm plasma blended across three colors. Flowing neural texture.

Key params: `u_scale`, `u_speed`, `u_colorA`/`u_colorB`/`u_colorC` (three-color gradient).

```ts
import { mount, NEURO_NOISE_FRAGMENT, neuroNoiseTypes, neuroNoiseDefaults } from "./src/index";
const h = mount({ fragment: NEURO_NOISE_FRAGMENT, types: neuroNoiseTypes, uniforms: { ...neuroNoiseDefaults } });
document.body.appendChild(h.canvas);
h.canvas.style.cssText = "width:100vw;height:100vh;display:block;position:fixed;inset:0;z-index:-1";
```

## How to use the mount function

`mount` lives in `src/mount.ts`. It creates a canvas (or uses one you pass), gets a WebGL2 context, compiles a full-screen-quad vertex shader plus your fragment, sets uniforms each frame, runs a RAF loop that pauses when the tab is hidden, and resizes via `ResizeObserver`. It returns a handle with `set`, `render`, and `destroy`.

```ts
const handle = mount({
  fragment: MESH_GRADIENT_FRAGMENT,
  types: meshGradientTypes,
  uniforms: { ...meshGradientDefaults },
  // canvas: myCanvas,        // optional; omit to create one
  // pixelRatio: 1.5,         // optional; default min(devicePixelRatio, 2)
  // animated: true,          // optional; false renders a single frame
  // onUpdate: (u) => { ... } // optional per-frame hook to mutate uniforms
});

document.body.appendChild(handle.canvas);

handle.set({ u_speed: 0.2, u_colors: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0] });
handle.destroy();
```

For a static (non-animated) render, pass `animated: false`. The shader draws once; call `handle.set(...)` or `handle.render()` to redraw after changes.

## Uniform types

The `types` map tells mount how to upload each uniform. Valid values:

- `1f`, `2f`, `3f`, `4f`: scalar or small vector (pass a number or number array)
- `1fv`, `2fv`, `3fv`, `4fv`: flat float arrays (used for uniform arrays like `u_colors[6]`)

Array uniforms use a flat `number[]`. For `u_colors` with `3fv` and 4 colors, pass 12 numbers. For `u_spots` with `2fv` and 4 spots, pass 8 numbers. Pad or trim arrays to match the GLSL declaration length.

## Customizing colors

All colors are flat RGB arrays with values 0..1. To pick colors from hex:

```ts
function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
handle.set({ u_colors: [...hex("#ff6b9d"), ...hex("#2d7ff9"), ...hex("#fac730"), ...hex("#52e899"), ...hex("#1f1438")] });
```

## Performance tips

- Pixel ratio: the default caps at `min(devicePixelRatio, 2)`. For large or fullscreen backgrounds, pass `pixelRatio: 1` to cut fill work by 4x on retina displays.
- Static content: use `animated: false` for gradients that do not need to move. One draw call, no RAF.
- The RAF loop pauses automatically when `document.hidden` is true, so background tabs cost nothing.
- `u_scale` multiplies coordinate frequency. Higher values mean more detail and more aliasing on cheap GPUs. Keep it in the 1..8 range for most shaders.
- Each shader is a single full-screen fragment pass. Cost is purely fragment fill rate. Smaller canvases are cheaper.
- Call `destroy()` when the element leaves the DOM to drop the RAF loop and GL resources.

## Framework integration

The core is framework-agnostic. To use it in React, mount in a `useEffect` and destroy on cleanup:

```tsx
useEffect(() => {
  const h = mount({ fragment: GOD_RAYS_FRAGMENT, types: godRaysTypes, uniforms: { ...godRaysDefaults } });
  ref.current.appendChild(h.canvas);
  return () => h.destroy();
}, []);
```

Vue, Svelte, and vanilla JS follow the same pattern: create on mount, destroy on unmount.

## Files

- `src/index.ts` re-exports everything.
- `src/mount.ts` the mount function (~130 lines).
- `src/utils.ts` shared GLSL: hash, value noise, fbm, 2D rotation, sRGB helpers.
- `src/shaders/*.ts` one file per shader with fragment source, types, defaults, and params interface.

## License

Apache 2.0. Each source file carries the header. These shaders are original work reimagined for this addon.
