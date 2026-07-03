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

// Metaballs: an iso-surface built from six drifting inverse-distance fields,
// with an edge glow between the two blend colors. Reimagined from scratch.

import type { UniformTypes } from "../mount";

export interface MetaballsParams {
	u_time: number;
	u_resolution: number[];
	u_pixelRatio: number;
	u_colorA: number[];
	u_colorB: number[];
	u_speed: number;
	u_threshold: number;
	u_balls: number[]; // flat: 6 * 3, xy = position (0..1), z = radius
}

export const metaballsTypes: UniformTypes = {
	u_time: "1f",
	u_resolution: "2f",
	u_pixelRatio: "1f",
	u_colorA: "3f",
	u_colorB: "3f",
	u_speed: "1f",
	u_threshold: "1f",
	u_balls: "3fv",
};

export const metaballsDefaults: MetaballsParams = {
	u_time: 0,
	u_resolution: [1, 1],
	u_pixelRatio: 1,
	u_colorA: [0.05, 0.06, 0.12],
	u_colorB: [0.4, 0.75, 1.0],
	u_speed: 0.25,
	u_threshold: 1.0,
	u_balls: [
		0.3, 0.4, 0.14, 0.7, 0.3, 0.18, 0.5, 0.7, 0.12, 0.2, 0.6, 0.16, 0.8, 0.7, 0.1, 0.6, 0.2, 0.15,
	],
};

export const METABALLS_FRAGMENT = `
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixelRatio;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform float u_speed;
uniform float u_threshold;
uniform vec3 u_balls[6];

void main(){
  float ar = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(ar, 1.0);
  float t = u_time * u_speed;
  float v = 0.0;
  for(int i = 0; i < 6; i++){
    vec3 b = u_balls[i];
    vec2 pos = (b.xy - 0.5) * vec2(ar, 1.0);
    pos += 0.28 * vec2(sin(t + float(i) * 1.3), cos(t * 0.9 + float(i) * 2.0));
    float r = b.z;
    float d = dot(p - pos, p - pos);
    v += (r * r) / (d + 1e-4);
  }
  float m = smoothstep(u_threshold - 0.6, u_threshold + 0.6, v);
  vec3 col = mix(u_colorA, u_colorB, m);
  float edge = (1.0 - smoothstep(u_threshold, u_threshold + 0.4, v)) * smoothstep(u_threshold - 2.2, u_threshold - 0.6, v);
  col += u_colorB * edge * 0.35;
  fragColor = vec4(linearToSrgb(clamp(col, 0.0, 1.0)), 1.0);
}
`;
