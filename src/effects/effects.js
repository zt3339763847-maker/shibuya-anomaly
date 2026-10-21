import * as THREE from 'three';
import { TAU, clamp, lerp, rand, randInt, choose } from '../core/utils.js';
import { getGlowTexture, basicGlow, spriteGlow } from '../render/toon.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (230.0 / max(0.5, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uTex, gl_PointCoord);
    if (t.a < 0.01) discard;
    gl_FragColor = vec4(vColor, t.a * vAlpha);
  }
`;

const BH_VERT = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormalV = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const BH_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec3 vNormalV;
  varying vec3 vView;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  void main(){
    float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vView))), 2.3);
    float swirl = sin(vUv.x * 18.0 - uTime * 6.0 + vUv.y * 12.0) * 0.5 + 0.5;
    float ring = smoothstep(0.32, 0.5, abs(fract(vUv.y * 2.0 - uTime * 0.18) - 0.5));
    vec3 col = mix(uColorB, uColorA, fres * 1.4 + swirl * 0.2);
    float a = clamp(fres * 0.9 + swirl * 0.08, 0.0, 1.0);
    gl_FragColor = vec4(col * (1.2 + swirl * 0.5), a);
  }
`;

const GRID_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
const GRID_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  float line(float v, float n){ float f = fract(v * n); return smoothstep(0.0, 0.035, f) * smoothstep(0.0, 0.035, 1.0 - f); }
  void main(){
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    if(d > 1.0) discard;
    float grid = max(line(vUv.x, 22.0), line(vUv.y, 22.0));
    float ring = smoothstep(0.9, 0.96, d) + smoothstep(0.46, 0.49, d) * 0.5;
    float scan = smoothstep(0.0, 0.08, abs(fract(d * 2.2 - uTime * 0.35) - 0.0));
    float alpha = (grid * 0.4 + ring * 0.8) * (1.0 - smoothstep(0.7, 1.0, d)) * uOpacity;
    alpha *= 0.75 + sin(uTime * 3.0 + d * 14.0) * 0.25;
    gl_FragColor = vec4(uColor, alpha * 0.8);
  }
