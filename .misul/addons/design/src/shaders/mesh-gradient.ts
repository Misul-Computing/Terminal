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

// Mesh gradient: up to six color spots drifting over a noise-warped field,
// blended by inverse-distance weighting. Reimagined from scratch.

import type { UniformTypes } from "../mount";

export interface MeshGradientParams {
	u_time: number;
	u_resolution: number[];
	u_pixelRatio: number;
	u_count: number;
	u_colors: number[]; // flat: count * 3, each 0..1
	u_spots: number[]; // flat: count * 2, each 0..1
	u_speed: number;
	u_scale: number;
	u_warp: number;
}

export const meshGradientTypes: UniformTypes = {
	u_time: "1f",
	u_resolution: "2f",
	u_pixelRatio: "1f",
	u_count: "1f",
	u_colors: "3fv",
	u_spots: "2fv",
	u_speed: "1f",
	u_scale: "1f",
	u_warp: "1f",
};

export const meshGradientDefaults: MeshGradientParams = {
	u_time: 0,
	u_resolution: [1, 1],
	u_pixelRatio: 1,
	u_count: 4,
	u_colors: [0.95, 0.27, 0.51, 0.18, 0.45, 0.92, 0.98, 0.78, 0.21, 0.32, 0.91, 0.62],
	u_spots: [0.2, 0.3, 0.8, 0.2, 0.5, 0.8, 0.75, 0.7],
	u_speed: 0.08,
	u_scale: 2.2,
	u_warp: 0.18,
};

export const MESH_GRADIENT_FRAGMENT = `
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixelRatio;
uniform float u_count;
uniform vec3 u_colors[6];
uniform vec2 u_spots[6];
uniform float u_speed;
uniform float u_scale;
uniform float u_warp;

void main(){
  float ar = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(ar, 1.0);
  float t = u_time * u_speed;
  p += vec2(fbm(p * u_scale + t), fbm(p * u_scale - t * 0.8)) * u_warp;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  for(int i = 0; i < 6; i++){
    if(float(i) >= u_count) break;
    vec2 sp = u_spots[i] - 0.5;
    sp *= vec2(ar, 1.0);
    sp += 0.18 * vec2(sin(t + float(i) * 1.7), cos(t * 1.3 + float(i) * 2.1));
    float d = dot(p - sp, p - sp);
    float w = 1.0 / (d + 0.12);
    col += u_colors[i] * w;
    wsum += w;
  }
  col /= max(wsum, 1e-4);
  fragColor = vec4(col, 1.0);
}
`;
