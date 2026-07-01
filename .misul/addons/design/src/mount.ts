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

// Minimal WebGL2 mount: canvas, context, program, uniforms, RAF with
// visibility pause, and resize. A function, not a class. Zero dependencies.

import { GLSL_UTILS } from "./utils";

export type UniformType = "1f" | "2f" | "3f" | "4f" | "1fv" | "2fv" | "3fv" | "4fv";
export type UniformValue = number | number[];
export type UniformTypes = Record<string, UniformType>;

export interface MountOptions {
	canvas?: HTMLCanvasElement;
	fragment: string;
	types: UniformTypes;
	uniforms: Record<string, UniformValue>;
	pixelRatio?: number;
	animated?: boolean;
	onUpdate?: (u: Record<string, UniformValue>) => void;
}

export interface MountHandle {
	canvas: HTMLCanvasElement;
	uniforms: Record<string, UniformValue>;
	set: (patch: Record<string, UniformValue>) => void;
	render: () => void;
	destroy: () => void;
}

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
	const sh = gl.createShader(type);
	if (!sh) throw new Error("createShader failed");
	gl.shaderSource(sh, src);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(sh);
		gl.deleteShader(sh);
		throw new Error("shader compile failed: " + log);
	}
	return sh;
}

export function mount(opts: MountOptions): MountHandle {
	const canvas = opts.canvas ?? document.createElement("canvas");
	const gl = canvas.getContext("webgl2");
	if (!gl) throw new Error("WebGL2 not supported");
	const frag = `#version 300 es\nprecision mediump float;\n${GLSL_UTILS}\n${opts.fragment}`;
	const prog = gl.createProgram();
	if (!prog) throw new Error("createProgram failed");
	const vs = compile(gl, gl.VERTEX_SHADER, VERT);
	const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.bindAttribLocation(prog, 0, "a_pos");
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		throw new Error("program link failed: " + gl.getProgramInfoLog(prog));
	}
	gl.useProgram(prog);
	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
		gl.STATIC_DRAW,
	);
	const aLoc = gl.getAttribLocation(prog, "a_pos");
	gl.enableVertexAttribArray(aLoc);
	gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
	const ulocs: Record<string, WebGLUniformLocation | null> = {};
	for (const name in opts.types) ulocs[name] = gl.getUniformLocation(prog, name);
	const uniforms: Record<string, UniformValue> = { ...opts.uniforms };
	const setUniforms = () => {
		gl.useProgram(prog);
		for (const name in opts.types) {
			const l = ulocs[name];
			if (!l) continue;
			const v = uniforms[name];
			if (v === undefined) continue;
			switch (opts.types[name]) {
				case "1f":
					gl.uniform1f(l, v as number);
					break;
				case "2f":
					gl.uniform2fv(l, v as number[]);
					break;
				case "3f":
					gl.uniform3fv(l, v as number[]);
					break;
				case "4f":
					gl.uniform4fv(l, v as number[]);
					break;
				case "1fv":
					gl.uniform1fv(l, v as number[]);
					break;
				case "2fv":
					gl.uniform2fv(l, v as number[]);
					break;
				case "3fv":
					gl.uniform3fv(l, v as number[]);
					break;
				case "4fv":
					gl.uniform4fv(l, v as number[]);
					break;
			}
		}
	};
	const dpr = opts.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);
	const resize = () => {
		const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
		const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		gl.viewport(0, 0, canvas.width, canvas.height);
		uniforms["u_resolution"] = [canvas.width, canvas.height];
		uniforms["u_pixelRatio"] = dpr;
	};
	const ro = new ResizeObserver(() => {
		resize();
		if (!animated) draw();
	});
	ro.observe(canvas);
	resize();
	const draw = () => {
		setUniforms();
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	};
	let raf = 0;
	let visible = true;
	let last = performance.now();
	const frame = () => {
		raf = requestAnimationFrame(frame);
		if (document.hidden) {
			visible = false;
			return;
		}
		const now = performance.now();
		if (!visible) {
			visible = true;
			last = now;
		}
		const prev = (uniforms["u_time"] as number) ?? 0;
		uniforms["u_time"] = prev + (now - last) / 1000;
		last = now;
		if (opts.onUpdate) opts.onUpdate(uniforms);
		resize();
		draw();
	};
	const animated = opts.animated !== false;
	if (animated) {
		raf = requestAnimationFrame(frame);
	} else {
		draw();
	}
	return {
		canvas,
		uniforms,
		set: (patch) => {
			Object.assign(uniforms, patch);
			if (!animated) draw();
		},
		render: draw,
		destroy: () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			gl.deleteProgram(prog);
			gl.deleteShader(vs);
			gl.deleteShader(fs);
			gl.deleteBuffer(buf);
		},
	};
}