`;

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.items = [];
    this.root = new THREE.Group();
    this.root.name = 'effects';
    scene.add(this.root);
  }

  addItem(object, duration, updateFn = null, opts = {}) {
    if (object.parent !== this.root && !opts.keepParent) this.root.add(object);
    const item = {
      object,
      life: duration,
      maxLife: duration,
      age: 0,
      updateFn,
      disposed: false,
      kill: () => this.killItem(item),
    };
    this.items.push(item);
    return item;
  }

  killItem(item) {
    if (!item || item.disposed) return;
    item.disposed = true;
    item.object?.removeFromParent?.();
    if (item.object) this.disposeObject(item.object);
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  disposeObject(obj) {
    if (!obj || !obj.traverse) return;
    obj.traverse?.((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map && m.map !== getGlowTexture()) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.disposed) continue;
      item.age += dt;
      item.life -= dt;
      if (item.updateFn) item.updateFn(item, dt, item.age / item.maxLife);
      if (item.life <= 0) this.killItem(item);
    }
  }

  clear() {
    for (const item of [...this.items]) this.killItem(item);
  }

  /* ---------------------------------------------------------- particles */
  particleBurst(position, color = 0xffffff, count = 24, opts = {}) {
    const {
      speed = 7, life = 0.7, size = 0.22, gravity = 6, drag = 1.6,
      spread = 1, up = 0.2, opacity = 1, additive = true, direction = null, cone = 1,
    } = opts;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const velocities = new Float32Array(count * 3);
    const lives = new Float32Array(count);
    const c = new THREE.Color(color);
    const c2 = new THREE.Color(opts.color2 || color);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = position.x + rand(-0.08, 0.08);
      positions[i3 + 1] = position.y + rand(-0.08, 0.08);
      positions[i3 + 2] = position.z + rand(-0.08, 0.08);
      let vx, vy, vz;
      if (direction) {
        _v.copy(direction).normalize();
        const s = rand(0.2, 1) * speed;
        vx = _v.x * s + rand(-spread, spread) * speed * 0.35;
        vy = _v.y * s + rand(-spread, spread) * speed * 0.35 + up * speed;
        vz = _v.z * s + rand(-spread, spread) * speed * 0.35;
      } else {
        const theta = rand(0, TAU);
        const phi = Math.acos(rand(-1, 1) * cone);
        const s = rand(0.15, 1) * speed;
        vx = Math.sin(phi) * Math.cos(theta) * s;
        vy = Math.cos(phi) * s * spread + up * speed;
        vz = Math.sin(phi) * Math.sin(theta) * s;
      }
      velocities[i3] = vx;
      velocities[i3 + 1] = vy;
      velocities[i3 + 2] = vz;
      const mix = Math.random();
      colors[i3] = lerp(c.r, c2.r, mix);
      colors[i3 + 1] = lerp(c.g, c2.g, mix);
      colors[i3 + 2] = lerp(c.b, c2.b, mix);
      sizes[i] = size * rand(0.5, 1.5);
      alphas[i] = opacity;
      lives[i] = life * rand(0.7, 1.15);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: getGlowTexture() } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexColors: true,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    const item = this.addItem(points, life * 1.15, (it, d, t) => {
      const pos = geo.attributes.position.array;
      const alpha = geo.attributes.aAlpha.array;
      const sz = geo.attributes.aSize.array;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        lives[i] -= d;
        if (lives[i] <= 0) { alpha[i] = 0; continue; }
        velocities[i3 + 1] -= gravity * d;
        const dr = Math.exp(-drag * d);
        velocities[i3] *= dr; velocities[i3 + 2] *= dr;
        pos[i3] += velocities[i3] * d;
        pos[i3 + 1] += velocities[i3 + 1] * d;
        pos[i3 + 2] += velocities[i3 + 2] * d;
        alpha[i] = clamp(lives[i] / life, 0, 1) * opacity;
        sz[i] += d * 0.06;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
    });
    return item;
  }

  /* ---------------------------------------------------------- rings */
  ring(position, color = 0xffffff, opts = {}) {
    const {
      radius = 5, duration = 0.55, y = 0.04, thickness = 0.14,
      opacity = 0.85, vertical = false, quaternion = null, billboard = false,
    } = opts;
    const geo = new THREE.RingGeometry(Math.max(0.01, 1 - thickness), 1, 64);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(position);
    ring.position.y += vertical ? 0 : y;
    if (vertical) ring.rotation.x = 0;
    else ring.rotation.x = -Math.PI / 2;
    if (quaternion) ring.quaternion.copy(quaternion);
    if (billboard && this.camera) ring.quaternion.copy(this.camera.quaternion);
    ring.scale.setScalar(0.2);
    const item = this.addItem(ring, duration, (it, d, t) => {
      const s = 0.2 + (1 - Math.pow(1 - t, 2.2)) * radius;
      it.object.scale.setScalar(s);
      it.object.material.opacity = (1 - t) * opacity;
    });
    return item;
  }

  shockwave(position, color = 0xffffff, opts = {}) {
    const maxRadius = opts.radius || 7;
    this.ring(position, color, { radius: maxRadius, duration: opts.duration || 0.65, thickness: 0.09, opacity: 0.75 });
    this.ring(position, 0xffffff, { radius: maxRadius * 0.55, duration: 0.38, thickness: 0.035, opacity: 0.9 });
    this.particleBurst(_v.copy(position).setY(position.y + 0.1), color, opts.count || 34, {
      speed: maxRadius * 1.1, life: 0.85, size: 0.28, gravity: 8, drag: 2.4, up: 0.3, color2: 0xffffff,
    });
    this.lightFlash(position, color, opts.light || 5, 0.35);
    if (opts.dust !== false) this.dustRing(position, color, maxRadius);
  }

  dustRing(position, color = 0xbbbbcc, radius = 4) {
    const count = 52;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + rand(-0.1, 0.1);
      const r = rand(0.1, 0.7);
      pos[i * 3] = position.x + Math.cos(a) * r;
      pos[i * 3 + 1] = position.y + rand(0.02, 0.3);
      pos[i * 3 + 2] = position.z + Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color, size: 0.4, map: getGlowTexture(), transparent: true, opacity: 0.32,
      depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true, toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    const item = this.addItem(points, 1.2, (it, d, t) => {
      it.object.material.opacity = (1 - t) * 0.3;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        const r = 0.3 + t * radius;
        geo.attributes.position.array[i * 3] = position.x + Math.cos(a) * r;
        geo.attributes.position.array[i * 3 + 2] = position.z + Math.sin(a) * r;
      }
      geo.attributes.position.needsUpdate = true;
    });
    return item;
  }

  lightFlash(position, color, intensity = 5, duration = 0.4) {
    const light = new THREE.PointLight(color, intensity, 18, 2);
    light.position.copy(position);
    light.position.y += 1.2;
    this.scene.add(light);
    return this.addItem(light, duration, (it, d, t) => {
      it.object.intensity = intensity * (1 - t) ** 2;
    }, { keepParent: true });
  }

  /* ---------------------------------------------------------- impact */
  impact(position, color = 0xffffff, opts = {}) {
    this.particleBurst(position, color, opts.count || 16, {
      speed: opts.speed || 6, life: 0.4, size: 0.18, gravity: 5, spread: 1, color2: 0xffffff,
    });
    const ring = this.ring(position, color, {
      radius: opts.radius || 1.2, duration: 0.3, thickness: 0.16, billboard: !!opts.billboard, opacity: 0.8,
    });
    if (opts.heavy) {
      this.lightFlash(position, color, 6, 0.25);
      this.ring(position, color, { radius: (opts.radius || 1.2) * 1.8, duration: 0.45, thickness: 0.05, opacity: 0.5 });
    }
    return ring;
  }

  slash(position, color = 0xffffff, opts = {}) {
    const radius = opts.radius || 3.2;
    const angle = opts.angle || Math.PI * 1.2;
    const geo = new THREE.RingGeometry(radius * 0.62, radius, 44, 1, -angle / 2, angle);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    if (opts.quaternion) mesh.quaternion.copy(opts.quaternion);
    else if (this.camera) {
      mesh.quaternion.copy(this.camera.quaternion);
      mesh.rotateZ(rand(-0.7, 0.7));
    }
    const item = this.addItem(mesh, opts.duration || 0.32, (it, d, t) => {
      it.object.material.opacity = (1 - t) * 0.9;
      it.object.scale.setScalar(0.7 + t * 0.45);
      it.object.rotateZ(d * (opts.spin || 5));
    });
    this.particleBurst(position, color, 8, { speed: 3.5, life: 0.35, size: 0.12, gravity: 0 });
    return item;
  }

  beam(start, end, color = 0xffffff, opts = {}) {
    const width = opts.width || 0.08;
    const dir = _v.copy(end).sub(start);
    const length = dir.length();
    if (length < 0.01) return null;
    const group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(width, width, length, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const core = new THREE.Mesh(geo, mat);
    _q.setFromUnitVectors(Y_AXIS, dir.clone().normalize());
    core.quaternion.copy(_q);
    core.position.copy(start).add(end).multiplyScalar(0.5);
    group.add(core);
    const glowMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.23, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(width * 4.2, width * 4.2, length, 8, 1, true), glowMat);
    glow.quaternion.copy(_q);
    glow.position.copy(core.position);
    group.add(glow);
    const sprite = spriteGlow(color, 1.8, 0.8);
    sprite.position.copy(end);
    group.add(sprite);
    const item = this.addItem(group, opts.duration || 0.18, (it, d, t) => {
      it.object.children.forEach((c) => {
        if (c.material && c.material.opacity !== undefined) c.material.opacity *= 1 - d * 10;
        if (c.isSprite) c.material.opacity *= 1 - d * 8;
      });
      it.object.scale.x = 1 + (1 - t) * 0.2;
      it.object.scale.z = 1 + (1 - t) * 0.2;
    });
    this.lightFlash(start, color, 3.5, 0.18);
    return item;
  }

  /* ---------------------------------------------------------- movement */
  afterimage(character, color = 0xffffff, opts = {}) {
    if (!character?.group) return null;
    const ghostGroup = character.group.clone(true);
    ghostGroup.traverse((o) => {
      if (o === ghostGroup) return;
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.material = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        });
      }
    });
    // remove clones of ground aura & shadow to keep silhouette clean
    ghostGroup.children.forEach((c) => {
      if (c.geometry && (c.geometry.type === 'RingGeometry' || c.geometry.type === 'CircleGeometry')) c.visible = false;
    });
    this.root.add(ghostGroup);
    const duration = opts.duration || 0.45;
    const item = this.addItem(ghostGroup, duration, (it, d, t) => {
      it.object.traverse((o) => {
        if (o.isMesh && o.material) o.material.opacity = (1 - t) * 0.28;
      });
    }, { keepParent: true });
    return item;
  }

  dashTrail(character, color, duration = 0.4) {
    // 使用 Effects 生命周期中的计时器，避免 setTimeout 在比赛清理后继续克隆已销毁模型
    const timer = new THREE.Group();
    const times = [0, 0.05, 0.1];
    let elapsed = 0;
    let spawned = 0;
    this.addItem(timer, duration + 0.2, (item, dt) => {
      elapsed += dt;
      while (spawned < times.length && elapsed >= times[spawned]) {
        if (character?.group) this.afterimage(character, color, { duration: duration * (1 - spawned * 0.16) });
        spawned++;
      }
    }, { keepParent: true });
  }

  teleportBurst(position, color = 0x5af2ff) {
    this.particleBurst(position, color, 30, { speed: 5, life: 0.55, size: 0.2, gravity: -1, up: 0.1, color2: 0xffffff });
    this.ring(position, color, { radius: 1.6, duration: 0.4, thickness: 0.06, vertical: true, billboard: true });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(rand(0.5, 1.3), 0.015, 8, 32),
        basicGlow(color, 0.8)
      );
      ring.position.copy(position).setY(position.y + 1.1);
      ring.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      this.addItem(ring, 0.5, (it, d, t) => {
        it.object.scale.setScalar(1 + t * 1.2);
        it.object.material.opacity = (1 - t) * 0.8;
        it.object.rotation.x += d * 2;
      });
    }
  }

  portal(position, color = 0x5af2ff, opts = {}) {
    const group = new THREE.Group();
    group.position.copy(position);
    const scale = opts.scale || 1;
    group.scale.setScalar(scale);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.04, 8, 48), mat);
    torus.rotation.y = Math.PI / 2;
    group.add(torus);
    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(0.86, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    inner.rotation.y = Math.PI / 2;
    group.add(inner);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.014, 6, 48), basicGlow(color, 0.55));
    ring2.rotation.set(0.4, Math.PI / 2, 0.3);
    group.add(ring2);
    if (opts.billboard) group.quaternion.copy(this.camera.quaternion);
    const duration = opts.duration || 1.1;
    const item = this.addItem(group, duration, (it, d, t) => {
      it.object.rotation.z += d * 1.7;
      it.object.children[1].rotation.z -= d * 2.8;
      it.object.children[0].material.opacity = Math.sin(Math.min(1, t * 2) * Math.PI) * 0.85;
      it.object.children[2].rotation.y += d * 3;
    });
    return item;
  }

  cloisterPortals(center, color = 0x5af2ff, opts = {}) {
    const items = [];
    const count = opts.count || 12;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const r = rand(2.5, opts.radius || 9);
      const p = new THREE.Vector3(center.x + Math.sin(a) * r, center.y + rand(0.5, 4.5), center.z + Math.cos(a) * r);
      const item = this.portal(p, color, { duration: rand(0.6, 2.1), scale: rand(0.45, 1.1) });
      items.push(item);
    }
    return items;
  }

  /* ---------------------------------------------------------- black hole */
  blackHole(position, color = 0xa973ff, opts = {}) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y += opts.yOffset || 1.8;
    const duration = opts.duration || 3;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false })
    );
    group.add(core);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 32, 24),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: new THREE.Color(color) },
          uColorB: { value: new THREE.Color(0xffffff) },
        },
        vertexShader: BH_VERT,
        fragmentShader: BH_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    halo.scale.setScalar(1.8);
    group.add(halo);
    const rings = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.4 + i * 0.28, 0.018, 8, 64),
        basicGlow(i % 2 ? 0xffffff : color, 0.55)
      );
      ring.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      group.add(ring);
      rings.push(ring);
    }
    const light = new THREE.PointLight(color, 10, 24, 2);
    group.add(light);
    const particles = [];
    for (let i = 0; i < 28; i++) {
      const p = spriteGlow(i % 3 ? color : 0xffffff, rand(0.08, 0.28), 0.7);
      const angle = rand(0, TAU);
      const r = rand(1.5, 5.5);
      p.position.set(Math.cos(angle) * r, rand(-1.8, 1.8), Math.sin(angle) * r);
      p.userData = { angle, r, speed: rand(0.6, 2), y: p.position.y };
      group.add(p);
      particles.push(p);
    }
    group.scale.setScalar(0.05);
    const item = this.addItem(group, duration, (it, d, t) => {
      const grow = Math.min(1, it.age / 0.4);
      const fade = clamp(it.life / 0.55, 0, 1);
      it.object.scale.setScalar((0.3 + grow * 0.9) * (0.9 + Math.sin(it.age * 9) * 0.015));
      halo.material.uniforms.uTime.value = it.age;
      halo.material.opacity = 0.85 * fade;
      rings.forEach((r, i) => {
        r.rotation.x += d * (0.7 + i * 0.25);
        r.rotation.y += d * (0.5 + i * 0.2);
        r.scale.setScalar(1 + Math.sin(it.age * 2 + i) * 0.06);
      });
      particles.forEach((p, i) => {
        p.userData.angle += d * p.userData.speed;
        p.userData.r = Math.max(0.55, p.userData.r - d * 1.8);
        p.position.set(Math.cos(p.userData.angle) * p.userData.r, p.userData.y + Math.sin(it.age * 2 + i) * 0.3, Math.sin(p.userData.angle) * p.userData.r);
        p.material.opacity = 0.55 * fade;
      });
      light.intensity = (8 + Math.sin(it.age * 12) * 3) * fade;
    });
    this.ring(position, color, { radius: opts.radius || 8, duration: 0.8, thickness: 0.035, opacity: 0.5 });
    this.ring(position, 0xffffff, { radius: opts.radius * 0.7 || 5.6, duration: 0.5, thickness: 0.02, opacity: 0.5 });
    return item;
  }

  /* ---------------------------------------------------------- trap / field */
  netTrap(position, color = 0x35ffcf, opts = {}) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y = opts.y ?? 0.04;
    const radius = opts.radius || 2.4;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius * (0.28 + i * 0.28), radius * (0.31 + i * 0.28), 48), mat.clone());
      ring.rotation.x = -Math.PI / 2;
      group.add(ring);
    }
    const lineGeo = new THREE.BufferGeometry();
    const arr = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      arr.push(0, 0, 0, Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    group.add(lines);
    const core = spriteGlow(color, radius * 1.8, 0.22);
    core.position.y = 0.02;
    core.rotation.x = -Math.PI / 2;
    group.add(core);
    const item = this.addItem(group, opts.duration || 20, (it, d, t) => {
      it.object.rotation.y += d * 0.12;
      const pulse = 0.55 + Math.sin(it.age * 3.2) * 0.15;
      it.object.children.forEach((c) => {
        if (c.material) c.material.opacity = 0.26 * pulse * (it.life < 1 ? it.life : 1);
      });
      if (opts.triggered) {
        it.object.children.forEach((c) => { c.material.color.set(0xffffff); c.material.opacity *= 1.4; });
      }
    });
    return item;
  }

  barrier(target, color = 0x5af2ff, duration = 4) {
    const group = new THREE.Group();
    group.position.y = 1.05;
    const sphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.15, 1),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.09, wireframe: false,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      })
    );
    group.add(sphere);
    const wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.18, 1),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.28, wireframe: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    group.add(wire);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.012, 6, 48), basicGlow(0xffffff, 0.6));
      ring.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      group.add(ring);
    }
    const parent = target.visual?.group || target.group;
    if (!parent) return null;
    parent.add(group);
    const item = this.addItem(group, duration, (it, d, t) => {
      it.object.rotation.y += d * 0.65;
      it.object.rotation.x = Math.sin(it.age * 0.8) * 0.15;
      const alpha = it.life < 0.5 ? it.life * 2 : 1;
      it.object.children.forEach((c) => { if (c.material) c.material.opacity = c.material.wireframe ? 0.28 * alpha : 0.09 * alpha; });
    }, { keepParent: true });
    item.object.userData.isAttached = true;
    return item;
  }

  matrixField(center, color = 0x35ffcf, opts = {}) {
    const radius = opts.radius || 16;
    const duration = opts.duration || 8;
    const group = new THREE.Group();
    group.position.copy(center);
    group.position.y = 0.06;
    const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, 1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.75 } },
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;
    group.add(plane);
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.94, radius, 80), basicGlow(color, 0.5));
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    const item = this.addItem(group, duration, (it, d, t) => {
      mat.uniforms.uTime.value = it.age;
      mat.uniforms.uOpacity.value = 0.8 * Math.min(1, it.life / 1.2) * Math.min(1, it.age / 0.5);
      it.object.rotation.y += d * 0.04;
      ring.material.opacity = 0.3 + Math.sin(it.age * 2) * 0.12;
    });
    return item;
  }

  linkLine(a, b, color = 0x35ffcf, duration = 8) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const line = new THREE.Line(geo, mat);
    return this.addItem(line, duration, (it, d, t) => {
      it.object.material.opacity = 0.4 + Math.sin(it.age * 5) * 0.1;
      const positions = it.object.geometry.attributes.position.array;
      positions[0] = a.x; positions[1] = a.y; positions[2] = a.z;
      positions[3] = b.x; positions[4] = b.y; positions[5] = b.z;
      it.object.geometry.attributes.position.needsUpdate = true;
    });
  }

  shockRingAt(position, color, radius = 4) {
    return this.ring(position, color, { radius, duration: 0.55, thickness: 0.07, opacity: 0.65 });
  }

  itemBeam(start, end, color, duration = 0.4) {
    return this.beam(start, end, color, { duration, width: 0.05 });
  }

  castAura(character, color = 0xffffff, duration = 0.6) {
    const pos = character.pos || character.group.position;
    this.ring(pos, color, { radius: 2.8, duration, thickness: 0.03, opacity: 0.4 });
    this.particleBurst(_v.copy(pos).setY(pos.y + 0.8), color, 22, {
      speed: 2.4, life: 0.7, size: 0.15, gravity: -3, up: 1.0, spread: 0.7,
    });
  }

  hitSpark(position, color, damage) {
    const heavy = damage > 60;
    this.impact(position, color, { count: heavy ? 26 : 14, speed: heavy ? 9 : 5, radius: heavy ? 1.9 : 1.1, heavy });
  }

  dispose() {
    this.clear();
    this.scene.remove(this.root);
  }
}


