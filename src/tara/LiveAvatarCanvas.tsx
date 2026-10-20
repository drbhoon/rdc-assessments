import { useEffect, useRef } from "react";
import { withBase } from "../basePath";
import { AvatarMotion, type AvatarMode } from "./motion";

/**
 * Copied from TARA Online (rdc-web-chatbot, src/components/chat/LiveAvatarCanvas.tsx)
 * for the Fresher interview; keep the two in step.
 *
 * Draws the avatar photo on a WebGL mesh so the head can move on its own:
 * everything above the chin follows the head pose, the shoulders stay put,
 * and the neck and hair in between bend smoothly. Still one 2D photo; no 3D.
 *
 * Mouth frames cross-fade with loudness, and the blink frame is blended in
 * over the eyes only, so she can blink while she talks. Calls onReady(true)
 * once the first frame is drawn, onReady(false) if WebGL is lost; the caller
 * shows the plain images until then.
 */

// Landmarks of tara-*.webp (900 x 855, scaled from 1287 x 1222), as fractions of the image.
const IMAGE_ASPECT = 900 / 855;
const NECK_PIVOT = [0.505, 0.53];
const HEAD_UNTIL = 0.47; // the chin: the head moves fully above this
const BODY_FROM = 0.6; // the collar: nothing below this moves with the head
const EYES = { left: 0.31, right: 0.69, top: 0.21, bottom: 0.35 };
const EYE_LEVEL = 0.29;
const GRID = 48;
const TEXTURE_SIZE = 1024;

const FRAMES = ["tara/tara-rest.webp", "tara/tara-speak-soft.webp", "tara/tara-speak-open.webp", "tara/tara-blink.webp"];

const VERTEX = `
attribute vec2 a_uv;
uniform float u_aspect;
uniform vec2 u_pivot;
uniform float u_tilt;
uniform float u_pitch;
uniform vec2 u_head;
uniform float u_breath;
uniform float u_sway;
uniform vec4 u_place; // image rectangle in the canvas: x, y, width, height (0..1)
varying vec2 v_uv;

vec2 rotate(vec2 p, vec2 centre, float a) {
  vec2 d = p - centre;
  return centre + vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
}

void main() {
  // Work in units of image height, y down.
  vec2 p = vec2(a_uv.x * u_aspect, a_uv.y);
  float w = 1.0 - smoothstep(${HEAD_UNTIL.toFixed(3)}, ${BODY_FROM.toFixed(3)}, a_uv.y);
  // A forward nod seen from the front: the eyes and nose move down most, the
  // crown hardly at all and the chin less than the eyes, so the lower face
  // shortens. Peaks at eye level; nothing below the collar moves.
  float pitchShape = smoothstep(0.0, ${EYE_LEVEL.toFixed(3)}, a_uv.y) * (1.0 - 0.75 * smoothstep(${EYE_LEVEL.toFixed(3)}, ${HEAD_UNTIL.toFixed(3)}, a_uv.y)) * w;
  p.y += u_pitch * pitchShape;
  p = rotate(p, vec2(u_pivot.x * u_aspect, u_pivot.y), u_tilt * w);
  p += vec2(u_head.x, u_head.y) * w;
  // Breathing lifts the chest and head; the bottom edge stays put.
  p.y = 1.0 - (1.0 - p.y) * (1.0 + u_breath);
  p = rotate(p, vec2(0.5 * u_aspect, 1.0), u_sway);
  vec2 box = vec2(u_place.x + p.x / u_aspect * u_place.z, u_place.y + p.y * u_place.w);
  gl_Position = vec4(box.x * 2.0 - 1.0, 1.0 - box.y * 2.0, 0.0, 1.0);
  v_uv = a_uv;
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_rest;
uniform sampler2D u_soft;
uniform sampler2D u_open;
uniform sampler2D u_blinkFrame;
uniform vec3 u_mouth;
uniform float u_blink;
void main() {
  vec4 colour = texture2D(u_rest, v_uv) * u_mouth.x + texture2D(u_soft, v_uv) * u_mouth.y + texture2D(u_open, v_uv) * u_mouth.z;
  float eyes = smoothstep(${EYES.left - 0.02}, ${EYES.left + 0.02}, v_uv.x) * (1.0 - smoothstep(${EYES.right - 0.02}, ${EYES.right + 0.02}, v_uv.x))
             * smoothstep(${EYES.top - 0.02}, ${EYES.top + 0.02}, v_uv.y) * (1.0 - smoothstep(${EYES.bottom - 0.02}, ${EYES.bottom + 0.02}, v_uv.y));
  gl_FragColor = mix(colour, texture2D(u_blinkFrame, v_uv), u_blink * eyes);
}`;

function loadFrame(name: string): Promise<HTMLImageElement> {
  const src = withBase(`/${name}`);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader");
  return shader;
}

