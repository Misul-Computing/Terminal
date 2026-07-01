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

// Voronoi: animated cells with hash-jittered feature points, distance-based
// edge darkening, and per-cell color variation between two endpoints.

import type { UniformTypes } from "../mount";

export interface VoronoiParams {
	u_time: number;
	u_resolution: number[];
	u_pixelRatio: number;
	u_scale: number;
	u_speed: number;
	u_colorA: number[];
	u_colorB: number[];
	u_edge: number;
}

export const voronoiTypes: UniformTypes = {
	u_time: "1f",
	u_resolution: "2f",
	u_pixelRatio: "1f",
	u_scale: "1f",
	u_speed: "1f",
	u_colorA: "3f",
	u_colorB: "3f",
	u_edge: "1f",
};

export const voronoiDefaults: VoronoiParams = {
	u_time: 0,
	u_resolution: [1, 1],
	u_pixelRatio: 1,
	u_scale: 6.0,
	u_speed: 0.5,
	u_colorA: [0.15, 0.55, 0.85],
	u_colorB: [0.95, 0.35, 0.55],
	u_edge: 0.04,
};

export const VORONOI_FRAGMENT = `
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixelRatio;
uniform float u_scale;
uniform float u_speed;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform float u_edge;

vec2 voronoi(vec2 x, out vec2 cellId){
  vec2 n = floor(x);
  vec2 f = fract(x);
  float md = 8.0;
  vec2 closest = vec2(0.0);
  cellId = vec2(0.0);
  for(int j = -1; j <= 1; j++){
    for(int i = -1; i <= 1; i++){
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      o = 0.5 + 0.5 * sin(u_time * u_speed + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if(d < md){
        md = d;
        closest = r;
        cellId = n + g;
      }
    }
  }
  return closest;
}

void main(){
  float ar = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(ar, 1.0);
  vec2 id;
  vec2 c = voronoi(p * u_scale, id);
  float dist = length(c);
  float edge = smoothstep(0.0, u_edge, dist);
  float h = hash(id);
  vec3 col = mix(u_colorA, u_colorB, h);
  col *= edge;
  fragColor = vec4(col, 1.0);
}
`;
