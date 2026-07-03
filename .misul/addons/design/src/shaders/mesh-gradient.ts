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

import type { UniformTypes } from "../mount";

export interface MeshGradientParams {
	u_time: number;
	u_resolution: number[];
	u_pixelRatio: number;
	u_count: number;
	u_colors: number[];
	u_spots: number[];
	u_speed: number;
	u_scale: number;
	u_warp: number;
	u_blur: number;
	u_grain: number;
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
	u_blur: "1f",
	u_grain: "1f",
};

export const meshGradientDefaults: MeshGradientParams = {
	u_time: 0,
	u_resolution: [1, 1],
	u_pixelRatio: 1,
	u_count: 5,
	u_colors: [
		0.95, 0.27, 0.51,
		0.18, 0.45, 0.92,
		0.98, 0.78, 0.21,
		0.32, 0.91, 0.62,
		0.12, 0.08, 0.22,
		0.0, 0.0, 0.0,
	],
	u_spots: [
		0.15, 0.25,
		0.82, 0.18,
		0.50, 0.82,
		0.72, 0.65,
		0.30, 0.55,
		0.0, 0.0,
	],
	u_speed: 0.06,
	u_scale: 1.5,
	u_warp: 0.35,
	u_blur: 0.6,
	u_grain: 0.03,
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
uniform float u_blur;
uniform float u_grain;

vec2 spotPos(int i, float t, float ar){
  vec2 sp = u_spots[i] - 0.5;
  sp *= vec2(ar, 1.0);
  float ph = float(i) * 2.39996;
  sp += 0.12 * vec2(cos(t * 0.8 + ph), sin(t * 0.6 + ph * 1.3));
  sp += 0.06 * vec2(sin(t * 1.7 + ph * 2.1), cos(t * 1.3 + ph * 0.7));
  return sp;
}

void main(){
  float ar = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(ar, 1.0);
  float t = u_time * u_speed;

  vec2 q = vec2(fbm(p * u_scale + t), fbm(p * u_scale + vec2(5.2, 1.3) - t * 0.8));
  vec2 r = vec2(fbm(p * u_scale * 2.0 + q * 3.0 + vec2(1.7, 9.2) + t * 0.5),
                fbm(p * u_scale * 2.0 + q * 3.0 + vec2(8.3, 2.8) - t * 0.3));
  p += r * u_warp;

  vec3 col = vec3(0.0);
  float wsum = 0.0;
  for(int i = 0; i < 6; i++){
    if(float(i) >= u_count) break;
    vec3 c = srgbToLinear(u_colors[i]);
    vec2 sp = spotPos(i, t, ar);
    float d = length(p - sp);
    float radius = u_blur + 0.15;
    float w = smoothstep(radius, 0.0, d);
    col += c * w;
    wsum += w;
  }
  col /= max(wsum, 1e-4);

  float g = (hash(v_uv * 999.0 + t) - 0.5) * u_grain;
  col += g;

  fragColor = vec4(linearToSrgb(clamp(col, 0.0, 1.0)), 1.0);
}
`;
