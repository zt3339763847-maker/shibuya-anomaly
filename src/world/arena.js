import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TAU, clamp, damp, rand, randInt, seeded, canvasTexture, choose } from '../core/utils.js';
import { createToonMaterial, toonMesh, basicGlow, spriteGlow, getGradientMap, getGlowTexture } from '../render/toon.js';

const ARENA_HALF = 22;
const SPAWNS = [
  { x: -16, y: 0.1, z: -16 },
  { x: 16, y: 0.1, z: -16 },
  { x: -16, y: 0.1, z: 16 },
  { x: 16, y: 0.1, z: 16 },
  { x: 0, y: 0.1, z: -17 },
  { x: 0, y: 0.1, z: 17 },
];

export class Arena {
  constructor(scene, world, effects) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.group = new THREE.Group();
    this.group.name = 'shibuya-arena';
    scene.add(this.group);
    this.statics = [];
    this.breakables = [];
    this.debris = [];
    this.hitFlashes = [];
    this.animated = [];
    this.dust = null;
    this.spawnPoints = SPAWNS.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.arenaHalf = ARENA_HALF;
    this.killY = -7.5;
    this.time = 0;
    this._neonSigns = [];
    this._build();
  }

  /* --------------------------------------------------------------- helpers */
  addStaticBox(x, y, z, hx, hy, hz, opts = {}) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    if (opts.rotation) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...opts.rotation));
      body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    }
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(opts.friction ?? 0.8).setRestitution(opts.restitution ?? 0.05),
      body
    );
    this.statics.push({ body, col });
    return { body, col };
  }

  addStaticCylinder(x, y, z, halfHeight, radius) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const col = this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, radius).setFriction(0.7), body);
    this.statics.push({ body, col });
    return { body, col };
  }

  makeMaterial(color, opts = {}) {
    return createToonMaterial(color, { rim: 0.09, ...opts });
  }

  addMesh(parent, geo, color, opts = {}) {
    const m = toonMesh(geo, color, {
      rim: opts.rim ?? 0.08,
      outline: opts.outline !== false,
      outlineScale: opts.outlineScale ?? 1.018,
      ...opts,
    });
    if (opts.position) m.position.set(...opts.position);
    if (opts.rotation) m.rotation.set(...opts.rotation);
    if (opts.scale) m.scale.set(...opts.scale);
    parent.add(m);
    return m;
  }

  /* --------------------------------------------------------------- build */
  _build() {
    this._buildSky();
    this._buildLights();
    this._buildStreet();
    this._buildRooftop();
    this._buildSkyline();
    this._buildNeon();
    this._buildProps();
    this._buildBreakables();
    this._buildDust();
    this._buildSigns();
  }

  _buildSky() {
    const uniforms = {
      uTop: { value: new THREE.Color('#080914') },
      uMid: { value: new THREE.Color('#22162e') },
      uBottom: { value: new THREE.Color('#48243b') },
      uGlow: { value: new THREE.Color('#ff4e7b') },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform vec3 uGlow; uniform float uTime;
        varying vec3 vDir;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main(){
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uBottom, uMid, smoothstep(0.38, 0.62, h));
          col = mix(col, uTop, smoothstep(0.58, 0.98, h));
          float horizon = exp(-abs(vDir.y) * 9.0) * smoothstep(-0.4, 0.15, vDir.x);
          col += uGlow * horizon * 0.14;
          vec3 cell = floor(vDir * 420.0);
          float star = step(0.9975, hash(cell));
          float tw = 0.55 + 0.45 * sin(uTime * 1.7 + hash(cell) * 30.0);
          col += vec3(0.8, 0.86, 1.0) * star * tw * smoothstep(0.18, 0.6, vDir.y) * 0.8;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(260, 40, 24), mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.animated.push((dt, t) => { uniforms.uTime.value = t; });

    // 血月
    const moon = new THREE.Group();
    moon.position.set(-72, 68, -150);
    const moonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(16, 48),
      new THREE.MeshBasicMaterial({ color: 0xffe4ef, transparent: true, opacity: 0.82, toneMapped: false, fog: false })
    );
    moon.add(moonDisc);
    const moonGlow = spriteGlow(0xffa9c5, 70, 0.2);
    moon.add(moonGlow);
    const moonHalo = new THREE.Mesh(new THREE.RingGeometry(16.2, 19.2, 48), basicGlow(0xff6f9f, 0.18));
    moon.add(moonHalo);
    moon.lookAt(0, 15, 0);
    this.scene.add(moon);
    this.animated.push((dt, t) => { moonGlow.material.opacity = 0.18 + Math.sin(t * 0.7) * 0.03; });
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xc8d7ff, 0x3a2030, 2.05);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe4ee, 3.35);
    key.position.set(-24, 36, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -30;
    key.shadow.camera.right = 30;
    key.shadow.camera.top = 30;
    key.shadow.camera.bottom = -30;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 100;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    this.keyLight = key;
    const fill = new THREE.DirectionalLight(0x8fa1ff, 1.65);
    fill.position.set(20, 18, -24);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xff4d84, 30, 34, 2);
    rim.position.set(-10, 8, -10);
    this.scene.add(rim);
    this.rimLight = rim;
    const cyan = new THREE.PointLight(0x5af2ff, 22, 28, 2);
    cyan.position.set(14, 5, 9);
    this.scene.add(cyan);
  }

  _buildStreet() {
    const streetTex = canvasTexture(1024, 1024, (ctx, w, h) => {
      ctx.fillStyle = '#101018';
      ctx.fillRect(0, 0, w, h);
      // 路面噪声
      for (let i = 0; i < 5000; i++) {
        const v = 10 + Math.random() * 30;
        ctx.fillStyle = `rgba(${v},${v},${v + 5},${Math.random() * 0.22})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 1 + Math.random() * 3);
      }
      // 交叉斑马线
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(220,214,210,.45)';
      for (let i = -8; i <= 8; i++) {
        ctx.fillRect(i * 42 - 14, -260, 24, 520);
        ctx.fillRect(-260, i * 42 - 14, 520, 24);
      }
      ctx.restore();
      // 道路线
      ctx.strokeStyle = 'rgba(255,195,80,.38)';
      ctx.lineWidth = 6;
      ctx.setLineDash([44, 32]);
      ctx.beginPath();
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.stroke();
      // 霓虹水洼
      for (let i = 0; i < 12; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 20 + Math.random() * 60);
        g.addColorStop(0, Math.random() > 0.5 ? 'rgba(90,242,255,.14)' : 'rgba(255,46,99,.14)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(x, y, 40 + Math.random() * 70, 14 + Math.random() * 25, Math.random(), 0, TAU); ctx.fill();
      }
    }, { repeat: [2, 2], anisotropy: 8 });
    const street = new THREE.Mesh(
      new THREE.PlaneGeometry(95, 95),
      new THREE.MeshStandardMaterial({ map: streetTex, roughness: 0.82, metalness: 0.18, color: 0x6a6678 })
    );
    street.rotation.x = -Math.PI / 2;
    street.position.y = -17;
    street.receiveShadow = true;
    this.group.add(street);
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.95 })
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = -17.2;
    this.group.add(under);

    // 街道上的车灯与路灯
    for (let i = 0; i < 9; i++) {
      const x = rand(-38, 38);
      const z = rand(-38, 38);
      if (Math.abs(x) < 22 && Math.abs(z) < 22) continue;
      const light = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.25), basicGlow(i % 2 ? 0xff3558 : 0x5af2ff, 0.8));
      light.position.set(x, -16.88, z);
      this.group.add(light);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4, 6), this.makeMaterial('#282633'));
      pole.position.set(x, -14.9, z);
      this.group.add(pole);
      const lamp = spriteGlow(i % 2 ? 0xff6b8b : 0x8ef8ff, 2.4, 0.34);
      lamp.position.set(x, -12.8, z);
      this.group.add(lamp);
    }

    // 道路护栏
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * TAU;
      const x = Math.cos(angle) * 35;
      const z = Math.sin(angle) * 35;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 0.08), this.makeMaterial('#454456'));
      rail.position.set(x, -16.2, z);
      rail.rotation.y = -angle;
      this.group.add(rail);
    }
  }

  _buildRooftop() {
    const floorTex = canvasTexture(1024, 1024, (ctx, w, h) => {
      ctx.fillStyle = '#4a4755';
      ctx.fillRect(0, 0, w, h);
      // 混凝土斑驳
      for (let i = 0; i < 12000; i++) {
        const v = 40 + Math.random() * 45;
        ctx.fillStyle = `rgba(${v},${v - 2},${v + 7},${Math.random() * 0.28})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 5, 1 + Math.random() * 4);
      }
      // 分块接缝
      ctx.strokeStyle = 'rgba(18,16,24,.55)';
      ctx.lineWidth = 3;
      const cell = 128;
      for (let x = 0; x <= w; x += cell) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y <= h; y += cell) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      // 裂缝
      for (let i = 0; i < 28; i++) {
        ctx.strokeStyle = `rgba(10,9,15,${rand(0.25, 0.6)})`;
        ctx.lineWidth = rand(1, 4);
        ctx.beginPath();
        let x = rand(0, w), y = rand(0, h);
        ctx.moveTo(x, y);
        for (let j = 0; j < 8; j++) {
          x += rand(-55, 55); y += rand(-35, 55);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // 轮胎痕
      ctx.strokeStyle = 'rgba(16,14,20,.2)';
      ctx.lineWidth = 22;
      ctx.beginPath(); ctx.arc(w * 0.62, h * 0.38, 250, 0.2, 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(w * 0.62, h * 0.38, 286, 0.2, 1.9); ctx.stroke();
      // 危险条纹
      ctx.save();
      ctx.translate(w * 0.5, h * 0.86);
      ctx.rotate(-0.06);
      for (let i = -10; i < 10; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(255,201,72,.45)' : 'rgba(18,16,22,.3)';
        ctx.fillRect(i * 36, -12, 22, 24);
      }
      ctx.restore();
      // 中央咒纹
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.strokeStyle = 'rgba(210,180,255,.14)';
      ctx.lineWidth = 3;
      for (let r = 80; r <= 280; r += 80) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
      for (let i = 0; i < 8; i++) {
        ctx.rotate(TAU / 8);
        ctx.beginPath(); ctx.moveTo(80, 0); ctx.lineTo(280, 0); ctx.stroke();
        ctx.fillStyle = 'rgba(255,70,110,.16)';
        ctx.fillRect(266, -5, 18, 10);
      }
      ctx.restore();
      // 日文涂鸦
      ctx.save();
      ctx.translate(w * 0.19, h * 0.72);
      ctx.rotate(-0.12);
      ctx.font = 'bold 54px "Yu Gothic", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(255,46,99,.23)';
      ctx.fillText('領域展開', 0, 0);
      ctx.font = 'bold 22px "Yu Gothic", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.17)';
      ctx.fillText('SHIBUYA / 渋谷', 2, 40);
      ctx.restore();
    }, { anisotropy: 8 });
    this.floorTex = floorTex;
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF * 2, 0.6, ARENA_HALF * 2),
      new THREE.MeshStandardMaterial({ map: floorTex, color: 0xaaa4b7, roughness: 0.77, metalness: 0.05 })
    );
    top.position.y = -0.3;
    top.receiveShadow = true;
    top.castShadow = false;
    this.group.add(top);
    this.floorMesh = top;
    this.addStaticBox(0, -0.4, 0, ARENA_HALF, 0.4, ARENA_HALF, { friction: 0.92 });

    // 建筑外立面 / 天台厚度
    const exterior = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF * 2 + 2, 20, ARENA_HALF * 2 + 2),
      new THREE.MeshStandardMaterial({ color: 0x25232f, roughness: 0.9, metalness: 0.05, map: this._facadeTexture() })
    );
    exterior.position.y = -10.4;
    this.group.add(exterior);

    // 天台围栏（留有缺口）
    const railMat = this.makeMaterial('#5d596b');
    const edgeSegments = [
      { x: -14, z: -22, w: 12, d: 0.35, rot: 0 }, { x: 1, z: -22, w: 6, d: 0.35, rot: 0 },
      { x: 12, z: -22, w: 10, d: 0.35, rot: 0 }, { x: -19, z: -22, w: 4, d: 0.35, rot: 0 },
      { x: -22, z: -10, w: 0.35, d: 9, rot: 0 }, { x: -22, z: 9, w: 0.35, d: 12, rot: 0 },
      { x: 22, z: -8, w: 0.35, d: 11, rot: 0 }, { x: 22, z: 10, w: 0.35, d: 12, rot: 0 },
      { x: -12, z: 22, w: 14, d: 0.35, rot: 0 }, { x: 11, z: 22, w: 12, d: 0.35, rot: 0 },
    ];
    for (const s of edgeSegments) {
      const geo = new THREE.BoxGeometry(s.w, 1.0, s.d);
      const m = this.addMesh(this.group, geo, '#5d596b', { position: [s.x, 0.5, s.z], outline: true, outlineScale: 1.025 });
      // 金属扶手
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.1, 0.08, 0.08), this.makeMaterial('#8e879c'));
      topRail.position.set(s.x, 1.05, s.z + (s.d > s.w ? 0.18 : 0));
      if (s.d > s.w) { topRail.scale.set(0.1, 1, s.d + 0.1); topRail.position.z = s.z; }
      this.group.add(topRail);
      this.addStaticBox(s.x, 0.55, s.z, s.w / 2, 0.55, Math.max(0.15, s.d / 2), { friction: 0.7 });
    }
    // 断裂的栏杆
    for (let i = 0; i < 5; i++) {
      const rail = this.addMesh(this.group, new THREE.BoxGeometry(0.08, rand(0.4, 1.1), 0.08), '#8a8298', {
        position: [rand(-21, 21), rand(0.25, 0.7), choose([-21.8, 21.8])],
        rotation: [rand(-0.2, 0.2), 0, rand(-0.35, 0.35)], outline: false,
      });
    }
    // 屋顶水渍 / 反光
    for (let i = 0; i < 8; i++) {
      const puddle = new THREE.Mesh(
        new THREE.CircleGeometry(rand(0.8, 2.6), 24),
        new THREE.MeshPhysicalMaterial({ color: 0x2c3048, roughness: 0.12, metalness: 0.6, transparent: true, opacity: 0.45, envMapIntensity: 0.4 })
      );
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(rand(-19, 19), 0.012, rand(-19, 19));
      puddle.scale.y = rand(0.35, 0.8);
      puddle.rotation.z = rand(0, TAU);
      this.group.add(puddle);
    }
  }

  _facadeTexture() {
    const tex = canvasTexture(256, 512, (ctx, w, h) => {
      ctx.fillStyle = '#22212b';
      ctx.fillRect(0, 0, w, h);
      const cols = 7, rows = 18;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const lit = Math.random() > 0.66;
          ctx.fillStyle = lit ? (Math.random() > 0.5 ? 'rgba(255,215,170,.55)' : 'rgba(120,220,255,.4)') : 'rgba(10,11,18,.85)';
          ctx.fillRect(x * 34 + 8, y * 27 + 8, 19, 13);
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      for (let y = 0; y < h; y += 32) ctx.fillRect(0, y, w, 3);
    }, { repeat: [3, 2], anisotropy: 4 });
    return tex;
  }

  _buildSkyline() {
    const rng = seeded(4481);
    const palette = ['#1b1a26', '#22202e', '#191822', '#292438', '#202530'];
    const facades = [];
    for (let i = 0; i < 4; i++) facades.push(this._windowTexture(i));
    for (let i = 0; i < 42; i++) {
      const angle = rng() * TAU;
      const dist = 32 + rng() * 90;
      const w = 6 + rng() * 16;
      const d = 6 + rng() * 16;
      const h = 12 + rng() * 58;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      if (Math.abs(x) < 26 && Math.abs(z) < 26) continue;
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({
        color: palette[Math.floor(rng() * palette.length)],
        map: facades[i % facades.length],
        emissiveMap: facades[i % facades.length],
        emissive: new THREE.Color(i % 3 === 0 ? 0x6090c0 : 0xcf6a8e),
        emissiveIntensity: 0.16 + rng() * 0.18,
        roughness: 0.82,
        metalness: 0.08,
      });
      const b = new THREE.Mesh(geo, mat);
      b.position.set(x, -17 + h / 2, z);
      b.castShadow = false;
      b.receiveShadow = false;
      this.group.add(b);
      // 屋顶航空障碍灯
      if (h > 38 && rng() > 0.5) {
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), basicGlow(0xff335f, 0.9));
        beacon.position.set(x, -17 + h + 0.3, z);
        this.group.add(beacon);
        const base = rng() * 5;
        this.animated.push((dt, t) => { beacon.material.opacity = 0.45 + Math.sin(t * 2.2 + base) * 0.4; });
      }
    }
    // 一些近处建筑，形成峡谷感
    const close = [
      { x: -40, z: -28, w: 18, h: 30, d: 20 },
      { x: 39, z: 16, w: 16, h: 38, d: 18 },
      { x: 18, z: -55, w: 22, h: 46, d: 20 },
      { x: -30, z: 52, w: 26, h: 25, d: 20 },
    ];
    for (const c of close) {
      const mat = new THREE.MeshStandardMaterial({
        color: '#1a1924', map: facades[1], emissiveMap: facades[1], emissive: 0x6d8bbd, emissiveIntensity: 0.22, roughness: 0.8,
      });
      const b = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), mat);
      b.position.set(c.x, -17 + c.h / 2, c.z);
      this.group.add(b);
    }
    // 109 大楼
    const tower = new THREE.Group();
    tower.position.set(40, -17, -30);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(13, 40, 13),
      new THREE.MeshStandardMaterial({ color: '#26232e', map: facades[2], emissiveMap: facades[2], emissive: 0xff4d7a, emissiveIntensity: 0.22, roughness: 0.75 })
    );
    body.position.y = 20;
    tower.add(body);
    const signTex = this._textTexture('109', '#ff2e63', '#16060d', 512, 256, 'bold 190px "Arial Black", sans-serif');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false }));
    sign.position.set(0, 31, 6.65);
    tower.add(sign);
    const signGlow = spriteGlow(0xff2e63, 18, 0.3);
    signGlow.position.set(0, 31, 7.2);
    tower.add(signGlow);
    this.group.add(tower);
    this.animated.push((dt, t) => { signGlow.material.opacity = 0.24 + Math.sin(t * 2.1) * 0.05; });
  }

  _windowTexture(seed) {
    const rng = seeded(700 + seed * 31);
    return canvasTexture(256, 512, (ctx, w, h) => {
      ctx.fillStyle = '#171620';
      ctx.fillRect(0, 0, w, h);
      const cols = 6, rows = 16;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const lit = rng() > 0.52;
          ctx.fillStyle = lit
            ? (rng() > 0.7 ? 'rgba(255,210,160,.78)' : 'rgba(118,220,255,.56)')
            : 'rgba(7,8,12,.92)';
          ctx.fillRect(x * 41 + 8, y * 29 + 7, 24, 15);
          if (lit && rng() > 0.7) {
            ctx.fillStyle = 'rgba(255,255,255,.18)';
            ctx.fillRect(x * 41 + 8, y * 29 + 7, 24, 2);
          }
        }
      }
      // 竖向结构线
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      for (let x = 0; x < w; x += 41) ctx.fillRect(x, 0, 3, h);
      for (let y = 0; y < h; y += 145) ctx.fillRect(0, y, w, 4);
    }, { repeat: [1.4, 1.8], anisotropy: 4 });
  }

  _textTexture(text, color, bg, w = 512, h = 256, font = 'bold 120px "Microsoft YaHei", sans-serif', vertical = false) {
    return canvasTexture(w, h, (ctx) => {
      ctx.clearRect(0, 0, w, h);
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.strokeRect(5, 5, w - 10, h - 10);
      }
      ctx.font = font;
      if (!vertical) {
        let size = parseInt((font.match(/(\d+)px/) || [0, '100'])[1], 10);
        while (size > 16 && ctx.measureText(text).width > w * 0.86) {
          size -= 4;
          ctx.font = font.replace(/\d+px/, `${size}px`);
        }
      }
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = color;
      ctx.shadowBlur = 24;
      if (vertical) {
        const chars = [...text];
        const step = h / (chars.length + 0.4);
        chars.forEach((ch, i) => ctx.fillText(ch, w / 2, step * (i + 0.7)));
      } else {
        ctx.fillText(text, w / 2, h / 2 + 4);
      }
      ctx.shadowBlur = 0;
    });
  }

  _buildNeon() {
    const signs = [
      { text: '渋谷', color: '#ff2e63', bg: 'rgba(20,4,12,.85)', x: -21.6, y: 5.4, z: -4, rotY: Math.PI / 2, w: 2.2, h: 5.2, vertical: true },
      { text: '呪', color: '#a973ff', bg: 'rgba(12,5,20,.82)', x: 21.7, y: 6.4, z: 4, rotY: -Math.PI / 2, w: 2.7, h: 3.8, vertical: false },
      { text: '領域', color: '#5af2ff', bg: 'rgba(3,15,20,.82)', x: 5, y: 4.4, z: 21.7, rotY: Math.PI, w: 2.5, h: 3.2, vertical: true },
      { text: '24H', color: '#ffcf5c', bg: 'rgba(18,12,2,.85)', x: -7, y: 3.2, z: -21.7, rotY: 0, w: 3.2, h: 1.8, vertical: false },
    ];
    for (const s of signs) {
      const tex = this._textTexture(s.text, s.color, s.bg, s.vertical ? 256 : 512, s.vertical ? 512 : 256,
        s.vertical ? 'bold 150px "Yu Gothic", "Microsoft YaHei", sans-serif' : 'bold 150px "Arial Black", sans-serif', s.vertical);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.rotY;
      this.group.add(mesh);
      const glow = spriteGlow(s.color, s.w * 3.4, 0.18);
      glow.position.set(s.x, s.y, s.z);
      this.group.add(glow);
      const phase = rand(0, 6);
      this._neonSigns.push({ mesh, glow, phase, base: 0.2 });
      this.animated.push((dt, t) => {
        const flicker = Math.sin(t * 1.8 + phase) > 0.92 ? 0.25 : 1;
        mat.opacity = 0.85 * flicker;
        glow.material.opacity = 0.15 * flicker + 0.04;
      });
    }

    // 中央天台广告牌
    const board = new THREE.Group();
    board.position.set(0, 0, -18.8);
    const back = new THREE.Mesh(new THREE.BoxGeometry(11, 4.6, 0.4), this.makeMaterial('#17151f'));
    back.position.y = 5.6;
    board.add(back);
    const tex = this._textTexture('SHIBUYA ANOMALY', '#f2ecff', 'rgba(8,7,13,.92)', 1024, 320, 'bold 102px "Arial Black", sans-serif');
    const face = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 3.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    face.position.set(0, 5.6, 0.22);
    board.add(face);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.08, 0.1), basicGlow(0xff2e63, 0.85));
    strip.position.set(0, 3.95, 0.3);
    board.add(strip);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.38, 5.8, 0.38), this.makeMaterial('#383342'));
      leg.position.set(side * 4.9, 2.9, 0);
      board.add(leg);
      this.addStaticBox(side * 4.9 + 0, 2.9, -18.8, 0.2, 2.9, 0.2);
    }
    this.group.add(board);
    this.addStaticBox(0, 5.4, -18.8, 5.5, 2.3, 0.35);
    this.animated.push((dt, t) => { strip.material.opacity = 0.55 + Math.sin(t * 4.2) * 0.3; });
  }

  _buildProps() {
    // 空调外机 / 通风口
    const acPositions = [
      [-15, -6, 0.25], [15, 7, -0.4], [-3, -15, 0.5], [8, 15, 0.1], [-17, 13, 0], [19, -13, 0.3],
    ];
    for (const [x, z, rot] of acPositions) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      const body = this.addMesh(g, new THREE.BoxGeometry(2.1, 1.05, 1.4), '#454352', { position: [0, 0.53, 0], outlineScale: 1.025 });
      const grill = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.55), new THREE.MeshBasicMaterial({ color: 0x181721, toneMapped: false }));
      grill.position.set(0, 0.55, 0.706);
      g.add(grill);
      for (let i = 0; i < 4; i++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.025, 0.02), basicGlow(0x5af2ff, 0.25));
        line.position.set(0, 0.38 + i * 0.12, 0.712);
        g.add(line);
      }
      this.group.add(g);
      this.addStaticBox(x, 0.53, z, 1.05, 0.53, 0.7, { rotation: [0, rot, 0] });
    }

    // 水箱
    const tank = new THREE.Group();
    tank.position.set(16.5, 0, 14);
    const tankBody = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.85, 2.6, 18), this.makeMaterial('#3e3a48'));
    tankBody.position.y = 2.3;
    tankBody.castShadow = true;
    tank.add(tankBody);
    addOutlineSafe(tankBody, 1.012);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.2, 7), this.makeMaterial('#6c6578'));
      const a = (i / 4) * TAU + 0.4;
      leg.position.set(Math.cos(a) * 1.4, 0.6, Math.sin(a) * 1.4);
      tank.add(leg);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.035, 6, 28), basicGlow(0x5af2ff, 0.3));
    band.rotation.x = Math.PI / 2;
    band.position.y = 2.3;
    tank.add(band);
    this.group.add(tank);
    this.addStaticCylinder(16.5, 2.3, 14, 1.3, 1.8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      this.addStaticBox(16.5 + Math.cos(a) * 1.4, 0.6, 14 + Math.sin(a) * 1.4, 0.1, 0.6, 0.1);
    }

    // 通风管道 / 碎石
    for (let i = 0; i < 18; i++) {
      const x = rand(-20, 20);
      const z = rand(-20, 20);
      if (Math.abs(x) < 4 && Math.abs(z) < 4) continue;
      const s = rand(0.12, 0.45);
      const stone = this.addMesh(this.group, new THREE.DodecahedronGeometry(s, 0), choose(['#5d5968', '#4d4a58', '#68616f']), {
        position: [x, s * 0.7, z], rotation: [rand(0, 3), rand(0, 3), rand(0, 3)], outline: false, castShadow: true,
      });
    }

    // 霓虹灯柱
    for (const [x, z, c] of [[-20.5, -18, 0xff2e63], [20.5, 18, 0x5af2ff], [-20.5, 18, 0xa973ff]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 3.4, 6), this.makeMaterial('#3a3644'));
      pole.position.set(x, 1.7, z);
      this.group.add(pole);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), basicGlow(c, 1));
      orb.position.set(x, 3.45, z);
      this.group.add(orb);
      const glow = spriteGlow(c, 4.2, 0.25);
      glow.position.set(x, 3.4, z);
      this.group.add(glow);
      this.animated.push((dt, t) => { glow.material.opacity = 0.18 + Math.sin(t * 2.8 + x) * 0.05; });
      this.addStaticCylinder(x, 1.7, z, 1.7, 0.09);
    }
  }

  _buildBreakables() {
    const columns = [
      [-9.5, -9.5], [9.5, -9.5], [-9.5, 9.5], [9.5, 9.5], [0, -12], [0, 12],
    ];
    columns.forEach(([x, z], i) => this._makeColumn(x, z, i));
    this._makeGlassWall(-7.5, -20.6, 0, 0);
    this._makeGlassWall(7.5, -20.6, 0, 1);
    this._makeGlassWall(-17.5, -4.5, Math.PI / 2, 2);
    this._makeCar(-16, 6.8, 0.55, 0, '#d83352');
    this._makeCar(16.8, -9.2, -0.7, 1, '#3e7bdb');
    this._makeCrate(-12.5, 15.5, 0, 0);
    this._makeCrate(-11.2, 15.9, 0.4, 1);
    this._makeCrate(14.5, -1.4, -0.2, 2);
  }

  _makeColumn(x, z, i) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const h = 3.9;
    const body = this.addMesh(group, new THREE.BoxGeometry(1.15, h, 1.15), '#625d6e', {
      position: [0, h / 2, 0], outlineScale: 1.02,
    });
    const cap = this.addMesh(group, new THREE.BoxGeometry(1.45, 0.22, 1.45), '#3f3b49', { position: [0, h + 0.05, 0], outlineScale: 1.02 });
    const base = this.addMesh(group, new THREE.BoxGeometry(1.45, 0.28, 1.45), '#3f3b49', { position: [0, 0.14, 0], outlineScale: 1.02 });
    // 裂纹与警示带
    const hazard = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.42),
      new THREE.MeshBasicMaterial({
        map: this._textTexture('///', '#ffcf5c', 'rgba(20,16,5,.8)', 256, 128, 'bold 90px Arial', false),
        transparent: true, toneMapped: false, opacity: 0.5,
      })
    );
    hazard.position.set(0, 0.7, 0.58);
    group.add(hazard);
    for (let k = 0; k < 2; k++) {
      const crack = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.8, 0.01), new THREE.MeshBasicMaterial({ color: 0x17141f, toneMapped: false }));
      crack.position.set(rand(-0.3, 0.3), rand(1.8, 3.2), 0.579);
      crack.rotation.z = rand(-0.4, 0.4);
      group.add(crack);
    }
    this.group.add(group);
    const rb = this.addStaticBox(x, h / 2, z, 0.575, h / 2, 0.575, { friction: 0.7 });
    this._registerBreakable({
      type: 'column', group, body: rb.body, collider: rb.col, x, z, center: new THREE.Vector3(x, h / 2, z),
      half: new THREE.Vector3(0.7, h / 2, 0.7), radius: 1.15, hp: 280, maxHp: 280, id: `column-${i}`,
      color: 0x9b91aa, matMeshes: [body, cap, base],
    });
  }

  _makeGlassWall(x, z, rot, i) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x8fe8ff, transparent: true, opacity: 0.22, roughness: 0.06, metalness: 0.1,
      transmission: 0.28, thickness: 0.04, side: THREE.DoubleSide, depthWrite: false,
    });
    const frameMat = this.makeMaterial('#4e4b5b');
    const w = 2.45, h = 2.6;
    for (let k = 0; k < 2; k++) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.25, h - 0.2), glassMat.clone());
      pane.position.set((k - 0.5) * w + (k ? 0.1 : -0.1), h / 2, 0);
      group.add(pane);
    }
    // 边框
    for (const sx of [-w, w]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.09), frameMat);
      bar.position.set(sx, h / 2, 0);
      group.add(bar);
    }
    for (const y of [0.05, h - 0.05]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.1, 0.1), frameMat);
      bar.position.set(0, y, 0);
      group.add(bar);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.08), frameMat);
    bar.position.set(0, h / 2, 0);
    group.add(bar);
    // 玻璃高光
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, h * 0.7), new THREE.MeshBasicMaterial({
      color: 0xbff8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    sheen.position.set(-0.8, h / 2, 0.02);
    group.add(sheen);
    this.group.add(group);
    const rb = this.addStaticBox(x, h / 2, z, rot ? 0.08 : w, h / 2, rot ? w : 0.08, { friction: 0.4, restitution: 0.1 });
    this._registerBreakable({
      type: 'glass', group, body: rb.body, collider: rb.col, x, z, center: new THREE.Vector3(x, h / 2, z),
      half: new THREE.Vector3(rot ? 0.1 : w, h / 2, rot ? w : 0.1), radius: w, hp: 85, maxHp: 85,
      id: `glass-${i}`, color: 0x8fe8ff, matMeshes: [], panelMats: group.children.filter((c) => c.material === glassMat || c.material?.isMeshPhysicalMaterial).map((c) => c.material),
      rotY: rot,
    });
  }

  _makeCar(x, z, rot, i, color) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    const bodyMat = this.makeMaterial(color, { rim: 0.2 });
    const dark = this.makeMaterial('#16151c');
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 4.1), bodyMat);
    body.position.y = 0.72; body.castShadow = true; body.receiveShadow = true;
    addOutlineSafe(body, 1.018);
    group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.0), this.makeMaterial('#20202d', { transparent: true, opacity: 0.92 }));
    cabin.position.set(0, 1.25, -0.15); cabin.castShadow = true;
    addOutlineSafe(cabin, 1.022);
    group.add(cabin);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.48), new THREE.MeshPhysicalMaterial({
      color: 0x9bdcff, transparent: true, opacity: 0.38, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide,
    }));
    windshield.position.set(0, 1.35, 0.86);
    windshield.rotation.x = -0.12;
    group.add(windshield);
    // 车灯
    for (const sx of [-0.68, 0.68]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), basicGlow(0xffe0a0, 0.9));
      light.position.set(sx, 0.7, 2.06);
      group.add(light);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), basicGlow(0xff2e63, 0.75));
      tail.position.set(sx, 0.72, -2.06);
      group.add(tail);
    }
    for (const sx of [-0.92, 0.92]) {
      for (const sz of [-1.28, 1.32]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 12), dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx, 0.38, sz);
        group.add(wheel);
      }
    }
    this.group.add(group);
    const rb = this.addStaticBox(x, 0.65, z, 1.1, 0.55, 2.1, { rotation: [0, rot, 0], friction: 0.6 });
    this._registerBreakable({
      type: 'car', group, body: rb.body, collider: rb.col, x, z, center: new THREE.Vector3(x, 0.7, z),
      half: new THREE.Vector3(1.2, 0.7, 2.2), radius: 2.2, hp: 380, maxHp: 380, id: `car-${i}`,
      color, matMeshes: [body, cabin], rotY: rot,
    });
  }

  _makeCrate(x, z, rot, i) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    const mat = this.makeMaterial('#5e4b35');
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.2, 1.3), mat);
    crate.position.y = 0.6; crate.castShadow = true; crate.receiveShadow = true;
    addOutlineSafe(crate, 1.025);
    group.add(crate);
    for (const y of [0.18, 0.6, 1.02]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.08, 1.34), this.makeMaterial('#8a6b45'));
      strip.position.y = y;
      group.add(strip);
    }
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), new THREE.MeshBasicMaterial({
      map: this._textTexture('危', '#ffcf5c', 'rgba(0,0,0,0)', 128, 128, 'bold 90px "Microsoft YaHei"', false),
      transparent: true, toneMapped: false,
    }));
    mark.position.set(0, 0.65, 0.656);
    group.add(mark);
    this.group.add(group);
    const rb = this.addStaticBox(x, 0.6, z, 0.66, 0.6, 0.66, { rotation: [0, rot, 0], friction: 0.7 });
    this._registerBreakable({
      type: 'crate', group, body: rb.body, collider: rb.col, x, z, center: new THREE.Vector3(x, 0.6, z),
      half: new THREE.Vector3(0.7, 0.6, 0.7), radius: 0.95, hp: 90, maxHp: 90, id: `crate-${i}`,
      color: 0x9b7550, matMeshes: [crate],
    });
  }

  _registerBreakable(data) {
    const b = { ...data, broken: false, flash: 0 };
    this.breakables.push(b);
    return b;
  }

  _buildDust() {
    const count = 220;
    const pos = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rand(-30, 30);
      pos[i * 3 + 1] = rand(0.2, 16);
      pos[i * 3 + 2] = rand(-30, 30);
      seeds.push({ speed: rand(0.1, 0.5), phase: rand(0, TAU), amp: rand(0.2, 1.2) });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffd6e5, size: 0.055, transparent: true, opacity: 0.45,
      map: getGlowTexture(), depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    this._dustSeeds = seeds;
  }

  _buildSigns() {
    // 天台边缘的咒符纸条
    for (let i = 0; i < 7; i++) {
      const x = rand(-19, 19);
      const z = rand(-19, 19);
      const paper = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.7),
        new THREE.MeshBasicMaterial({
          map: this._textTexture('封', '#ff2e63', 'rgba(238,232,220,.9)', 128, 384, 'bold 86px "Yu Gothic", "Microsoft YaHei"', true),
          transparent: true, side: THREE.DoubleSide, toneMapped: false, color: 0xffffff,
        })
      );
      paper.position.set(x, rand(0.2, 1.0), z);
      paper.rotation.y = rand(0, TAU);
      this.group.add(paper);
      this.animated.push((dt, t) => { paper.rotation.y += dt * 0.08; });
    }
  }

  /* --------------------------------------------------------------- combat */
  getBreakableAt(point, radius = 1) {
    for (const b of this.breakables) {
      if (b.broken) continue;
      const dx = b.center.x - point.x;
      const dz = b.center.z - point.z;
      if (dx * dx + dz * dz < (b.radius + radius) ** 2) return b;
    }
    return null;
  }

  getBreakablesInRadius(point, radius) {
    const out = [];
    for (const b of this.breakables) {
      if (b.broken) continue;
      const dx = b.center.x - point.x;
      const dz = b.center.z - point.z;
      if (dx * dx + dz * dz < (radius + b.radius) ** 2) out.push(b);
    }
    return out;
  }

  damageBreakable(b, amount, opts = {}) {
    if (!b || b.broken) return false;
    b.hp -= amount;
    b.flash = 0.12;
    for (const m of b.matMeshes || []) {
      if (m?.material?.emissive) {
        m.material.emissive.setHex(0xffffff);
        m.material.emissiveIntensity = 0.5;
      }
    }
    this.hitFlashes.push(b);
    if (b.hp <= 0) {
      this.break(b, opts);
      return true;
    }
    this.effects.particleBurst(
      new THREE.Vector3(b.center.x + rand(-0.4, 0.4), b.center.y + rand(-0.7, 0.7), b.center.z + rand(-0.4, 0.4)),
      b.type === 'glass' ? 0x9ff3ff : 0xc9bacd,
      b.type === 'glass' ? 20 : 10,
      { speed: 4, life: 0.5, size: 0.12, gravity: 8, color2: 0xffffff }
    );
    return false;
  }

  break(b, opts = {}) {
    if (!b || b.broken) return;
    b.broken = true;
    b.group.visible = false;
    if (b.body) {
      try { this.world.removeRigidBody(b.body); } catch (e) { /* already removed */ }
      b.body = null;
    }
    const center = b.center.clone();
    const count = b.type === 'glass' ? 16 : b.type === 'car' ? 12 : b.type === 'crate' ? 8 : 10;
    const color = b.type === 'glass' ? 0x9ff3ff : b.type === 'crate' ? 0x7c5f3d : b.type === 'car' ? b.color : 0x6d6879;
    this.effects.particleBurst(center, color, 46, {
      speed: 10, life: 1.1, size: 0.3, gravity: 12, drag: 0.9, up: 0.5, color2: 0xffffff,
    });
    this.effects.shockwave(new THREE.Vector3(center.x, 0.02, center.z), b.type === 'glass' ? 0x9ff3ff : 0xffb26b, { radius: 3.6, count: 18, light: 3, dust: false });
    if (opts.cause) {
      this.effects.slash(center, b.type === 'glass' ? 0x9ff3ff : 0xffbf75, { radius: 3.2, duration: 0.35 });
    }
    // 碎块刚体
    for (let i = 0; i < count; i++) {
      const size = b.type === 'glass'
        ? new THREE.Vector3(rand(0.15, 0.45), rand(0.15, 0.5), rand(0.015, 0.04))
        : b.type === 'car'
          ? new THREE.Vector3(rand(0.3, 0.8), rand(0.2, 0.5), rand(0.3, 0.9))
          : new THREE.Vector3(rand(0.2, 0.65), rand(0.2, 0.75), rand(0.2, 0.65));
      const geo = b.type === 'glass'
        ? new THREE.BoxGeometry(size.x, size.y, size.z)
        : new THREE.BoxGeometry(size.x, size.y, size.z);
      let mat;
      if (b.type === 'glass') {
        mat = new THREE.MeshPhysicalMaterial({
          color: 0x9ff3ff, transparent: true, opacity: 0.42, roughness: 0.05, metalness: 0.2,
          side: THREE.DoubleSide, depthWrite: false,
        });
      } else {
        const c = new THREE.Color(color).offsetHSL(rand(-0.02, 0.02), rand(-0.05, 0.05), rand(-0.1, 0.1));
        mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: b.type === 'car' ? 0.22 : 0.06 });
      }
      const piece = new THREE.Mesh(geo, mat);
      piece.castShadow = b.type !== 'glass';
      piece.receiveShadow = true;
      const px = center.x + rand(-b.radius * 0.6, b.radius * 0.6);
      const py = center.y + rand(-b.half.y * 0.6, b.half.y * 0.6);
      const pz = center.z + rand(-b.radius * 0.6, b.radius * 0.6);
      piece.position.set(px, py, pz);
      this.group.add(piece);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py, pz).setLinearDamping(0.12).setAngularDamping(0.3)
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
          .setDensity(b.type === 'glass' ? 0.5 : 1.2)
          .setFriction(0.75)
          .setRestitution(b.type === 'glass' ? 0.18 : 0.1),
        body
      );
      const dir = opts.impulse ? opts.impulse.clone() : new THREE.Vector3(rand(-1, 1), rand(0.2, 1.3), rand(-1, 1));
      if (dir.lengthSq() < 0.01) dir.set(rand(-1, 1), 1, rand(-1, 1));
      dir.normalize();
      const force = b.type === 'glass' ? rand(2, 6) : rand(2.5, 7.5);
      body.setLinvel({ x: dir.x * force + rand(-2, 2), y: dir.y * force + rand(1, 5), z: dir.z * force + rand(-2, 2) }, true);
      body.applyTorqueImpulse({ x: rand(-1, 1), y: rand(-1, 1), z: rand(-1, 1) }, true);
      this.debris.push({ mesh: piece, body, collider, life: rand(6, 10), maxLife: 10 });
    }
    // 移除破碎体的静态碰撞体（在 addStaticBox 中已经创建，需要从 statics 中找）
    // Note: the breakable body is removed above, so nothing else to do.
    return b;
  }

  /* --------------------------------------------------------------- update */
  update(dt) {
    this.time += dt;
    for (const fn of this.animated) fn(dt, this.time);
    this.rimLight.intensity = 26 + Math.sin(this.time * 1.3) * 5;
    this.keyLight.intensity = 2.9 + Math.sin(this.time * 0.7) * 0.15;

    // hit flash restore
    for (let i = this.hitFlashes.length - 1; i >= 0; i--) {
      const b = this.hitFlashes[i];
      b.flash -= dt;
      if (b.flash <= 0) {
        for (const m of b.matMeshes || []) {
          if (m?.material?.emissive) {
            m.material.emissive.setHex(0x000000);
            m.material.emissiveIntensity = 1;
          }
        }
        this.hitFlashes.splice(i, 1);
      }
    }

    // 动态碎块
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      const t = d.body.translation();
      const r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (d.life < 1.2) {
        const m = d.mesh.material;
        if (m) {
          if (m.transparent === false) m.transparent = true;
          m.opacity = clamp(d.life / 1.2, 0, 1);
        }
      }
      if (d.life <= 0 || t.y < -20) {
        this.group.remove(d.mesh);
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
        try { this.world.removeRigidBody(d.body); } catch (e) { /* noop */ }
        this.debris.splice(i, 1);
      }
    }

    // 灰尘漂浮
    if (this.dust) {
      const arr = this.dust.geometry.attributes.position.array;
      for (let i = 0; i < this._dustSeeds.length; i++) {
        const s = this._dustSeeds[i];
        arr[i * 3 + 1] += dt * s.speed;
        arr[i * 3] += Math.sin(this.time * 0.3 + s.phase) * dt * 0.12;
        arr[i * 3 + 2] += Math.cos(this.time * 0.22 + s.phase) * dt * 0.08;
        if (arr[i * 3 + 1] > 18) arr[i * 3 + 1] = 0.1;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
      this.dust.material.opacity = 0.32 + Math.sin(this.time * 0.6) * 0.08;
    }

    // 霓虹灯光呼吸
    for (const s of this._neonSigns) {
      s.glow.material.opacity = 0.13 + Math.sin(this.time * 2 + s.phase) * 0.04;
    }
  }

  reset() {
    // 清空碎块
    for (const d of this.debris) {
      this.group.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
      try { this.world.removeRigidBody(d.body); } catch (e) { /* noop */ }
    }
    this.debris.length = 0;
    for (const b of this.breakables) {
      if (b.broken) {
        b.broken = false;
        b.hp = b.maxHp;
        b.group.visible = true;
        // 重建静态碰撞体
        if (!b.body) {
          if (b.type === 'glass') {
            const rb = this.addStaticBox(b.x, b.half.y, b.z, b.rotY ? 0.08 : b.half.x, b.half.y, b.rotY ? b.half.x : 0.08, { friction: 0.4 });
            b.body = rb.body;
          } else {
            const rb = this.addStaticBox(b.x, b.half.y, b.z, b.half.x, b.half.y, b.half.z, { friction: 0.7, rotation: b.rotY ? [0, b.rotY, 0] : undefined });
            b.body = rb.body;
          }
        }
      }
    }
  }

  dispose() {
    for (const d of this.debris) {
      try { this.world.removeRigidBody(d.body); } catch (e) { /* noop */ }
    }
    this.scene.remove(this.group);
    this.scene.remove(this.sky);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }
}

function addOutlineSafe(mesh, scale = 1.02) {
  const outline = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color: 0x08080c, side: THREE.BackSide, toneMapped: false })
  );
  outline.scale.setScalar(scale);
  mesh.add(outline);
}

