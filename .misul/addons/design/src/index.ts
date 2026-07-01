// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Design addon: reimagined WebGL2 fragment shaders and a minimal mount.
// Zero dependencies. Plain TS and GLSL. Not derived from paper-design/shaders.

export { GLSL_UTILS } from "./utils";
export { mount } from "./mount";
export type {
	MountOptions,
	MountHandle,
	UniformType,
	UniformValue,
	UniformTypes,
} from "./mount";

export {
	MESH_GRADIENT_FRAGMENT,
	meshGradientTypes,
	meshGradientDefaults,
} from "./shaders/mesh-gradient";
export type { MeshGradientParams } from "./shaders/mesh-gradient";

export {
	METABALLS_FRAGMENT,
	metaballsTypes,
	metaballsDefaults,
} from "./shaders/metaballs";
export type { MetaballsParams } from "./shaders/metaballs";

export {
	DOT_ORBIT_FRAGMENT,
	dotOrbitTypes,
	dotOrbitDefaults,
} from "./shaders/dot-orbit";
export type { DotOrbitParams } from "./shaders/dot-orbit";

export {
	GOD_RAYS_FRAGMENT,
	godRaysTypes,
	godRaysDefaults,
} from "./shaders/god-rays";
export type { GodRaysParams } from "./shaders/god-rays";

export {
	VORONOI_FRAGMENT,
	voronoiTypes,
	voronoiDefaults,
} from "./shaders/voronoi";
export type { VoronoiParams } from "./shaders/voronoi";

export {
	NEURO_NOISE_FRAGMENT,
	neuroNoiseTypes,
	neuroNoiseDefaults,
} from "./shaders/neuro-noise";
export type { NeuroNoiseParams } from "./shaders/neuro-noise";
