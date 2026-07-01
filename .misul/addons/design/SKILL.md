---
name: design
description: WebGL2 fragment shader templates and a minimal mount function for animated backgrounds and visual effects.
---

# Design: WebGL2 shaders

Reimagined WebGL2 fragment shader templates plus a minimal mount function. Six shaders, zero dependencies, plain TypeScript and GLSL. These are original implementations written from scratch. They are not copied from paper-design/shaders or any other library.

## When to suggest this

Reach for these shaders when a web project needs:

- Animated backgrounds (landing pages, hero sections, splash screens)
- Generative texture or atmosphere behind UI
- Visual effects for canvas overlays (god rays, plasma, organic blobs)
- Procedural color fields that react to time or input

Do not suggest them for static images (use CSS gradients), for data visualization, or in environments without WebGL2 (Node, older browsers, some webviews). They run in the browser only.

## Available shaders

Each shader exports a GLSL fragment string, a `*Types` uniform-type map, a `*Defaults` object, and a typed `*Params` interface. All live in `src/shaders/`.

| Shader | Export prefix | Key params | Look |
|---|---|---|---|
| Mesh gradient | `MESH_GRADIENT` | `u_colors` (up to 6, flat RGB 0..1), `u_spots`, `u_warp`, `u_scale` | Soft multi-color blend drifting over noise-warped space |
| Metaballs | `METABALLS` | `u_balls` (6, xy pos + z radius), `u_colorA`/`u_colorB`, `u_threshold` | Liquid blobs merging and splitting with edge glow |
| Dot orbit | `DOT_ORBIT` | `u_rings` (1..8), `u_density`, `u_dotSize`, `u_speed` | Concentric rings of dots spinning at varied speeds |
| God rays | `GOD_RAYS` | `u_source` (0..1), `u_color`, `u_decay`, `u_intensity` | Radial light shafts from a point, noise-modulated |
| Voronoi | `VORONOI` | `u_scale`, `u_speed`, `u_colorA`/`u_colorB`, `u_edge` | Animated cells with per-cell color and edge darkening |
| Neuro noise | `NEURO_NOISE` | `u_scale`, `u_speed`, three colors | Domain-warped fbm plasma, flowing neural texture |

Common uniforms handled automatically by mount: `u_time` (seconds), `u_resolution` (drawing buffer px), `u_pixelRatio`.

## How to use the mount function

`mount` lives in `src/mount.ts`. It creates a canvas (or uses one you pass), gets a WebGL2 context, compiles a full-screen-quad vertex shader plus your fragment, sets uniforms each frame, runs a RAF loop that pauses when the tab is hidden, and resizes via `ResizeObserver`. It returns a handle with `set`, `render`, and `destroy`.

```ts
import {
  mount,
  MESH_GRADIENT_FRAGMENT,
  meshGradientTypes,
  meshGradientDefaults,
} from "./src/index";

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
handle.canvas.style.width = "100vw";
handle.canvas.style.height = "100vh";
handle.canvas.style.display = "block";

// Change uniforms at any time:
handle.set({ u_speed: 0.2, u_colors: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0] });

// Stop and clean up:
handle.destroy();
```

For a static (non-animated) render, pass `animated: false`. The shader draws once; call `handle.set(...)` or `handle.render()` to redraw after changes.

## Uniform types

The `types` map tells mount how to upload each uniform. Valid values:

- `1f`, `2f`, `3f`, `4f`: scalar or small vector (pass a number or number array)
- `1fv`, `2fv`, `3fv`, `4fv`: flat float arrays (used for uniform arrays like `u_colors[6]`)

Array uniforms use a flat `number[]`. For `u_colors` with `3fv` and 4 colors, pass 12 numbers. For `u_spots` with `2fv` and 4 spots, pass 8 numbers. Pad or trim arrays to match the GLSL declaration length.

## Performance tips

- Pixel ratio: the default caps at `min(devicePixelRatio, 2)`. For large or fullscreen backgrounds, pass `pixelRatio: 1` to cut fill work by 4x on retina displays.
- Static content: use `animated: false` for gradients that do not need to move. One draw call, no RAF.
- The RAF loop pauses automatically when `document.hidden` is true, so background tabs cost nothing.
- `u_scale` multiplies coordinate frequency. Higher values mean more detail and more aliasing on cheap GPUs. Keep it in the 2..8 range for most shaders.
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
