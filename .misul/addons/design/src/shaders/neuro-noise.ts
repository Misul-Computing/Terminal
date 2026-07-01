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

// Neuro noise: a domain-warped fbm field blended across three colors. Reads
// as a flowing plasma or neural texture. Reimagined from scratch.

import type { UniformTypes } from "../mount";

export interface NeuroNoiseParams {
	u_time: number;
	u_resolution: number[];
	u_pixelRatio: number;
	u_scale: number;
	u_speed: number;
	u_colorA: number[];
	u_colorB: number[];
	u_colorC: number[];
}

export const neuroNoiseTypes: UniformTypes = {
	u_time: "1f",
	u_resolution: "2f",
	u_pixelRatio: "1f",
	u_scale: "1f",
	u_speed: "1f",
	u_colorA: "3f",
	u_colorB: "3f",
	u_colorC: "3f",
};

export const neuroNoiseDefaults: NeuroNoiseParams = {
	u_time: 0,
	u_resolution: [1, 1],
	u_pixelRatio: 1,
	u_scale: 3.0,
	u_speed: 0.35,
	u_colorA: [0.08, 0.1, 0.25],
	u_colorB: [0.45, 0.2, 0.75],
	u_colorC: [0.95, 0.5, 0.85],
};

export const NEURO_NOISE_FRAGMENT = `
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixelRatio;
uniform float u_scale;
uniform float u_speed;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_colorC;

void main(){
  float ar = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(ar, 1.0) * u_scale;
  float t = u_time * u_speed;
  vec2 q = vec2(fbm(p + t), fbm(p - t * 0.7));
  float n = fbm(p + q * 2.0 + t * 0.5);
  vec3 col = mix(u_colorA, u_colorB, n);
  col = mix(col, u_colorC, smoothstep(0.4, 0.75, n));
  fragColor = vec4(col, 1.0);
}
`;
