import * as THREE from 'three';
import { TAU, clamp, damp, lerp } from '../core/utils.js';
import { toonMesh, addOutline, basicGlow, spriteGlow, getGradientMap } from '../render/toon.js';

const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  sphereLo: new THREE.SphereGeometry(1, 14, 10),
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
  cone: new THREE.ConeGeometry(1, 1, 5),
  torus: new THREE.TorusGeometry(1, 0.1, 8, 28),
  circle: new THREE.CircleGeometry(1, 28),
  ring: new THREE.RingGeometry(0.82, 1, 32),
};

function capsule(radius, length, seg = 6, radial = 12) {
  return new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), seg, radial);
}

function mesh(parent, geo, color, opts = {}) {
  const m = toonMesh(geo, color, opts);
  if (opts.position) m.position.set(...opts.position);
  if (opts.rotation) m.rotation.set(...opts.rotation);
  if (opts.scale) m.scale.set(...opts.scale);
  m.name = opts.name || 'part';
  parent.add(m);
  return m;
}

function basic(parent, geo, color, opts = {}) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opts.opacity !== undefined,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite !== false,
    toneMapped: opts.toneMapped ?? false,
    blending: opts.blending ?? THREE.NormalBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  if (opts.position) m.position.set(...opts.position);
  if (opts.rotation) m.rotation.set(...opts.rotation);
  if (opts.scale) m.scale.set(...opts.scale);
  parent.add(m);
  return m;
}

function makeEye(parent, x, y, z, color, flip = 1) {
  const eyeGroup = new THREE.Group();
  eyeGroup.position.set(x, y, z);
  eyeGroup.rotation.y = 0;
  parent.add(eyeGroup);
  // 眼白
  const white = basic(eyeGroup, GEO.sphereLo, 0xfbf8ff, { scale: [0.047, 0.065, 0.012], depthWrite: false });
  white.scale.z = 0.012;
  // 虹膜
  const iris = basic(eyeGroup, GEO.sphereLo, color, { scale: [0.028, 0.046, 0.016], position: [0, -0.006, 0.012], depthWrite: false });
  iris.scale.z = 0.012;
  // 瞳孔
  basic(eyeGroup, GEO.sphereLo, 0x08070d, { scale: [0.012, 0.028, 0.009], position: [0, -0.005, 0.024], depthWrite: false });
  // 高光
  basic(eyeGroup, GEO.sphereLo, 0xffffff, { scale: [0.009, 0.013, 0.004], position: [-0.009 * flip, 0.014, 0.031], depthWrite: false });
  // 睫毛 / 上眼线
  basic(eyeGroup, GEO.box, 0x0b0910, { scale: [0.1, 0.012, 0.012], position: [0, 0.055, 0.026], rotation: [0, 0, -0.08 * flip], depthWrite: false });
  return eyeGroup;
}

