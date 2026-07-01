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

// Dot orbit: dots arranged on concentric rings, each ring spinning at a
// different speed and direction. Reimagined from scratch.

import type { UniformTypes } from "../mount";

export interface DotOrbitParams {
	u_time: number;
	u_resolution: number[];
	u_pixelRatio: number;
	u_rings: number;
	u_density: number;
	u_speed: number;
	u_dotSize: number;
	u_color: number[];
	u_bgColor: number[];
}

export const dotOrbitTypes: UniformTypes = {
	u_time: "1f",
	u_resolution: "2f",
	u_pixelRatio: "1f",
	u_rings: "1f",
	u_density: "1f",
	u_speed: "1f",
	u_dotSize: "1f",
	u_color: "3f",
	u_bgColor: "3f",
};

export const dotOrbitDefaults: DotOrbitParams = {
	u_time: 0,
	u_resolution: [1, 1],
	u_pixelRatio: 1,
	u_rings: 5,
	u_density: 12,
	u_speed: 0.4,
	u_dotSize: 0.012,
	u_color: [0.9, 0.95, 1.0],
	u_bgColor: [0.02, 0.03, 0.06],
};

export const DOT_ORBIT_FRAGMENT = `
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixelRatio;
uniform float u_rings;
uniform float u_density;
uniform float u_speed;
uniform float u_dotSize;
uniform vec3 u_color;
uniform vec3 u_bgColor;

void main(){
  float ar = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(ar, 1.0);
  float t = u_time * u_speed;
  vec3 col = u_bgColor;
  for(int i = 0; i < 8; i++){
    if(float(i) >= u_rings) break;
    float fi = float(i);
    float ringR = 0.1 + fi * 0.085;
    float dir = mod(fi, 2.0) * 2.0 - 1.0;
    float spin = t * dir / (1.0 + fi);
    float seg = 6.2831853 / u_density;
    float a = atan(p.y, p.x) - spin;
    float nearest = round(a / seg) * seg + spin;
    vec2 dp = vec2(cos(nearest), sin(nearest)) * ringR;
    float d = length(p - dp);
    float df = smoothstep(u_dotSize, u_dotSize * 0.4, d);
    col = mix(col, u_color, df);
  }
  fragColor = vec4(col, 1.0);
}
`;
