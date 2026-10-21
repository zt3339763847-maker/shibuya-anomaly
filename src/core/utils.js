import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (min = 0, max = 1) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const choose = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp01 = (v) => clamp(v, 0, 1);
export const round = (v, n = 0) => Math.round(v * 10 ** n) / 10 ** n;
export const formatTime = (secs) => {
  const s = Math.max(0, Math.ceil(secs));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
};
export const shortTime = (secs) => {
  if (secs >= 10) return Math.ceil(secs).toString();
  return (Math.ceil(secs * 10) / 10).toFixed(1);
};
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist3D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const angleDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

export function forwardFromYaw(yaw, out = { x: 0, y: 0, z: 0 }) {
  out.x = Math.sin(yaw);
  out.z = Math.cos(yaw);
  out.y = 0;
  return out;
}
export function yawTo(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}
export function seeded(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function canvasTexture(width, height, draw, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  texture.anisotropy = opts.anisotropy ?? 4;
  texture.needsUpdate = true;
  return texture;
}
export function makeId(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 8);
}
export function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