function uploadTexture(gl: WebGLRenderingContext, image: HTMLImageElement, unit: number): void {
  // A square power-of-two copy, so mipmaps work on every WebGL: without them a
  // large photo drawn small shimmers.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEXTURE_SIZE;
  canvas.getContext("2d")!.drawImage(image, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function buildMesh(gl: WebGLRenderingContext, program: WebGLProgram): number {
  const uvs: number[] = [];
  for (let row = 0; row <= GRID; row++) for (let col = 0; col <= GRID; col++) uvs.push(col / GRID, row / GRID);
  const indices: number[] = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const a = row * (GRID + 1) + col;
      indices.push(a, a + 1, a + GRID + 1, a + 1, a + GRID + 2, a + GRID + 1);
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, "a_uv");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  return indices.length;
}

/** Which mouth frame the loudness calls for: the same thresholds as the image fallback. */
export function mouthTarget(mode: AvatarMode, energy: number): [number, number, number] {
  if (mode !== "speaking" || energy < 0.18) return [1, 0, 0];
  return energy < 0.62 ? [0, 1, 0] : [0, 0, 1];
}

interface Props {
  mode: AvatarMode;
  speechEnergy: number;
  /** Each change asks for an understanding nod (the visitor is asking something). */
  nodSignal?: number;
  className?: string;
  onReady: (ready: boolean) => void;
}

export default function LiveAvatarCanvas({ mode, speechEnergy, nodSignal = 0, className, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, speechEnergy });
  live.current = { mode, speechEnergy };
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const motionRef = useRef<AvatarMotion | null>(null);

  useEffect(() => {
    if (nodSignal > 0) motionRef.current?.acknowledge();
  }, [nodSignal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) return; // stays on the plain images

    let frame = 0;
    let cancelled = false;
    const motion = new AvatarMotion();
    motionRef.current = motion;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const mouth = [1, 0, 0];

    const onLost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      onReadyRef.current(false);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    const fit = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const resize = new ResizeObserver(fit);
    resize.observe(canvas);

    Promise.all(FRAMES.map(loadFrame))
      .then((images) => {
        if (cancelled) return;
        const program = gl.createProgram()!;
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
        gl.useProgram(program);
        const count = buildMesh(gl, program);
        images.forEach((image, unit) => uploadTexture(gl, image, unit));
        ["u_rest", "u_soft", "u_open", "u_blinkFrame"].forEach((name, unit) => gl.uniform1i(gl.getUniformLocation(program, name), unit));
        const at = (name: string) => gl.getUniformLocation(program, name);
        const u = {
          aspect: at("u_aspect"), pivot: at("u_pivot"), tilt: at("u_tilt"), pitch: at("u_pitch"), head: at("u_head"), breath: at("u_breath"),
          sway: at("u_sway"), place: at("u_place"), mouth: at("u_mouth"), blink: at("u_blink"),
        };
        gl.uniform1f(u.aspect, IMAGE_ASPECT);
        gl.uniform2f(u.pivot, NECK_PIVOT[0], NECK_PIVOT[1]);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);

        let last = performance.now();
        let first = true;
        const draw = (now: number) => {
          const dt = (now - last) / 1000;
          last = now;
          fit();
          const { mode: currentMode, speechEnergy: energy } = live.current;
          const pose = motion.update(dt, currentMode, energy, reduced?.matches ?? false);

          // Cross-fade the mouth over ~60 ms instead of snapping between frames.
          const target = mouthTarget(currentMode, energy);
          const blend = 1 - Math.exp(-dt / 0.06);
          for (let i = 0; i < 3; i++) mouth[i] += (target[i] - mouth[i]) * blend;
          const total = mouth[0] + mouth[1] + mouth[2];

          // object-fit: contain, anchored at the bottom centre, like the <Image> fallback.
          const scale = Math.min(canvas.width / IMAGE_ASPECT, canvas.height);
          const placeW = (scale * IMAGE_ASPECT) / canvas.width;
          const placeH = scale / canvas.height;

          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.uniform4f(u.place, (1 - placeW) / 2, 1 - placeH, placeW, placeH);
          gl.uniform1f(u.tilt, (pose.tilt * Math.PI) / 180);
          gl.uniform1f(u.pitch, pose.pitch);
          gl.uniform2f(u.head, pose.turn, pose.rise + pose.nod);
          gl.uniform1f(u.breath, pose.breath * 0.0035);
          gl.uniform1f(u.sway, (pose.sway * Math.PI) / 180);
          gl.uniform3f(u.mouth, mouth[0] / total, mouth[1] / total, mouth[2] / total);
          gl.uniform1f(u.blink, pose.blink);
          gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);

          if (first) {
            first = false;
            onReadyRef.current(true);
          }
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
      })
      .catch((error) => {
        console.warn("Live avatar unavailable; showing the still images.", error);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      // No loseContext(): a remount (React strict mode) reuses this canvas's context.
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