function buildHair(head, def) {
  const p = def.palette;
  const hairGroup = new THREE.Group();
  hairGroup.name = 'hairGroup';
  head.add(hairGroup);
  const cap = mesh(
    hairGroup,
    new THREE.SphereGeometry(0.232, 22, 14, 0, TAU, 0, Math.PI * 0.52),
    p.hair,
    { position: [0, 0.018, -0.014], scale: [1.01, 1.02, 1.03], outlineScale: 1.035 }
  );
  cap.name = 'hairCap';
  // 后脑发量
  mesh(hairGroup, new THREE.SphereGeometry(0.205, 16, 12), p.hairShade, {
    position: [0, -0.015, -0.077], scale: [0.98, 1.04, 0.82], outlineScale: 1.04,
  });

  const style = def.id;
  if (style === 'zhoutong') {
    // 银色后梳尖发
    for (let i = 0; i < 7; i++) {
      const a = -0.95 + i * 0.32;
      const cone = mesh(hairGroup, new THREE.ConeGeometry(0.085, 0.34, 4), i % 2 ? p.hair : p.hairShade, {
        position: [Math.sin(a) * 0.17, 0.1 + i * 0.012, -0.09 - Math.cos(a) * 0.07],
        rotation: [0.95, a, 0.25 * Math.sin(a)],
        outlineScale: 1.04,
      });
      cone.scale.set(0.8, 1, 0.8);
    }
    // 前侧刘海
    for (let i = 0; i < 5; i++) {
      const x = -0.16 + i * 0.08;
      const h = 0.17 + (i === 2 ? 0.06 : 0);
      mesh(hairGroup, new THREE.ConeGeometry(0.052, h, 4), p.hair, {
        position: [x, 0.09 - h * 0.35, 0.18 - Math.abs(x) * 0.2],
        rotation: [Math.PI, 0, -x * 0.9],
        outlineScale: 1.02,
      });
    }
    // 鬓角
    mesh(hairGroup, new THREE.ConeGeometry(0.05, 0.25, 4), p.hairShade, { position: [-0.205, -0.03, 0.035], rotation: [Math.PI, 0, 0.15] });
    mesh(hairGroup, new THREE.ConeGeometry(0.05, 0.25, 4), p.hairShade, { position: [0.205, -0.03, 0.035], rotation: [Math.PI, 0, -0.15] });
  } else if (style === 'guojunxi') {
    // 白色碎发，带空间感的长侧发
    for (let i = 0; i < 8; i++) {
      const x = -0.22 + i * 0.063;
      const h = 0.2 + Math.sin(i * 1.3) * 0.08;
      mesh(hairGroup, new THREE.ConeGeometry(0.045, h, 4), i % 3 ? p.hair : p.hairShade, {
        position: [x, 0.095 - h * 0.34, 0.19 - Math.abs(x) * 0.12],
        rotation: [Math.PI + 0.08, 0, -x * 1.2],
        outlineScale: 1.02,
      });
    }
    mesh(hairGroup, new THREE.ConeGeometry(0.075, 0.55, 4), p.hair, { position: [-0.23, -0.13, 0.02], rotation: [Math.PI + 0.12, 0, 0.22] });
    mesh(hairGroup, new THREE.ConeGeometry(0.07, 0.42, 4), p.hairShade, { position: [0.22, -0.1, 0.01], rotation: [Math.PI - 0.05, 0, -0.2] });
    for (let i = 0; i < 4; i++) {
      mesh(hairGroup, new THREE.ConeGeometry(0.055, 0.3, 4), p.hair, {
        position: [Math.sin(i * 1.7) * 0.17, 0.04, -0.15], rotation: [1.1, i * 1.6, 0.2],
      });
    }
  } else if (style === 'hezeyou') {
    // 深色利落短发 + 科技挑染
    for (let i = 0; i < 6; i++) {
      const x = -0.17 + i * 0.068;
      mesh(hairGroup, new THREE.ConeGeometry(0.06, 0.14, 4), i === 2 || i === 3 ? p.accent : p.hair, {
        position: [x, 0.08, 0.19], rotation: [Math.PI, 0, -x], outlineScale: 1.02,
      });
    }
    mesh(hairGroup, new THREE.ConeGeometry(0.08, 0.17, 4), p.hair, { position: [-0.21, -0.03, -0.02], rotation: [1.9, 0, 0.2] });
    mesh(hairGroup, new THREE.ConeGeometry(0.08, 0.17, 4), p.hair, { position: [0.21, -0.03, -0.02], rotation: [1.9, 0, -0.2] });
    // 科技发带
    basic(hairGroup, GEO.box, p.accent, { scale: [0.3, 0.012, 0.02], position: [0, 0.105, 0.195], toneMapped: false });
  } else {
    // 王琛：黑色长层次 + 暗红挑染
    for (let i = 0; i < 7; i++) {
      const x = -0.2 + i * 0.067;
      const h = 0.18 + (i === 3 ? 0.09 : 0);
      mesh(hairGroup, new THREE.ConeGeometry(0.048, h, 4), i === 1 ? p.accent : i % 2 ? p.hair : p.hairShade, {
        position: [x, 0.1 - h * 0.3, 0.185], rotation: [Math.PI + 0.05, 0, -x], outlineScale: 1.02,
      });
    }
    mesh(hairGroup, new THREE.ConeGeometry(0.08, 0.36, 4), p.hair, { position: [-0.225, -0.07, -0.02], rotation: [Math.PI + 0.08, 0, 0.18] });
    mesh(hairGroup, new THREE.ConeGeometry(0.08, 0.42, 4), p.hairShade, { position: [0.225, -0.09, -0.03], rotation: [Math.PI - 0.08, 0, -0.16] });
    for (let i = 0; i < 3; i++) {
      mesh(hairGroup, new THREE.ConeGeometry(0.06, 0.3, 4), p.hairShade, {
        position: [Math.sin(i * 2.1) * 0.13, 0.0, -0.16], rotation: [1.35, i * 2.1, 0.2],
      });
    }
  }
  return hairGroup;
}

