import * as THREE from 'three';
import { buildCharacter } from '../entities/characterModel.js';
import { CHARACTERS } from '../data/characters.js';
import { basicGlow, spriteGlow, getGlowTexture } from '../render/toon.js';
import { rand, TAU } from '../core/utils.js';

/**
 * 主菜单右侧的角色展示舞台。
 * 使用独立 WebGL 上下文渲染，并生成四张卡面肖像。
 */
export class CharacterPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.active = true;
    this.time = 0;
    this.currentId = null;
    this.character = null;
    this._init();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    this.setCharacter('zhoutong');
  }

  _init() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    const rect = this.canvas.getBoundingClientRect();
    this.camera = new THREE.PerspectiveCamera(34, Math.max(0.4, rect.width / Math.max(1, rect.height)), 0.1, 40);
    this.camera.position.set(0, 1.12, 4.25);
    this.camera.lookAt(0, 1.03, 0);

    const hemi = new THREE.HemisphereLight(0xc7d4ff, 0x2a1022, 2.0);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffd9e7, 3.6);
    key.position.set(-2.4, 4.2, 3.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7befff, 2.6);
    rim.position.set(3.2, 2.8, -3.4);
    this.scene.add(rim);
    const fill = new THREE.PointLight(0xff2e63, 18, 10, 2);
    fill.position.set(-2.2, 1.6, 1.3);
    this.scene.add(fill);
    this.fill = fill;

    // 舞台地面
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 64),
      new THREE.MeshBasicMaterial({ color: 0x09080f, transparent: true, opacity: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    this.scene.add(floor);
    const floorRing = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 2.08, 64),
      new THREE.MeshBasicMaterial({ color: 0xff2e63, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = 0.01;
    this.scene.add(floorRing);
    this.floorRing = floorRing;
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.45, 64),
      new THREE.MeshBasicMaterial({ color: 0x5af2ff, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.011;
    this.scene.add(innerRing);

    // 背后的日轮 / 光环
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.08, 1.1, 80),
      new THREE.MeshBasicMaterial({ color: 0xffd3e2, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    halo.position.set(0, 1.4, -1.5);
    this.scene.add(halo);
    this.halo = halo;
    const haloGlow = spriteGlow(0xff3c6c, 6.8, 0.14);
    haloGlow.position.set(0, 1.4, -1.6);
    this.scene.add(haloGlow);
    this.haloGlow = haloGlow;

    // 飘浮光点
    const count = 55;
    const pos = new Float32Array(count * 3);
    this.particles = [];
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const r = rand(0.8, 3.0);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rand(0.1, 3.2);
      pos[i * 3 + 2] = Math.sin(a) * r - 0.8;
      this.particles.push({ y: pos[i * 3 + 1], speed: rand(0.02, 0.12), phase: rand(0, TAU), baseX: pos[i * 3], baseZ: pos[i * 3 + 2] });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffc8dd, size: 0.025, map: getGlowTexture(), transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, toneMapped: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.scene.add(this.dust);

    // 斜向光带
    const beam = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 5.5),
      new THREE.MeshBasicMaterial({ color: 0xff2e63, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
    );
    beam.position.set(1.15, 1.8, -1.1);
    beam.rotation.z = 0.38;
    this.scene.add(beam);
    const beam2 = beam.clone();
    beam2.material = beam.material.clone();
    beam2.material.color.set(0x5af2ff);
    beam2.material.opacity = 0.06;
    beam2.position.set(-1.25, 1.6, -1.2);
    beam2.rotation.z = -0.32;
    this.scene.add(beam2);

    this._resize();
    window.addEventListener('resize', () => this._resize());
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this._resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.fov = rect.width < 380 ? 38 : 34;
    this.camera.updateProjectionMatrix();
  }

  setCharacter(id) {
    const def = CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
    if (this.currentId === id && this.character) return;
    this.currentId = id;
    if (this.character) {
      this.scene.remove(this.character.group);
      this.character.dispose?.();
      this.character = null;
    }
    const ch = buildCharacter(def);
    ch.group.rotation.y = 0.1;
    ch.group.position.y = 0;
    this.scene.add(ch.group);
    this.character = ch;
    ch.update(0.016, { speed: 0, grounded: true, attackPose: 0, castPose: 0, dead: false, frozen: false, firstPerson: false });
    this._setAccent(def.palette.accent);
    this.fill.color.set(def.palette.accent);
    this.floorRing.material.color.set(def.palette.accent);
    this.halo.material.color.set(def.palette.accent);
    this.haloGlow.material.color.set(def.palette.accent);
  }

  _setAccent(color) {
    this.canvas.parentElement?.style.setProperty('--preview-accent', color);
  }

  setActive(active) {
    this.active = active;
    this.canvas.style.opacity = active ? '1' : '0';
  }

  _loop(ts) {
    requestAnimationFrame(this._loop);
    if (!this.active) return;
    if (!this.canvas.offsetWidth || !this.canvas.offsetHeight) return;
    const now = ts * 0.001;
    const dt = Math.min(0.05, now - (this._last || now));
    this._last = now;
    this.time += dt;
    const t = this.time;
    if (this.character) {
      this.character.group.rotation.y = 0.13 + Math.sin(t * 0.28) * 0.16;
      this.character.group.position.y = Math.sin(t * 0.9) * 0.012;
      this.character.update(dt, {
        speed: 0, grounded: true, attackPose: 0, castPose: 0, hurt: false,
        dead: false, frozen: false, firstPerson: false,
      });
    }
    this.halo.rotation.z = t * 0.05;
    this.haloGlow.material.opacity = 0.12 + Math.sin(t * 0.8) * 0.025;
    this.fill.intensity = 15 + Math.sin(t * 1.7) * 4;
    this.camera.position.x = Math.sin(t * 0.18) * 0.07;
    this.camera.position.y = 1.12 + Math.sin(t * 0.33) * 0.018;
    this.camera.lookAt(0, 1.03, 0);

    const arr = this.dust.geometry.attributes.position.array;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.y += p.speed * dt;
      if (p.y > 3.4) p.y = 0.05;
      arr[i * 3] = p.baseX + Math.sin(t * 0.5 + p.phase) * 0.1;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.baseZ + Math.cos(t * 0.4 + p.phase) * 0.08;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  generatePortraits() {
    const width = 300, height = 400;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) {
      return {};
    }
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, width / height, 0.1, 30);
    camera.position.set(0, 1.16, 4.1);
    camera.lookAt(0, 1.03, 0);
    scene.add(new THREE.HemisphereLight(0xd6dcff, 0x2a1022, 2.1));
    const key = new THREE.DirectionalLight(0xffe0ea, 4.2);
    key.position.set(-2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6ff4ff, 3.2);
    rim.position.set(3, 2, -3);
    scene.add(rim);
    const fill = new THREE.PointLight(0xff456f, 22, 10, 2);
    fill.position.set(-1.8, 1.2, 2);
    scene.add(fill);
    const portraits = {};
    for (const def of CHARACTERS) {
      const ch = buildCharacter(def);
      ch.group.rotation.y = 0.06;
      ch.update(0.016, { speed: 0, grounded: true, attackPose: 0, castPose: 0, dead: false, frozen: false, firstPerson: false });
      scene.add(ch.group);
      fill.color.set(def.palette.accent);
      renderer.render(scene, camera);
      portraits[def.id] = renderer.domElement.toDataURL('image/png');
      scene.remove(ch.group);
      ch.dispose?.();
    }
    renderer.dispose();
    renderer.forceContextLoss?.();
    return portraits;
  }

  dispose() {
    if (this.character) this.character.dispose?.();
    this.renderer.dispose();
  }
}
