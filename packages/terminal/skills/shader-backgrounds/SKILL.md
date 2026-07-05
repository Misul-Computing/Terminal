---
name: shader-backgrounds
description: WebGL2 shader backgrounds for web pages using @paper-design/shaders. Use when the user asks for animated backgrounds, gradient effects, shader textures, or visual effects on web pages. Covers React and vanilla JS usage, shader selection, and performance.
---

# Shader Backgrounds (Paper Shaders)

> Zero-dependency WebGL2 canvas shaders from [Paper Shaders](https://shaders.paper.design).
> Install via npm, use as React components or vanilla JS classes.
> Licensed under Apache 2.0 — no visible attribution required in products.

## When to Use This Skill

- User asks for an "animated background", "shader background", "gradient effect"
- User wants a hero section with a visual effect (mesh gradient, god rays, metaballs)
- User wants texture or atmosphere on a web page (noise, grain, dithering)
- User mentions specific shader names (voronoi, perlin, simplex, etc.)

## When NOT to Use

- Static CSS gradients (use CSS instead — no WebGL needed)
- Data visualization (use a charting library)
- Mobile-only targets where WebGL2 may not be available (check Safari 15+)
- Pages where every millisecond of load time matters (shaders add a canvas + GPU work)

---

## Installation

### React

```bash
npm install @paper-design/shaders-react
```

### Vanilla JS

```bash
npm install @paper-design/shaders
```

> **Pin the version.** Paper Shaders ships breaking changes under `0.0.x` semver.
> Use `npm install @paper-design/shaders-react@0.0.x` with an exact pin.

---

## Shader Catalog

### Animated Backgrounds (most common for hero sections)

| Component | Description | Best for |
|-----------|-------------|----------|
| `MeshGradient` | Flowing color spots with organic distortion | Hero backgrounds, SaaS landing pages |
| `StaticMeshGradient` | Non-animated mesh gradient (lighter) | Static hero backgrounds, wallpapers |
| `GodRays` | Rays of light radiating from center, up to 5 colors | Dramatic backgrounds, logo reveals, VFX |
| `Metaballs` | Gooey colored balls merging into organic shapes | Playful backgrounds, creative sites |
| `NeuroNoise` | Glowing web-like structure of fluid lines | Atmospheric, futuristic visuals |
| `SmokeRing` | Radial gradient with layered noise, smoky aesthetic | Subtle atmospheric backgrounds |
| `DotOrbit` | Multi-color dots orbiting cell centers (up to 40 colors) | Playful, dynamic UI textures |
| `DotGrid` | Static grid of circles/diamonds/squares/triangles | Subtle texture, grid patterns |
| `Spiral` | Animated spiral morphing across shapes | Abstract motion, hypnotic effects |
| `Swirl` | Color bands twisting into spirals and arcs | Flowing circular patterns |
| `Voronoi` | Anti-aliased Voronoi pattern with smooth edges | Organic cellular textures |
| `Waves` | Line pattern from zigzags to smooth waves | Texture, decorative dividers |
| `Warp` | Color fields warped by noise over base patterns | Fluid, smoky, marbled effects |
| `ColorPanels` | Glowing translucent 3D panels rotating | Modern, dimensional backgrounds |
| `PulsingBorder` | Luminous color trails forming a glowing contour | Border effects, frame highlights |

### Noise & Texture

| Component | Description | Best for |
|-----------|-------------|----------|
| `PerlinNoise` | Classic 3D Perlin noise with controls | Organic textures, base noise |
| `SimplexNoise` | Multi-color gradient on animated Simplex curves | Smooth gradient textures |
| `GrainGradient` | Multi-color gradients with grainy noise (7 forms) | Textured gradient backgrounds |
| `Dithering` | 2-color dithering with multiple pattern sources | Retro, print-like, stylized UI |
| `StaticRadialGradient` | Radial gradient, up to 10 colors, advanced mixing | Static radial backgrounds |

### Image Filters (require an input image)

| Component | Description | Best for |
|-----------|-------------|----------|
| `PaperTexture` | Multi-layer noise texture, paper/cardboard surface | Paper aesthetics, texture overlay |
| `Water` | Water surface distortion with caustic realism | Water effects on images |
| `FlutedGlass` | Streaked, ribbed glass distortion | Privacy/glass effects |
| `HalftoneDots` | Halftone-dot filter with custom grids and palettes | Print-style, comic effects |
| `HalftoneCmyk` | CMYK halftone printing with per-channel ink colors | CMYK print simulation |
| `ImageDithering` | Dithering filter with 4 modes and multiple palettes | Retro image effects |
| `Heatmap` | Glowing gradient flowing through a shape | Thermal/intensity visualization |
| `LiquidMetal` | Futuristic liquid metal on a logo or shape | Metallic logo effects |
| `GemSmoke` | Fluid smoke shape behind an image | Gem/jewelry visual effects |

---

## React Usage

```jsx
import { MeshGradient, DotOrbit, GodRays } from '@paper-design/shaders-react';

// Mesh gradient hero background
<MeshGradient
  colors={['#5100ff', '#00ff80', '#ffcc00', '#ea00ff']}
  distortion={1}
  swirl={0.8}
  speed={0.2}
  style={{ width: '100%', height: '400px' }}
/>

// Dot orbit pattern
<DotOrbit
  colors={['#d2822d', '#0c3b7e', '#b31a57', '#37a066']}
  colorBack={'#000000'}
  scale={0.3}
  speed={0.2}
  style={{ width: '100%', height: '300px' }}
/>

// God rays for a dramatic hero
<GodRays
  colors={['#ff6b35', '#f7c59f', '#efefd0']}
  raySize={0.5}
  rayDensity={0.5}
  speed={0.3}
  style={{ width: '100%', height: '500px' }}
/>
```

### Common props (all shader components)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `speed` | number | 0.2 | Animation speed. `0` = static, `1` = frame is timestamp in ms |
| `frame` | number | 0 | Starting animation frame. With `speed=0`, defines static state |
| `scale` | number | 1 | Zoom level (0.01–4) |
| `rotation` | number | 0 | Rotation angle (0–360) |
| `offsetX` | number | 0 | Horizontal offset (-1 to 1) |
| `offsetY` | number | 0 | Vertical offset (-1 to 1) |
| `style` | CSSProperties | — | Standard React style prop (width, height, position, etc.) |
| `className` | string | — | CSS class name |
| `fit` | 'contain' \| 'cover' | 'contain' | How shader fits the canvas |

### Full-bleed hero background pattern

```jsx
import { MeshGradient } from '@paper-design/shaders-react';

function Hero() {
  return (
    <section style={{ position: 'relative', minHeight: '100vh' }}>
      <MeshGradient
        colors={['#1a0033', '#3d0066', '#660099', '#9900cc']}
        distortion={0.6}
        swirl={0.4}
        speed={0.1}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}>
        <h1>Content over shader</h1>
      </div>
    </section>
  );
}
```

---

## Vanilla JS Usage

```javascript
import {
  ShaderMount,
  meshGradientFragmentShader,
  getShaderColorFromString,
  ShaderFitOptions,
  defaultObjectSizing
} from '@paper-design/shaders';

const uniforms = {
  u_colors: ['#5100ff', '#00ff80', '#ffcc00', '#ea00ff'].map(getShaderColorFromString),
  u_colorsCount: 4,
  u_distortion: 1,
  u_swirl: 0.8,
  u_grainMixer: 0,
  u_grainOverlay: 0,
  u_fit: ShaderFitOptions[defaultObjectSizing.fit],
  u_rotation: 0,
  u_scale: 1,
  u_offsetX: 0,
  u_offsetY: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_worldWidth: 1000,
  u_worldHeight: 1000,
};

const shader = new ShaderMount(
  document.getElementById('shader-container'),
  meshGradientFragmentShader,
  uniforms,
  {},    // WebGL context attributes
  0.2,   // speed
  0      // starting frame
);

// Stop when done
shader.destroy();
```

---

## Performance Notes

- **All shaders require WebGL2.** Browser support: Chrome 56+, Firefox 51+, Safari 15+, Edge 79+.
- **Animate only `transform` and `opacity`** on shader containers — the shader handles its own canvas animation internally.
- **`speed={0}` makes any shader static** — useful for reducing GPU load on pages that don't need motion.
- **Use `position: absolute` or `fixed`** for full-bleed backgrounds so the shader canvas doesn't affect layout.
- **Set explicit width/height** on the container — the canvas fills its parent.
- **Destroy shader instances** when components unmount (vanilla JS) to free GPU memory. React components handle this automatically.
- **Prefer `StaticMeshGradient` over `MeshGradient`** when animation isn't needed — it's lighter.
- **Respect `prefers-reduced-motion`**: set `speed={0}` when the user has reduced motion enabled.

```jsx
import { MeshGradient } from '@paper-design/shaders-react';

function ReducedMotionMeshGradient(props) {
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return <MeshGradient {...props} speed={prefersReducedMotion ? 0 : props.speed} />;
}
```

---

## Shader Selection Guide

| User wants | Recommend |
|------------|-----------|
| "Animated gradient background" | `MeshGradient` or `GrainGradient` |
| "Subtle texture, not too flashy" | `StaticMeshGradient`, `DotGrid`, or `PerlinNoise` with low speed |
| "Dramatic, eye-catching hero" | `GodRays`, `Metaballs`, or `NeuroNoise` |
| "Playful, fun background" | `DotOrbit`, `ColorPanels` |
| "Organic, natural feel" | `Voronoi`, `SmokeRing`, `Metaballs` |
| "Retro / print aesthetic" | `Dithering`, `HalftoneDots`, `HalftoneCmyk` |
| "Tech / futuristic" | `NeuroNoise`, `Warp`, `LiquidMetal` |
| "Smooth, calm, meditative" | `SmokeRing`, `SimplexNoise`, `Waves` |
| "Border / frame effect" | `PulsingBorder` |
| "Image with effect" | `Water`, `FlutedGlass`, `Heatmap`, `PaperTexture` |

---

## Presets

Many shaders ship with preset configurations:

```jsx
import { MeshGradient, meshGradientPresets } from '@paper-design/shaders-react';

// Use a preset
<MeshGradient {...meshGradientPresets[0].params} />

// Browse presets
console.log(meshGradientPresets.map(p => p.name));
```

Available presets: `meshGradientPresets`, `dotOrbitPresets`, `metaballsPresets`, `godRaysPresets`, `voronoiPresets`, `smokeRingPresets`, `neuroNoisePresets`, `spiralPresets`, `swirlPresets`, `warpPresets`, `wavesPresets`, `perlinNoisePresets`, `simplexNoisePresets`, `grainGradientPresets`, `ditheringPresets`, `dotGridPresets`, `colorPanelsPresets`, `pulsingBorderPresets`.

---

## Attribution

Paper Shaders is licensed under Apache 2.0. Commercial use without visible attribution is permitted. If redistributing as part of another shader library, preserve the LICENSE and NOTICE files.

- Source: https://github.com/paper-design/shaders
- Docs: https://shaders.paper.design
- npm: `@paper-design/shaders` (vanilla), `@paper-design/shaders-react` (React)
