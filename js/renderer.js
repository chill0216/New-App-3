// WebGL mesh-warp renderer.
//
// The camera frame is drawn as a full-screen background, then the face is drawn as a
// textured triangle mesh whose texture coordinates are the detected landmarks and whose
// vertex positions are the displaced landmarks. A fixed ring of vertices around the face
// oval keeps the warp continuous with the untouched background.

import {
  TRIANGLES, FACE_OVAL, MOUTH_INNER, RIGHT_EYE, LEFT_EYE, RIGHT_IRIS, LEFT_IRIS, LANDMARK_COUNT,
} from './mesh-data.js';

const RING_FACTOR = 1.55; // outer ring distance from the face centre, relative to the oval
const MOUTH_CENTER = LANDMARK_COUNT; // extra vertex index
const RING_START = LANDMARK_COUNT + 1;
const VERTEX_COUNT = RING_START + FACE_OVAL.length;

const VS = `
attribute vec2 aPos;
attribute vec2 aUV;
attribute float aShade;
uniform float uMirror;
varying vec2 vUV;
varying float vShade;
void main() {
  vUV = aUV;
  vShade = aShade;
  gl_Position = vec4(uMirror * (aPos.x * 2.0 - 1.0), 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform sampler2D uTex;
uniform float uShadeStrength;
varying vec2 vUV;
varying float vShade;
void main() {
  vec4 c = texture2D(uTex, vUV);
  // Relight in a slightly compressed space so shadows deepen without crushing skin tone.
  float k = mix(1.0, vShade, uShadeStrength);
  gl_FragColor = vec4(clamp(c.rgb * k, 0.0, 1.0), 1.0);
}`;

function buildIndices() {
  const idx = [...TRIANGLES];
  const fan = (loop, center) => {
    for (let k = 0; k < loop.length; k++) idx.push(center, loop[k], loop[(k + 1) % loop.length]);
  };
  fan(MOUTH_INNER, MOUTH_CENTER);
  fan(RIGHT_EYE, RIGHT_IRIS);
  fan(LEFT_EYE, LEFT_IRIS);
  const n = FACE_OVAL.length;
  for (let k = 0; k < n; k++) {
    const a = FACE_OVAL[k];
    const b = FACE_OVAL[(k + 1) % n];
    const ra = RING_START + k;
    const rb = RING_START + ((k + 1) % n);
    idx.push(a, b, ra, b, rb, ra);
  }
  return new Uint16Array(idx);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    this.width = 0;
    this.height = 0;
    this.mirror = true;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aUV = gl.getAttribLocation(prog, 'aUV');
    this.aShade = gl.getAttribLocation(prog, 'aShade');
    this.uMirror = gl.getUniformLocation(prog, 'uMirror');
    this.uShadeStrength = gl.getUniformLocation(prog, 'uShadeStrength');
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    this.shadeStrength = 1;

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Background quad: two triangles covering the frame, identity mapping.
    const quad = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const indices = buildIndices();
    this.indexCount = indices.length;
    this.indexBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    this.posData = new Float32Array(VERTEX_COUNT * 2);
    this.uvData = new Float32Array(VERTEX_COUNT * 2);
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.posData, gl.DYNAMIC_DRAW);
    this.uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.uvData, gl.DYNAMIC_DRAW);
    this.shadeData = new Float32Array(VERTEX_COUNT).fill(1);
    this.shadeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.shadeData, gl.DYNAMIC_DRAW);
    // Background quad has no per-vertex shade; it uses the constant attribute value.
    this.quadShade = new Float32Array(6).fill(1);
    this.quadShadeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadShadeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.quadShade, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aUV);
    gl.enableVertexAttribArray(this.aShade);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 1);
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  /** Upload the current camera frame. */
  uploadFrame(source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
  }

  /**
   * Draw the frame.
   * @param {Float32Array|null} base   landmark x,y,z triples in pixels (null = no face)
   * @param {Float32Array|null} warped displaced x,y,z triples in pixels
   * @param {{cx:number, cy:number}|null} frame face frame (for the outer ring)
   * @param {Float32Array|null} shade  per-landmark brightness ratio (1 = unchanged)
   */
  draw(base, warped, frame, shade) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(this.uMirror, this.mirror ? -1 : 1);
    gl.uniform1f(this.uShadeStrength, this.shadeStrength);

    // Background.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadShadeBuf);
    gl.vertexAttribPointer(this.aShade, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (!base || !warped || !frame) return;

    const W = this.width;
    const H = this.height;
    const pos = this.posData;
    const uv = this.uvData;
    const sh = this.shadeData;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      uv[i * 2] = base[i * 3] / W;
      uv[i * 2 + 1] = base[i * 3 + 1] / H;
      pos[i * 2] = warped[i * 3] / W;
      pos[i * 2 + 1] = warped[i * 3 + 1] / H;
      sh[i] = shade ? shade[i] : 1;
    }
    // Mouth centre (average of the inner lip loop).
    let mx = 0; let my = 0; let bx = 0; let by = 0; let ms = 0;
    for (const i of MOUTH_INNER) {
      mx += warped[i * 3]; my += warped[i * 3 + 1];
      bx += base[i * 3]; by += base[i * 3 + 1];
      ms += sh[i];
    }
    const mn = MOUTH_INNER.length;
    pos[MOUTH_CENTER * 2] = mx / mn / W;
    pos[MOUTH_CENTER * 2 + 1] = my / mn / H;
    uv[MOUTH_CENTER * 2] = bx / mn / W;
    uv[MOUTH_CENTER * 2 + 1] = by / mn / H;
    sh[MOUTH_CENTER] = ms / mn;
    // Fixed outer ring, expanded from the (undisplaced) face oval.
    for (let k = 0; k < FACE_OVAL.length; k++) {
      const i = FACE_OVAL[k];
      const x = (frame.cx + (base[i * 3] - frame.cx) * RING_FACTOR) / W;
      const y = (frame.cy + (base[i * 3 + 1] - frame.cy) * RING_FACTOR) / H;
      const v = RING_START + k;
      pos[v * 2] = x; pos[v * 2 + 1] = y;
      uv[v * 2] = x; uv[v * 2 + 1] = y;
      sh[v] = 1;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, uv);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sh);
    gl.vertexAttribPointer(this.aShade, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }
}
