import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { damp } from '../core/utils.js';

const AnimeGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
    uSaturation: { value: 1.2 },
    uContrast: { value: 1.015 },
    uTimeStop: { value: 0 },
    uInvertFlash: { value: 0 },
    uSpeedLines: { value: 0 },
    uGlitch: { value: 0 },
    uDamage: { value: 0 },
    uVignette: { value: 0.46 },
    uGrain: { value: 0.017 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uTimeStop;
    uniform float uInvertFlash;
    uniform float uSpeedLines;
    uniform float uGlitch;
    uniform float uDamage;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 p = uv - 0.5;
      p.x *= uAspect;
      float r = length(p);
      float ang = atan(p.y, p.x);

      // 空间系技能 / 受击时的轻微色散
      float ab = (uGlitch * 0.0045 + uDamage * 0.0016) * (0.35 + r);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + vec2(ab, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(ab, 0.0)).b;

      // 动漫集中线：用角度 + 时间噪声制造放射状墨线
      float raySeed = hash(vec2(floor(ang * 140.0), floor(uTime * 9.0)));
      float ray = smoothstep(0.73, 0.99, raySeed);
      float rayBand = smoothstep(0.14, 0.34, r) * (1.0 - smoothstep(0.62, 1.02, r));
      float lines = ray * rayBand * uSpeedLines;
      col = mix(col, vec3(1.0), lines * 0.34);
      col = mix(col, vec3(0.02), lines * 0.12);

      // 时间停止：黑白灰阶 + 高对比 + 少许蓝色冷调
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 mono = vec3(luma);
      mono = mix(mono, mono * vec3(0.9, 0.94, 1.08), 0.55);
      mono = (mono - 0.5) * 1.28 + 0.5;
      col = mix(col, mono, clamp(uTimeStop, 0.0, 1.0));

      // 时间停止边缘的漫画留白与反相闪帧
      float edge = smoothstep(0.46, 0.83, r) * uTimeStop;
      float edgeNoise = step(0.6, hash(vec2(floor(ang * 180.0), floor(uTime * 12.0))));
      col = mix(col, vec3(0.96), edge * edgeNoise * 0.2);
      col = mix(col, 1.0 - col, uInvertFlash * 0.85);

      // 饱和度 / 对比度 / 暖冷分离
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(g), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col.r += 0.026 * smoothstep(0.2, 1.0, luma);
      col.b += 0.028 * smoothstep(0.1, 0.9, 1.0 - luma);

      // 受击红色边缘
      float hurtEdge = smoothstep(0.32, 0.92, r) * uDamage;
      col = mix(col, vec3(0.95, 0.08, 0.2), hurtEdge * 0.34);

      // 胶片颗粒 + 暗角
      float grain = hash(uv * 1200.0 + fract(uTime) * 12.0) - 0.5;
      col += grain * uGrain;
      float vig = smoothstep(0.98, 0.32, r);
      col *= mix(1.0, vig, uVignette);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, quality = 'midt') {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.46, 0.5, 0.84);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(AnimeGradeShader);
    this.composer.addPass(this.grade);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.time = 0;
    this.targetTimeStop = 0;
    this.timeStop = 0;
    this.invert = 0;
    this.speedLines = 0;
    this.glitch = 0;
    this.damage = 0;
    this.setQuality(quality);
  }

  setQuality(quality) {
    this.quality = quality;
    if (quality === 'low') {
      this.bloom.strength = 0.3;
      this.bloom.radius = 0.25;
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    } else if (quality === 'high') {
      this.bloom.strength = 0.66;
      this.bloom.radius = 0.72;
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } else {
      this.bloom.strength = 0.52;
      this.bloom.radius = 0.48;
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.4));
    }
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.grade.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
  }

  setBloomStrength(v) {
    this.bloom.strength = v;
  }

  setTimeStop(active, instant = false) {
    this.targetTimeStop = active ? 1 : 0;
    if (instant) this.timeStop = this.targetTimeStop;
    if (active) this.invert = 1;
  }

  pulseInvert(v = 0.7) {
    this.invert = Math.max(this.invert, v);
  }

  pulseSpeed(v = 1) {
    this.speedLines = Math.max(this.speedLines, v);
  }

  setGlitch(v = 1) {
    this.glitch = Math.max(this.glitch, v);
  }

  pulseDamage(v = 1) {
    this.damage = Math.max(this.damage, v);
  }

  update(dt) {
    this.time += dt;
    this.timeStop = damp(this.timeStop, this.targetTimeStop, 9, dt);
    this.invert = Math.max(0, this.invert - dt * 4.2);
    this.speedLines = Math.max(0, this.speedLines - dt * 2.4);
    this.glitch = Math.max(0, this.glitch - dt * 3.3);
    this.damage = Math.max(0, this.damage - dt * 2.8);
    const u = this.grade.uniforms;
    u.uTime.value = this.time;
    u.uTimeStop.value = this.timeStop;
    u.uInvertFlash.value = this.invert;
    u.uSpeedLines.value = this.speedLines;
    u.uGlitch.value = this.glitch;
    u.uDamage.value = this.damage;
    u.uAspect.value = window.innerWidth / window.innerHeight;
  }

  render(dt) {
    this.update(dt);
    this.composer.render(dt);
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    this.grade.uniforms.uAspect.value = width / height;
  }

  dispose() {
    this.composer.dispose?.();
    this.bloom.dispose?.();
    this.grade.dispose?.();
    this.output.dispose?.();
  }
}

