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

// God rays: radial light from a source point, modulated by fbm along the
// angular axis, with an exponential falloff and a soft core glow.

import type { UniformTypes } from "../mount";

export interface GodRaysParams {
	u_time: number;
	u_resolution: number[];
	u_pixelRatio: number;
	u_source: number[]; // 0..1 screen space
	u_color: number[];
	u_intensity: number;
	u_speed: number;
	u_decay: number;
}

export const godRaysTypes: UniformTypes = {
	u_time: "1f",
	u_resolution: "2f",
	u_pixelRatio: "1f",
	u_source: "2f",
	u_color: "3f",
	u_intensity: "1f",
	u_speed: "1f",
	u_decay: "1f",
};

export const godRaysDefaults: GodRaysParams = {
	u_time: 0,
	u_resolution: [1, 1],
	u_pixelRatio: 1,
	u_source: [0.5, 0.5],
	u_color: [1.0, 0.86, 0.55],
	u_intensity: 1.2,
	u_speed: 0.3,
	u_decay: 2.2,
};

export const GOD_RAYS_FRAGMENT = `
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixelRatio;
uniform vec2 u_source;
uniform vec3 u_color;
uniform float u_intensity;
uniform float u_speed;
uniform float u_decay;

void main(){
  float ar = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(ar, 1.0);
  vec2 src = (u_source - 0.5) * vec2(ar, 1.0);
  vec2 d = p - src;
  float r = length(d);
  float a = atan(d.y, d.x);
  float rays = fbm(vec2(a * 6.0, u_time * u_speed));
  rays = 0.5 + 0.5 * rays;
  float falloff = exp(-r * u_decay);
  float v = rays * falloff * u_intensity;
  vec3 col = u_color * v;
  col += u_color * smoothstep(0.25, 0.0, r) * 0.5;
  fragColor = vec4(col, 1.0);
}
`;