export function buildCharacter(def, options = {}) {
  const p = def.palette;
  const group = new THREE.Group();
  group.name = `character-${def.id}`;
  const model = new THREE.Group();
  group.add(model);
  const b = def.build || {};

  const skinMatOpts = { outlineColor: 0x1a1116, outlineScale: 1.022 };
  // ---------------- legs ----------------
  const legs = new THREE.Group();
  model.add(legs);
  const legPivots = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.115, 0.91, 0);
    legs.add(pivot);
    const thigh = mesh(pivot, capsule(0.082, 0.44), p.pants, { position: [0, -0.2, 0], outlineScale: 1.04 });
    thigh.scale.z = 1.04;
    mesh(pivot, capsule(0.071, 0.4), p.pants, { position: [0, -0.54, 0.008], outlineScale: 1.04 });
    // boot
    const boot = mesh(pivot, new THREE.BoxGeometry(0.145, 0.14, 0.26), p.boots, { position: [0, -0.79, 0.045], outlineScale: 1.03 });
    boot.geometry.translate(0, 0, 0);
    mesh(pivot, new THREE.BoxGeometry(0.13, 0.04, 0.1), p.trim, { position: [0, -0.84, -0.08], outlineScale: 1.01 });
    legPivots.push(pivot);
  }

  // ---------------- torso ----------------
  const torso = new THREE.Group();
  torso.position.y = 0.92;
  model.add(torso);
  mesh(torso, capsule(0.215, 0.64), p.jacket, {
    position: [0, 0.28, 0], scale: [1.06, 1, 0.7], outlineScale: 1.036, name: 'chest',
  });
  // 腹部内衬
  mesh(torso, new THREE.BoxGeometry(0.2, 0.18, 0.035), p.jacket2, { position: [0, 0.17, 0.155], outline: false });
  // 腰带
  basic(torso, GEO.box, p.boots, { scale: [0.42, 0.055, 0.28], position: [0, 0.0, 0] });
  basic(torso, GEO.box, p.accent, { scale: [0.07, 0.045, 0.015], position: [0, 0.0, 0.148], toneMapped: false });
  // 衣领
  const collarL = mesh(torso, new THREE.BoxGeometry(0.16, 0.18, 0.045), p.jacket2, {
    position: [-0.11, 0.51, 0.1], rotation: [0.18, 0.25, 0.32], outlineScale: 1.02,
  });
  const collarR = mesh(torso, new THREE.BoxGeometry(0.16, 0.18, 0.045), p.jacket2, {
    position: [0.11, 0.51, 0.1], rotation: [0.18, -0.25, -0.32], outlineScale: 1.02,
  });
  // 胸口能量装饰
  if (def.id === 'zhoutong') {
    basic(torso, GEO.box, p.accent, { scale: [0.19, 0.015, 0.012], position: [0, 0.38, 0.188], toneMapped: false });
    basic(torso, GEO.box, p.accent, { scale: [0.015, 0.16, 0.012], position: [0, 0.32, 0.188], toneMapped: false });
  } else if (def.id === 'guojunxi') {
    basic(torso, GEO.box, p.accent, { scale: [0.35, 0.02, 0.012], position: [0, 0.42, 0.17], toneMapped: false });
    basic(torso, GEO.box, p.accent, { scale: [0.018, 0.18, 0.012], position: [0.09, 0.3, 0.175], toneMapped: false });
  } else if (def.id === 'hezeyou') {
    for (let i = 0; i < 3; i++) {
      basic(torso, GEO.box, p.accent, { scale: [0.11, 0.01, 0.012], position: [0, 0.32 + i * 0.05, 0.18], toneMapped: false });
    }
  } else {
    // 白衬衫 + 领带
    mesh(torso, new THREE.BoxGeometry(0.22, 0.42, 0.04), p.shirt || '#ded8ce', { position: [0, 0.31, 0.145], outline: false });
    basic(torso, GEO.box, p.scarf, { scale: [0.055, 0.3, 0.018], position: [0, 0.27, 0.174], toneMapped: false });
    basic(torso, GEO.box, p.glow, { scale: [0.025, 0.025, 0.012], position: [0, 0.46, 0.178], toneMapped: false });
  }
  // 外套下摆
  const coatTails = [];
  if (b.coat) {
    for (const side of [-1, 1]) {
      const tail = new THREE.Group();
      tail.position.set(side * 0.1, 0.05, -0.12);
      torso.add(tail);
      const m = mesh(tail, new THREE.BoxGeometry(0.2, 0.56, 0.06), p.jacket, {
        position: [side * 0.03, -0.27, -0.02], rotation: [0.08, 0, side * 0.05], outlineScale: 1.04,
      });
      const trim = basic(tail, GEO.box, p.accent, { scale: [0.18, 0.012, 0.012], position: [side * 0.03, -0.53, 0.02], opacity: 0.8, toneMapped: false });
      coatTails.push({ group: tail, mesh: m, side });
    }
  }

  // ---------------- arms ----------------
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.265, 1.36, 0);
    pivot.rotation.z = side * 0.1;
    model.add(pivot);
    mesh(pivot, capsule(0.074, 0.29), p.jacket, { position: [0, -0.145, 0], outlineScale: 1.04 });
    const fore = new THREE.Group();
    fore.position.y = -0.29;
    pivot.add(fore);
    mesh(fore, capsule(0.063, 0.28), p.jacket2, { position: [0, -0.13, 0], outlineScale: 1.04 });
    const hand = mesh(fore, new THREE.SphereGeometry(0.074, 12, 9), p.skin, { position: [0, -0.285, 0.012], scale: [1, 1.05, 0.9], outlineScale: 1.03 });
    // 肩甲
    mesh(pivot, new THREE.SphereGeometry(0.11, 14, 10), p.jacket2, { position: [side * 0.02, 0.01, 0], scale: [1, 0.8, 0.95], outlineScale: 1.035 });
    if (b.gauntlets) {
      mesh(fore, new THREE.BoxGeometry(0.16, 0.18, 0.16), p.jacket2, { position: [0, -0.19, 0.01], outlineScale: 1.04 });
      const glow = basic(fore, GEO.box, p.accent, { scale: [0.13, 0.018, 0.016], position: [0, -0.2, 0.095], toneMapped: false });
      arms.push({ pivot, fore, hand, glow, side });
    } else {
      // 袖口
      basic(fore, GEO.box, p.accent, { scale: [0.135, 0.018, 0.135], position: [0, -0.235, 0], toneMapped: false, opacity: 0.8 });
      arms.push({ pivot, fore, hand, side });
    }
  }

  // ---------------- head ----------------
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.52;
  headGroup.name = 'headGroup';
  model.add(headGroup);
  mesh(headGroup, new THREE.CylinderGeometry(0.065, 0.075, 0.12, 10), p.skin, { position: [0, 0.0, 0], outline: false });
  const head = new THREE.Group();
  head.position.y = 0.19;
  headGroup.add(head);
  const face = mesh(head, new THREE.SphereGeometry(0.205, 24, 18), p.skin, {
    position: [0, 0, 0.018], scale: [0.98, 1.03, 0.95], outlineScale: 1.026, name: 'face',
  });
  // 耳朵
  mesh(head, new THREE.SphereGeometry(0.045, 10, 8), p.skinShade, { position: [-0.198, -0.01, 0.01], scale: [0.5, 1, 0.8], outline: false });
  mesh(head, new THREE.SphereGeometry(0.045, 10, 8), p.skinShade, { position: [0.198, -0.01, 0.01], scale: [0.5, 1, 0.8], outline: false });
  makeEye(head, -0.081, -0.012, 0.205, p.eye, 1);
  makeEye(head, 0.081, -0.012, 0.205, p.eye, -1);
  // 眉毛
  basic(head, GEO.box, p.hairShade, { scale: [0.073, 0.014, 0.012], position: [-0.082, 0.066, 0.214], rotation: [0, 0, 0.1], depthWrite: false });
  basic(head, GEO.box, p.hairShade, { scale: [0.073, 0.014, 0.012], position: [0.082, 0.066, 0.214], rotation: [0, 0, -0.1], depthWrite: false });
  // 鼻 / 嘴
  basic(head, GEO.box, p.skinShade, { scale: [0.018, 0.035, 0.02], position: [0, -0.055, 0.221], depthWrite: false });
  basic(head, GEO.box, '#5b3038', { scale: [0.055, 0.009, 0.01], position: [0, -0.111, 0.216], depthWrite: false });
  // 面部印记 / 特征
  if (def.id === 'wangchen') {
    basic(head, GEO.box, p.accent, { scale: [0.012, 0.07, 0.008], position: [0.147, -0.065, 0.175], rotation: [0, 0.15, 0.2], toneMapped: false });
  }
  if (def.id === 'guojunxi') {
    basic(head, GEO.box, p.accent, { scale: [0.03, 0.012, 0.01], position: [-0.13, -0.061, 0.187], rotation: [0, 0, 0.3], toneMapped: false });
  }
  const hairGroup = buildHair(head, def);

  // ---------------- accessories ----------------
  const orbitals = [];
  let auraRing = null;
  if (def.build?.tech) {
    // 量子科技背包与悬浮单元
    mesh(torso, new THREE.BoxGeometry(0.34, 0.3, 0.14), p.jacket2, { position: [0, 0.32, -0.19], outlineScale: 1.04 });
    basic(torso, GEO.box, p.accent, { scale: [0.2, 0.012, 0.04], position: [0, 0.38, -0.265], toneMapped: false });
    for (let i = 0; i < 3; i++) {
      const orb = new THREE.Group();
      const core = basic(orb, GEO.sphereLo, p.accent, { scale: [0.03, 0.03, 0.03] });
      const halo = new THREE.Mesh(GEO.ring, basicGlow(p.glow, 0.8));
      halo.scale.setScalar(0.07);
      orb.add(halo);
      model.add(orb);
      orbitals.push({ obj: orb, angle: (i / 3) * TAU, radius: 0.48 + i * 0.08, y: 1.55 + i * 0.08, speed: 0.7 + i * 0.12, bob: 0.05 });
    }
  }
  if (def.id === 'guojunxi') {
    for (let i = 0; i < 4; i++) {
      const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.045, 0), basicGlow(p.glow, 0.7));
      model.add(shard);
      orbitals.push({ obj: shard, angle: i * 1.7, radius: 0.46 + i * 0.06, y: 1.15 + i * 0.13, speed: 0.5 + i * 0.17, bob: 0.08 });
    }
  }
  if (def.id === 'zhoutong') {
    for (let i = 0; i < 2; i++) {
      const rock = mesh(model, new THREE.DodecahedronGeometry(0.075, 0), p.hairShade, { outlineScale: 1.05, position: [0, 0, 0] });
      orbitals.push({ obj: rock, angle: i * Math.PI, radius: 0.55, y: 1.0 + i * 0.18, speed: 0.32 + i * 0.08, bob: 0.05 });
    }
  }
  if (def.id === 'wangchen') {
    // 怀表链
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.008, 6, 22, Math.PI * 1.3), basicGlow(p.glow, 0.7));
    chain.position.set(0.07, 0.26, 0.168);
    chain.rotation.z = -0.35;
    torso.add(chain);
    // 时之刃（收在右手）
    const rightHand = arms.find((a) => a.side === 1)?.hand;
    if (rightHand) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.44, 0.07), basicGlow(p.accent, 0.55));
      blade.position.set(0, -0.18, 0.02);
      rightHand.add(blade);
    }
  }
  if (def.build?.scarf) {
    const scarfRoot = new THREE.Group();
    scarfRoot.position.set(0, 1.43, 0);
    model.add(scarfRoot);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.045, 7, 22), createToonMaterialScalar(p.scarf));
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 0.8;
    scarfRoot.add(ring);
    const scarfTails = [];
    for (const side of [-1, 1]) {
      const tail = new THREE.Group();
      tail.position.set(side * 0.08, 0, -0.12);
      model.add(tail);
      const sm = mesh(tail, new THREE.BoxGeometry(0.1, 0.55, 0.035), p.scarf, {
        position: [side * 0.02, -0.25, -0.03], rotation: [0.12, 0, side * 0.08], outline: false,
      });
      scarfTails.push({ group: tail, mesh: sm, side });
    }
    headGroup.userData.scarfTails = scarfTails;
  }
  if (def.id === 'hezeyou') {
    // 护目镜 / 量子视觉带
    const visor = basic(head, new THREE.BoxGeometry(0.35, 0.075, 0.035), p.accent, {
      position: [0, 0.015, 0.211], opacity: 0.72, toneMapped: false,
    });
    visor.material.blending = THREE.AdditiveBlending;
    basic(head, GEO.box, 0x07121a, { scale: [0.37, 0.018, 0.045], position: [0, 0.055, 0.19], toneMapped: false });
  }

  // ---------------- foot aura / shadow ----------------
  auraRing = new THREE.Mesh(
    new THREE.RingGeometry(0.48, 0.56, 40),
    new THREE.MeshBasicMaterial({
      color: p.accent, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    })
  );
  auraRing.rotation.x = -Math.PI / 2;
  auraRing.position.y = 0.015;
  group.add(auraRing);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 28),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.008;
  group.add(shadow);

  // 右侧定位光，用于角色舞台
  const modelScale = b.height || 1;
  model.scale.setScalar(modelScale * (options.scale || 1));
  group.rotation.order = 'YXZ';

  const state = {
    group,
    model,
    headGroup,
    head,
    hairGroup,
    face,
    torso,
    arms,
    legs: legPivots,
    coatTails,
    orbitals,
    auraRing,
    shadow,
    scarfTails: headGroup.userData.scarfTails || [],
    time: Math.random() * 10,
    walkPhase: 0,
    currentSpeed: 0,
    attackPose: 0,
    castPose: 0,
    firstPerson: false,
    deadT: 0,
    accent: p.accent,
  };

  function setFirstPerson(fp) {
    state.firstPerson = fp;
    headGroup.visible = !fp;
    // 第一人称保留手臂 / 身体
    model.traverse((o) => {
      if (o.userData?.isOutline && fp) o.visible = false;
    });
    if (!fp) {
      model.traverse((o) => {
        if (o.userData?.isOutline) o.visible = true;
      });
    }
  }

  function update(dt, info = {}) {
    state.time += dt;
    const t = state.time;
    const speed = info.speed || 0;
    const move = clamp(speed / 4.5, 0, 1.25);
    const ts = info.timeScale || 1;
    const canAnimate = !info.frozen;
    const localDt = canAnimate ? dt * ts : 0;
    state.currentSpeed = damp(state.currentSpeed, speed, 8, dt);
    state.walkPhase += localDt * (3.2 + state.currentSpeed * 1.8);
    const dead = info.dead;
    const attack = info.attackPose || 0;
    const cast = info.castPose || 0;
    state.attackPose = attack;
    state.castPose = cast;

    const walkSwing = Math.sin(state.walkPhase) * 0.85 * clamp(state.currentSpeed / 4, 0, 1);
    const idleSway = Math.sin(t * 1.6) * 0.025;
    const air = !info.grounded && !dead;

    // 身体起伏
    const bob = info.grounded === false ? 0 : Math.abs(Math.sin(state.walkPhase)) * 0.03 * move;
    model.position.y = dead ? 0 : bob + Math.sin(t * 1.7) * 0.004;
    model.rotation.x = damp(model.rotation.x, dead ? -0.05 : (move > 0.1 ? 0.06 : 0), 5, dt);
    model.rotation.z = damp(model.rotation.z, dead ? 1.48 : (info.hurt ? -0.08 : 0), dead ? 3.2 : 6, dt);
    if (dead) {
      state.deadT += dt;
      model.position.y = damp(model.position.y, 0.12, 4, dt);
    } else {
      state.deadT = 0;
    }

    // 呼吸
    torso.scale.set(1 + Math.sin(t * 1.55) * 0.008, 1 + Math.sin(t * 1.55 + 0.4) * 0.01, 1);
    torso.rotation.z = damp(torso.rotation.z, attack * 0.12, 10, dt);
    torso.rotation.x = damp(torso.rotation.x, cast * -0.12 + (air ? 0.04 : 0), 8, dt);

    legPivots.forEach((leg, i) => {
      const sign = i === 0 ? 1 : -1;
      let target = walkSwing * sign;
      if (air) target = sign * 0.28 + 0.18;
      if (dead) target = sign * 0.1;
      leg.rotation.x = damp(leg.rotation.x, target, 12, dt);
      leg.rotation.z = damp(leg.rotation.z, air ? sign * 0.08 : sign * 0.015, 8, dt);
    });

    arms.forEach((arm, i) => {
      const sign = arm.side;
      let rx = -walkSwing * sign * 0.8;
      let rz = sign * 0.1 + idleSway;
      let ry = 0;
      // 攻击：右臂先拉后刺，左臂辅助
      if (attack > 0.001) {
        const wind = Math.sin(clamp(attack / 0.32, 0, 1) * Math.PI * 0.5);
        const strike = Math.sin(clamp((attack - 0.22) / 0.5, 0, 1) * Math.PI);
        if (sign > 0) {
          rx = lerp(rx, -1.45 * wind - 0.5, 0.72) - strike * 0.35;
          rz = lerp(rz, 0.38, 0.5);
          ry = -0.2 - strike * 0.15;
        } else {
          rx = lerp(rx, 0.5, 0.4);
          rz = lerp(rz, -0.35, 0.4);
        }
      }
      // 施法：双臂前伸
      if (cast > 0.001) {
        const c = Math.sin(clamp(cast, 0, 1) * Math.PI);
        rx = lerp(rx, -1.35, c * 0.8);
        rz = lerp(rz, sign * 0.42, c * 0.6);
        ry = lerp(ry, sign * 0.12, c * 0.6);
      }
      if (air) {
        rx = lerp(rx, -0.45 - sign * 0.1, 0.55);
        rz = lerp(rz, sign * 0.35, 0.5);
      }
      if (dead) {
        rx = lerp(rx, -0.2, 0.2);
        rz = lerp(rz, sign * 0.6, 0.2);
      }
      arm.pivot.rotation.x = damp(arm.pivot.rotation.x, rx, 13, dt);
      arm.pivot.rotation.z = damp(arm.pivot.rotation.z, rz, 12, dt);
      arm.pivot.rotation.y = damp(arm.pivot.rotation.y, ry, 10, dt);
      if (arm.glow) arm.glow.material.opacity = 0.55 + Math.sin(t * 5) * 0.2;
    });

    // 外套 / 围巾飘动
    for (const tail of coatTails) {
      const target = -state.currentSpeed * 0.035 - 0.06 + Math.sin(t * 3.4 + tail.side) * 0.06;
      tail.group.rotation.x = damp(tail.group.rotation.x, target + (air ? -0.25 : 0), 4, dt);
      tail.group.rotation.z = damp(tail.group.rotation.z, tail.side * 0.075 + Math.sin(t * 2.1 + tail.side) * 0.02, 4, dt);
    }
    for (const tail of state.scarfTails) {
      tail.group.rotation.x = damp(tail.group.rotation.x, 0.28 + state.currentSpeed * 0.04 + Math.sin(t * 4.2 + tail.side) * 0.14, 5, dt);
      tail.group.rotation.z = damp(tail.group.rotation.z, tail.side * 0.22 + Math.sin(t * 3.6) * 0.08, 5, dt);
    }

    // 头部
    head.rotation.y = damp(head.rotation.y, (info.lookYawOffset || 0) * 0.3 + Math.sin(t * 0.8) * 0.025, 5, dt);
    head.rotation.x = damp(head.rotation.x, (info.lookPitchOffset || 0) * 0.25, 5, dt);
    head.rotation.z = damp(head.rotation.z, dead ? 0.2 : Math.sin(t * 0.7) * 0.02, 5, dt);

    // 悬浮物
    state.orbitals.forEach((o, i) => {
      o.obj.position.set(
        Math.sin(t * o.speed + o.angle) * o.radius,
        o.y + Math.sin(t * 1.8 + i) * o.bob,
        Math.cos(t * o.speed + o.angle) * o.radius
      );
      o.obj.rotation.x += dt * 1.2;
      o.obj.rotation.y += dt * 1.7;
      if (o.obj.material && o.obj.material.opacity !== undefined) {
        o.obj.material.opacity = 0.55 + Math.sin(t * 3 + i) * 0.2;
      }
    });
    if (auraRing) {
      auraRing.rotation.z += dt * 0.22;
      auraRing.material.opacity = 0.2 + Math.sin(t * 2.4) * 0.06;
    }
    if (shadow) shadow.material.opacity = info.grounded ? 0.3 : 0.13;

    if (info.firstPerson !== undefined && info.firstPerson !== state.firstPerson) {
      setFirstPerson(info.firstPerson);
    }
  }

  function playAttackPose() {
    state.attackPose = 0.001;
  }

  function dispose() {
    group.traverse((o) => {
      if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }

  return { ...state, update, setFirstPerson, playAttackPose, dispose, definition: def };
}

function createToonMaterialScalar(color) {
  // 避免循环依赖时使用一个轻量卡通材质
  return new THREE.MeshToonMaterial({ color, gradientMap: getGradientMap() });
}

export function disposeCharacterModel(model) {
  if (!model) return;
  model.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
  model.group.removeFromParent();
}

