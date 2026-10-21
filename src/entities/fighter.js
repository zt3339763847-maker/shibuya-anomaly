import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildCharacter } from './characterModel.js';
import { clamp, damp, dampAngle, lerp, rand, dist2D, TAU } from '../core/utils.js';

const CAPSULE_HALF = 0.55;
const CAPSULE_RADIUS = 0.32;
const CAPSULE_OFFSET = CAPSULE_HALF + CAPSULE_RADIUS + 0.02;
const GRAVITY = 25.5;

let _sequence = 0;

export class Fighter {
  constructor(game, def, opts = {}) {
    this.game = game;
    this.def = def;
    this.id = opts.id || `${def.id}-${++_sequence}`;
    this.name = opts.name || def.name;
    this.isBot = !!opts.isBot;
    this.isLocal = !!opts.isLocal;
    this.netId = opts.netId || null;
    this.playerColor = opts.playerColor || def.color;
    this.team = opts.team ?? 0;
    this.spawnIndex = opts.spawnIndex ?? 0;

    this.maxHp = def.hp;
    this.hp = def.hp;
    this.lives = opts.lives ?? 3;
    this.eliminated = false;
    this.dead = false;
    this.deathTime = 0;
    this.respawnTimer = 0;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.verticalVelocity = 0;
    this.knockback = new THREE.Vector3();
    this.grounded = true;
    this.yaw = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.moveX = 0;
    this.moveZ = 0;
    this.intentSpeed = 0;
    this.currentSpeed = 0;

    this.kills = 0;
    this.deaths = 0;
    this.score = 0;
    this.damageDealt = 0;
    this.destruction = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.attackTimer = 0;
    this.attackDuration = 0.36;
    this.attackCooldown = 0;
    this.pendingHit = null;
    this.castTimer = 0;
    this.castDuration = 0.5;
    this.pendingJump = 0;
    this.dodgeTimer = 0;
    this.dodgeCooldown = 0;
    this.dodgeDir = new THREE.Vector3();
    this.overloadDash = 0;
    this.overloadArmed = 0;
    this.meteorSlam = false;
    this.spaceEcho = 0;
    this.wallSlamArmed = 0;

    this.stunTimer = 0;
    this.rootTimer = 0;
    this.slowTimer = 0;
    this.slowFactor = 0.68;
    this.jumpLock = 0;
    this.invulnTimer = 0;
    this.hitFlash = 0;
    this.knockdownTimer = 0;
    this.hasteTimer = 0;
    this.hastePower = 0;
    this.barrierTimer = 0;
    this.barrierItem = null;
    this.pressureTimer = 0;
    this.frozen = false;
    this.revealTimer = 0;

    this.quantumMarks = 0;
    this.markTimer = 0;
    this.netLinkedTimer = 0;
    this.fateLinked = false;
    this.lastAttacker = null;
    this.lastAttackerTime = 0;

    this.cds = { q: 0, e: 0, r: 0 };
    this.cdMaxs = { q: def.skills.q.cd, e: def.skills.e.cd, r: def.skills.r.cd };
    this.charges = { q: 0, e: 0, r: 0 };
    this.chargeMax = { q: def.skills.q.charges || 0, e: def.skills.e.charges || 0, r: 0 };
    this.rechargeTimers = { q: 0, e: 0 };
    for (const key of ['q', 'e']) {
      if (this.chargeMax[key]) {
        this.charges[key] = this.chargeMax[key];
        this.rechargeTimers[key] = 0;
      }
    }

    this.shards = 0;
    this.shardTimer = 0;
    this.shardMax = def.id === 'wangchen' ? 3 : 0;

    this.skillCasts = { q: 0, e: 0, r: 0 };
    this.damageLog = [];
    this.history = [];
    this.historyTimer = 0;
    this.meteorVisual = null;
    this.lastSlam = -10;

    this.visual = buildCharacter(def);
    this.model = this.visual;
    this.game.scene.add(this.visual.group);
    this._flashMats = this._collectFlashMaterials();
    this._flashRestore = [];
    this._buildNameplate();

    this._createPhysics();
    this.spawnAt(game.arena.spawnPoints[this.spawnIndex % game.arena.spawnPoints.length]);
    this.setAim(Math.atan2(-this.pos.x, -this.pos.z), 0);
  }

  _collectFlashMaterials() {
    const mats = [];
    this.visual.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive && o.material.isMeshToonMaterial) mats.push(o.material);
    });
    return mats;
  }

  _buildNameplate() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    const color = this.playerColor;
    // 背后的斜块
    ctx.fillStyle = 'rgba(7,7,13,.62)';
    ctx.beginPath();
    ctx.moveTo(122, 22); ctx.lineTo(494, 22); ctx.lineTo(470, 92); ctx.lineTo(116, 92); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(122, 94); ctx.lineTo(470, 94); ctx.stroke();
    // 菱形
    ctx.save();
    ctx.translate(60, 57); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.fillRect(-17, -17, 34, 34);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
    ctx.font = 'bold 43px "Microsoft YaHei", "Yu Gothic", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.name.slice(0, 10), 136, 58);
    ctx.font = '18px "Cascadia Code", monospace';
    ctx.fillStyle = 'rgba(255,255,255,.52)';
    ctx.fillText(this.isBot ? 'CPU' : this.isLocal ? 'YOU' : 'ONLINE', 136, 91);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    const mat = new THREE.SpriteMaterial({
      map: texture, transparent: true, opacity: 0.9, depthTest: true, depthWrite: false, toneMapped: false,
    });
    this.nameplate = new THREE.Sprite(mat);
    this.nameplate.scale.set(2.35, 0.59, 1);
    this.nameplate.position.y = 2.16;
    this.nameplate.renderOrder = 4;
    this.visual.group.add(this.nameplate);
  }

  _createPhysics() {
    const { world } = this.game;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(0, 5, 0)
        .setCcdEnabled(true)
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS)
        .setFriction(0.12)
        .setRestitution(0.02),
      this.body
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.36, 0.22, false);
    this.controller.enableSnapToGround(0.25);
    this.controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((38 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(85);
    this.game.registerFighterCollider(this.collider.handle);
  }

  /* ---------------------------------------------------------- lifecycle */
  spawnAt(point, yaw = null) {
    this.pos.set(point.x, point.y + 0.06, point.z);
    this.yaw = yaw ?? Math.atan2(-point.x, -point.z);
    this.aimYaw = this.yaw;
    this.aimPitch = 0;
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y + CAPSULE_OFFSET, z: this.pos.z }, true);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + CAPSULE_OFFSET, z: this.pos.z });
    this.collider.setEnabled(true);
    this.visual.group.position.copy(this.pos);
    this.visual.group.rotation.y = this.yaw;
    this.visual.group.visible = true;
    this.dead = false;
    this.deathTime = 0;
    this.hp = this.maxHp;
    this.eliminated = false;
    this.knockback.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.moveX = this.moveZ = 0;
    this.stunTimer = this.rootTimer = this.slowTimer = this.knockdownTimer = 0;
    this.invulnTimer = 1.2;
    this.hitFlash = 0;
    this.frozen = false;
    this.dodgeTimer = 0;
    this.attackTimer = 0;
    this.castTimer = 0;
    this.pendingHit = null;
    this.history.length = 0;
    this.damageLog.length = 0;
    this.history.push({ t: this.game.elapsed, x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  respawn(point) {
    this.spawnAt(point, Math.atan2(-point.x, -point.z));
    this.cds.q = this.cds.e = this.cds.r = 0;
    this.charges.q = this.chargeMax.q;
    this.charges.e = this.chargeMax.e;
    this.rechargeTimers.q = this.rechargeTimers.e = 0;
    this.barrierTimer = 0;
    if (this.barrierItem) { this.barrierItem.kill(); this.barrierItem = null; }
    this._setFlash(false);
    this.visual.group.visible = true;
    this.visual.model.rotation.z = 0;
    this.visual.model.position.y = 0;
    if (this.isLocal) this.game.ui?.toast('重新投入战场');
  }

  dispose() {
    this.game.unregisterFighterCollider(this.collider.handle);
    try { this.game.world.removeRigidBody(this.body); } catch (e) { /* noop */ }
    try { this.controller.free?.(); } catch (e) { /* noop */ }
    this.visual.group.removeFromParent();
    this.visual.dispose?.();
    if (this.nameplate?.material?.map) this.nameplate.material.map.dispose();
    this.nameplate?.material?.dispose();
  }

  /* ---------------------------------------------------------- helpers */
  get alive() {
    return !this.dead && !this.eliminated;
  }

  get targetable() {
    return !this.dead && !this.eliminated;
  }

  get canAct() {
    return this.alive && this.stunTimer <= 0 && !this.frozen;
  }

  get actionSpeed() {
    return this.hasteTimer > 0 ? 1 + this.hastePower : 1;
  }

  get cdRate() {
    return this.hasteTimer > 0 ? 1 + this.hastePower : 1;
  }

  get speed() {
    let s = this.def.speed;
    if (this.hasteTimer > 0) s *= 1 + this.hastePower;
    if (this.slowTimer > 0) s *= this.slowFactor;
    if (this.pressureTimer > 0) s *= 0.86;
    if (this.attackTimer > 0) s *= 0.52;
    if (this.rootTimer > 0) s = 0;
    return s;
  }

  setAim(yaw, pitch) {
    if (Number.isFinite(yaw)) this.aimYaw = yaw;
    if (Number.isFinite(pitch)) this.aimPitch = clamp(pitch, -1.15, 1.05);
  }

  setIntent(x, z) {
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    this.moveX = x;
    this.moveZ = z;
    this.intentSpeed = Math.min(1, len);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));
  }

  aimDirection(out = new THREE.Vector3()) {
    const cp = Math.cos(this.aimPitch);
    return out.set(Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), Math.cos(this.aimYaw) * cp).normalize();
  }

  getAimOrigin(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.38, this.pos.z);
  }

  getAimData(range = 20) {
    const origin = this.getAimOrigin(new THREE.Vector3());
    const dir = this.aimDirection(new THREE.Vector3());
    const point = origin.clone().addScaledVector(dir, range);
    // 粗略吸附到地面，避免瞄准点飞到天空
    if (point.y < 0.15 && dir.y < -0.01) {
      const t = (0.15 - origin.y) / dir.y;
      if (t > 0) point.copy(origin).addScaledVector(dir, Math.min(t, range));
    }
    return { origin, dir, point };
  }

  getCenter(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
  }

  teleportTo(x, y, z) {
    this.pos.set(x, y, z);
    this.body.setTranslation({ x, y: y + CAPSULE_OFFSET, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + CAPSULE_OFFSET, z });
    this.visual.group.position.copy(this.pos);
    this.verticalVelocity = 0;
    this.grounded = false;
    this.history.push({ t: this.game.elapsed, x, y, z });
  }

  distanceTo(other) {
    return dist2D(this.pos, other.pos);
  }

  addScore(amount) {
    this.score += amount;
  }

  heal(amount, opts = {}) {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const diff = this.hp - before;
    if (diff > 0) {
      this.game.ui?.spawnDamageNumber(new THREE.Vector3(this.pos.x, this.pos.y + 1.9, this.pos.z), `+${Math.round(diff)}`, 'heal');
      this.game.effects.particleBurst(new THREE.Vector3(this.pos.x, this.pos.y + 1, this.pos.z), 0x57f2a6, 14, {
        speed: 2.2, life: 0.8, size: 0.16, gravity: -4, up: 0.8,
      });
    }
    return diff;
  }

  addStatus(type, duration, data = {}) {
    switch (type) {
      case 'stun': this.stunTimer = Math.max(this.stunTimer, duration); break;
      case 'root': this.rootTimer = Math.max(this.rootTimer, duration); break;
      case 'slow': this.slowTimer = Math.max(this.slowTimer, duration); this.slowFactor = data.factor ?? 0.68; break;
      case 'haste': this.hasteTimer = Math.max(this.hasteTimer, duration); this.hastePower = data.power ?? 1; break;
      case 'knockdown': this.knockdownTimer = Math.max(this.knockdownTimer, duration); break;
      case 'reveal': this.revealTimer = Math.max(this.revealTimer, duration); break;
      case 'mark': this.quantumMarks = Math.min(3, this.quantumMarks + 1); this.markTimer = 5; break;
      case 'net': this.netLinkedTimer = Math.max(this.netLinkedTimer, duration); break;
      default: break;
    }
  }

  applyKnockback(dir, force, up = 0, opts = {}) {
    if (!dir) return;
    const d = dir.clone();
    d.y = 0;
    if (d.lengthSq() < 0.001) d.set(0, 0, 1);
    d.normalize();
    this.knockback.addScaledVector(d, force);
    if (up) {
      this.verticalVelocity = Math.max(this.verticalVelocity, up);
      this.grounded = false;
    }
    if (force > 8 || opts.knockdown) {
      this.wallSlamArmed = Math.max(this.wallSlamArmed, 0.9);
      this.addStatus('knockdown', opts.knockdownTime || 0.7);
    }
    if (this.knockback.length() > 30) this.knockback.setLength(30);
  }

  _setFlash(on) {
    if (on) {
      if (this._flashRestore.length) return;
      for (const m of this._flashMats) {
        this._flashRestore.push([m, m.emissive.getHex(), m.emissiveIntensity]);
        m.emissive.setHex(0xffe0e8);
        m.emissiveIntensity = 0.75;
      }
    } else {
      for (const [m, hex, intensity] of this._flashRestore) {
        m.emissive.setHex(hex);
        m.emissiveIntensity = intensity;
      }
      this._flashRestore.length = 0;
    }
  }

  /* ---------------------------------------------------------- inputs */
  queueJump() {
    if (!this.canAct || this.dodgeTimer > 0) return false;
    this.pendingJump = 0.16;
    return true;
  }

  jump() {
    if (!this.canAct || !this.grounded || this.rootTimer > 0) return false;
    let jump = this.def.jump;
    if (this.pressureTimer > 0) jump *= 0.53;
    this.verticalVelocity = jump;
    this.grounded = false;
    this.pendingJump = 0;
    this.game.sound?.jump(this);
    this.game.effects.particleBurst(new THREE.Vector3(this.pos.x, this.pos.y + 0.1, this.pos.z), this.def.palette.accent, 10, {
      speed: 2.4, life: 0.35, size: 0.1, gravity: 3, up: 0.2,
    });
    return true;
  }

  tryDodge() {
    if (!this.canAct || this.dodgeCooldown > 0 || this.stunTimer > 0 || this.rootTimer > 0) return false;
    let dx = this.moveX, dz = this.moveZ;
    if (Math.hypot(dx, dz) < 0.1) {
      dx = Math.sin(this.aimYaw);
      dz = Math.cos(this.aimYaw);
    }
    const len = Math.hypot(dx, dz) || 1;
    this.dodgeDir.set(dx / len, 0, dz / len);
    this.dodgeTimer = 0.23;
    this.dodgeCooldown = 0.95;
    this.invulnTimer = Math.max(this.invulnTimer, 0.3);
    this.game.effects.dashTrail(this.visual, this.def.palette.accent, 0.35);
    this.game.sound?.dodge(this);
    this.game.ui?.flashSpeed();
    return true;
  }

  tryAttack() {
    if (!this.canAct || this.attackCooldown > 0 || this.stunTimer > 0) return false;
    const maxCombo = this.def.id === 'hezeyou' ? 4 : 3;
    if (this.comboTimer <= 0) this.combo = 1;
    else this.combo = this.combo >= maxCombo ? 1 : this.combo + 1;
    this.comboTimer = 1.0;
    this.comboCountWindow = Math.max(1, this.combo);
    this.maxCombo = Math.max(this.maxCombo || 0, this.combo);
    const ranged = this.def.id === 'guojunxi' || this.def.id === 'hezeyou';
    const duration = (ranged ? 0.34 : 0.4) / this.actionSpeed;
    this.attackDuration = duration;
    this.attackTimer = duration;
    this.attackCooldown = 0.34 / this.actionSpeed;
    const aim = this.getAimData(this.def.id === 'guojunxi' ? 24 : 30);
    this.pendingHit = {
      at: duration * 0.38,
      elapsed: 0,
      combo: this.combo,
      maxCombo,
      aim,
      echo: this.spaceEcho > 0,
    };
    this.castTimer = 0;
    this.visual.playAttackPose();
    this.game.sound?.swing(this, this.combo);
    return true;
  }

  trySkill(slot) {
    if (!this.canAct || this.stunTimer > 0) return false;
    const skill = this.def.skills[slot];
    if (!skill) return false;
    if (this.def.id === 'zhoutong' && slot === 'e' && this.overloadArmed > 0) {
      if (this.game.abilities.cast(this, slot)) {
        this.overloadArmed = 0;
        this.castTimer = this.castDuration;
        return true;
      }
      return false;
    }
    if (this.chargeMax[slot] > 0) {
      if (this.charges[slot] <= 0) {
        this.game.ui?.toast(`${skill.name} 充能中`);
        return false;
      }
    } else if (this.cds[slot] > 0) {
      this.game.ui?.toast(`${skill.name} 冷却 ${this.cds[slot].toFixed(1)}s`);
      return false;
    }
    const castOk = this.game.abilities.cast(this, slot);
    if (!castOk) return false;
    const now = this.game.elapsed;
    this.skillCasts[slot]++;
    this.castTimer = this.castDuration;
    this.attackTimer = 0;
    this.pendingHit = null;
    this.game.network?.onAction?.(this, slot);

    if (this.chargeMax[slot] > 0) {
      this.charges[slot]--;
      if (this.charges[slot] < this.chargeMax[slot] && this.rechargeTimers[slot] <= 0) {
        this.rechargeTimers[slot] = skill.cd;
      }
    } else {
      let cd = skill.cd;
      if (this.def.id === 'wangchen' && this.shards > 0) {
        this.shards--;
        cd *= 0.7;
        this.hasteTimer = Math.max(this.hasteTimer, 2);
        this.hastePower = Math.max(this.hastePower, 0.35);
        this.game.ui?.spawnDamageNumber(new THREE.Vector3(this.pos.x, this.pos.y + 2.2, this.pos.z), '残片 · 加速', 'heal');
        this.game.effects.castAura(this, 0xffcf5c, 0.7);
        this.game.sound?.shard(this);
      }
      this.cds[slot] = cd;
      this.cdMaxs[slot] = cd;
    }
    return true;
  }

  useShard() {
    return false;
  }

  /* ---------------------------------------------------------- network */
  applyNetSnapshot(s) {
    if (!s || typeof s !== 'object') return;
    const p = Array.isArray(s.p) ? s.p : null;
    if (!p || p.length < 3 || !p.slice(0, 3).every((v) => Number.isFinite(Number(v)))) return;
    const num = (value, min, max, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? clamp(n, min, max) : fallback;
    };
    const hp = num(s.hp, 0, this.maxHp, this.hp);
    const yaw = num(s.yaw, -10000, 10000, this.yaw);
    this.netTarget = {
      x: clamp(Number(p[0]), -500, 500),
      y: clamp(Number(p[1]), -100, 200),
      z: clamp(Number(p[2]), -500, 500),
      yaw, hp,
    };
    this.hp = hp;
    this.lives = num(s.lives, 0, 999, this.lives);
    this.kills = num(s.kills, 0, 99999, this.kills);
    this.score = num(s.score, 0, 9999999, this.score);
    this.damageDealt = num(s.damageDealt, 0, 9999999, this.damageDealt);
    this.destruction = num(s.destruction, 0, 9999, this.destruction);
    this.dead = !!s.dead;
    this.eliminated = !!s.elim;
    this.netAttackPose = num(s.at, 0, 1);
    this.netCastPose = num(s.ct, 0, 1);
    this.stunTimer = num(s.stun, 0, 30);
    this.barrierTimer = num(s.barrier, 0, 30);
    this.fateLinked = !!s.fate;
    this.quantumMarks = num(s.marks, 0, 3);
    if (Array.isArray(s.cds)) {
      this.cds = { q: num(s.cds[0], 0, 999), e: num(s.cds[1], 0, 999), r: num(s.cds[2], 0, 999) };
    }
    if (Array.isArray(s.ch)) {
      this.charges = { q: num(s.ch[0], 0, 3), e: num(s.ch[1], 0, 3), r: 0 };
    }
    this.shards = num(s.shards, 0, 3, this.shards);
    this.aimYaw = yaw;
    if (!this.netPos) this.netPos = new THREE.Vector3(this.netTarget.x, this.netTarget.y, this.netTarget.z);
    this.netPos.set(this.netTarget.x, this.netTarget.y, this.netTarget.z);
    this.visual.group.visible = !this.dead;
  }

  updateNetVisual(dt) {
    if (this.netTarget) {
      // 客户端插值
      this.pos.x = damp(this.pos.x, this.netTarget.x, 16, dt);
      this.pos.y = damp(this.pos.y, this.netTarget.y, 16, dt);
      this.pos.z = damp(this.pos.z, this.netTarget.z, 16, dt);
      this.yaw = dampAngle(this.yaw, this.netTarget.yaw, 16, dt);
      if (this.netTarget.hp <= 0) this.visual.group.visible = false;
    }
    this.visual.group.position.copy(this.pos);
    if (!this.dead) this.visual.group.rotation.y = this.yaw;
    const attackPose = this.netAttackPose || 0;
    const castPose = this.netCastPose || 0;
    this.visual.update(dt, {
      speed: 0, grounded: true, attackPose, castPose, hurt: this.hitFlash > 0,
      dead: this.dead, frozen: false, firstPerson: this.isLocal && this.game.cameraRig?.firstPerson,
    });
    this._updateNameplate();
    this.nameplate.visible = this.nameplate.visible && !this.isLocal && !this.dead;
  }

  /* ---------------------------------------------------------- simulation */
  update(dt, context = {}) {
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.hitFlash === 0 && this._flashRestore.length) this._setFlash(false);
    this.shardTimer += dt * (this.dead ? 0 : 1);
    if (this.frozen) {
      this.visual.update(dt, { frozen: true, dead: false, speed: 0, grounded: this.grounded, firstPerson: this.isLocal && this.game.cameraRig?.firstPerson });
      return;
    }

    this._tickTimers(dt);

    if (this.dead) {
      this.deathTime += dt;
      this.respawnTimer = Math.max(0, this.respawnTimer - dt);
      if (this.deathTime > 1.1) this.visual.group.visible = false;
      this.visual.update(dt, { dead: true, speed: 0, grounded: false, frozen: false, firstPerson: false });
      return;
    }

    this._updatePassive(dt);

    // jump buffer
    this.pendingJump = Math.max(0, this.pendingJump - dt);
    if (this.pendingJump > 0 && this.grounded && this.stunTimer <= 0) this.jump();

    // movement intent
    let moveX = this.moveX;
    let moveZ = this.moveZ;
    if (this.stunTimer > 0) { moveX = 0; moveZ = 0; }
    let moveSpeed = this.speed;
    let desiredX = moveX * moveSpeed;
    let desiredZ = moveZ * moveSpeed;

    if (this.dodgeTimer > 0) {
      const dodgeSpeed = 17 * (this.pressureTimer > 0 ? 0.82 : 1);
      desiredX = this.dodgeDir.x * dodgeSpeed;
      desiredZ = this.dodgeDir.z * dodgeSpeed;
      this.dodgeTimer -= dt;
    }
    if (this.overloadDash > 0) {
      const dir = this.forward(new THREE.Vector3());
      desiredX = dir.x * 19;
      desiredZ = dir.z * 19;
      this.overloadDash -= dt;
      this.verticalVelocity = Math.max(this.verticalVelocity, 2);
    }
    if (this.rootTimer > 0 || this.stunTimer > 0) {
      desiredX = 0;
      desiredZ = 0;
    }
    const kbLen = this.knockback.length();
    if (kbLen > 0.05) {
      desiredX += this.knockback.x;
      desiredZ += this.knockback.z;
      this.knockback.multiplyScalar(Math.exp(-4.5 * dt));
      if (this.knockback.length() < 0.15) this.knockback.set(0, 0, 0);
    }

    // vertical
    this.verticalVelocity -= GRAVITY * dt;
    if (this.verticalVelocity < -34) this.verticalVelocity = -34;
    if (this.overloadArmed > 0 && this.overloadDash > 0) this.verticalVelocity *= 0.2;

    const desired = {
      x: desiredX * dt,
      y: this.verticalVelocity * dt,
      z: desiredZ * dt,
    };
    const wasGrounded = this.grounded;
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      undefined,
      undefined,
      (col) => !this.game.isFighterCollider(col.handle)
    );
    const mv = this.controller.computedMovement();
    const collided = this.controller.numComputedCollisions() > 0;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = 0;

    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;

    // 高速撞墙（Wall-Splat）
    if (!this.grounded && wasGrounded) {
      this.game.sound?.land(this);
    }
    if (this.wallSlamArmed > 0 && kbLen > 5.5 && collided && this.game.elapsed - this.lastSlam > 0.6) {
      let wallNormal = null;
      for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
        const c = this.controller.computedCollision(i);
        if (c && Math.abs(c.normal1.y) < 0.65) { wallNormal = c.normal1; break; }
      }
      if (wallNormal) {
        this.lastSlam = this.game.elapsed;
        this.wallSlamArmed = 0;
        this.game.onWallSlam(this, kbLen, wallNormal);
        this.knockback.set(0, 0, 0);
        this.verticalVelocity = Math.max(2, this.verticalVelocity * -0.15);
      }
    }

    // 防止跑出物理世界太远
    this.body.setNextKinematicTranslation({
      x: this.pos.x, y: this.pos.y + CAPSULE_OFFSET, z: this.pos.z,
    });

    // 世界外 / 坠落
    if (this.pos.y < this.game.arena.killY) {
      this.game.onFighterFall(this);
      return;
    }

    // 攻击判定触发
    if (this.pendingHit) {
      this.pendingHit.elapsed += dt;
      if (this.pendingHit.elapsed >= this.pendingHit.at) {
        const hit = this.pendingHit;
        this.pendingHit = null;
        this.game.performBasicAttack(this, hit);
      }
    }

    // overload 陨石落地
    if (this.meteorSlam && this.grounded) {
      this.meteorSlam = false;
      this.game.abilities.meteorImpact(this);
    }

    // 朝向
    this.yaw = dampAngle(this.yaw, this.aimYaw, 16, dt);
    this.visual.group.position.copy(this.pos);
    this.visual.group.rotation.y = this.yaw;

    // 角色间柔性分离（避免完全重叠）
    this.game.separateFighters(this, dt);

    this.currentSpeed = damp(this.currentSpeed, Math.hypot(desiredX, desiredZ), 10, dt);

    const attackPose = this.attackTimer > 0 ? 1 - clamp(this.attackTimer / this.attackDuration, 0, 1) : 0;
    const castPose = this.castTimer > 0 ? 1 - clamp(this.castTimer / Math.max(0.001, this.castDuration), 0, 1) : 0;
    this.visual.update(dt, {
      speed: this.currentSpeed,
      grounded: this.grounded,
      attackPose,
      castPose,
      hurt: this.hitFlash > 0,
      dead: false,
      frozen: false,
      firstPerson: this.isLocal && this.game.cameraRig?.firstPerson,
    });
    this._updateNameplate();
  }

  _tickTimers(dt) {
    const rate = this.cdRate;
    for (const key of ['q', 'e', 'r']) {
      const skill = this.def.skills[key];
      if (this.chargeMax[key] > 0) {
        if (this.charges[key] < this.chargeMax[key]) {
          this.rechargeTimers[key] -= dt * rate;
          if (this.rechargeTimers[key] <= 0) {
            this.charges[key]++;
            this.rechargeTimers[key] = this.charges[key] < this.chargeMax[key] ? skill.cd : 0;
          }
        }
        this.cds[key] = this.charges[key] < this.chargeMax[key] ? Math.max(0, this.rechargeTimers[key]) : 0;
      } else {
        this.cds[key] = Math.max(0, this.cds[key] - dt * rate);
      }
    }
    this.attackCooldown = Math.max(0, this.attackCooldown - dt * rate);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt * rate);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0) this.combo = 0;
    this.stunTimer = Math.max(0, this.stunTimer - dt);
    this.rootTimer = Math.max(0, this.rootTimer - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.jumpLock = Math.max(0, this.jumpLock - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.knockdownTimer = Math.max(0, this.knockdownTimer - dt);
    this.hasteTimer = Math.max(0, this.hasteTimer - dt);
    if (this.hasteTimer <= 0) this.hastePower = 0;
    this.barrierTimer = Math.max(0, this.barrierTimer - dt);
    if (this.barrierTimer <= 0 && this.barrierItem) {
      this.barrierItem.kill();
      this.barrierItem = null;
    }
    this.pressureTimer = Math.max(0, this.pressureTimer - dt);
    this.spaceEcho = Math.max(0, this.spaceEcho - dt);
    this.overloadArmed = Math.max(0, this.overloadArmed - dt);
    this.markTimer = Math.max(0, this.markTimer - dt);
    if (this.markTimer <= 0) this.quantumMarks = 0;
    this.netLinkedTimer = Math.max(0, this.netLinkedTimer - dt);
    this.revealTimer = Math.max(0, this.revealTimer - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt * this.actionSpeed);
    this.castTimer = Math.max(0, this.castTimer - dt * this.actionSpeed);
    this.wallSlamArmed = Math.max(0, this.wallSlamArmed - dt);
    this.historyTimer += dt;
    if (this.historyTimer > 0.08) {
      this.historyTimer = 0;
      this.history.push({ t: this.game.elapsed, x: this.pos.x, y: this.pos.y, z: this.pos.z });
      while (this.history.length > 48) this.history.shift();
    }
    if (this.damageLog.length) {
      const cutoff = this.game.elapsed - 3.2;
      while (this.damageLog.length && this.damageLog[0].t < cutoff) this.damageLog.shift();
    }
    if (this.shardMax && !this.dead) {
      if (this.shardTimer >= 10) {
        this.shardTimer -= 10;
        if (this.shards < this.shardMax) {
          this.shards++;
          this.game.ui?.toast(`时间残片 +1 (${this.shards}/${this.shardMax})`);
          if (this.isLocal) this.game.sound?.shardGain();
        }
      }
    }
  }

  _updatePassive(dt) {
    if (this.def.id === 'zhoutong') {
      for (const f of this.game.fighters) {
        if (!f.alive || f === this) continue;
        if (dist2D(this.pos, f.pos) <= 5.2) {
          f.pressureTimer = 0.14;
        }
      }
    }
  }

  _updateNameplate() {
    if (!this.nameplate) return;
    const show = !this.isLocal && this.alive && !this.dead;
    this.nameplate.visible = show;
    if (show) {
      const cam = this.game.camera;
      const d = cam.position.distanceTo(this.pos);
      this.nameplate.material.opacity = clamp(1.2 - d / 55, 0.18, 0.92);
    }
  }

  receiveDamage(amount, source, opts = {}) {
    if (this.dead || this.eliminated) return 0;
    if (this.invulnTimer > 0 && !opts.trueDamage) return 0;
    const dmg = Math.max(1, Math.round(amount));
    this.hp -= dmg;
    this.hitFlash = 0.12;
    this._setFlash(true);
    this.lastAttacker = source || null;
    this.lastAttackerTime = this.game.elapsed;
    this.damageLog.push({ t: this.game.elapsed, amount: dmg });
    this.combo = 0;
    this.comboTimer = 0;
    if (this.quantumMarks > 0) this.markTimer = 5;
    if (opts.stun !== false) this.stunTimer = Math.max(this.stunTimer, opts.stun || 0.16);
    if (opts.slow) this.addStatus('slow', opts.slow, { factor: opts.slowFactor });
    if (opts.knockback && source) {
      const dir = opts.knockbackDir
        ? new THREE.Vector3(opts.knockbackDir.x, 0, opts.knockbackDir.z)
        : new THREE.Vector3(this.pos.x - source.pos.x, 0, this.pos.z - source.pos.z);
      this.applyKnockback(dir, opts.knockback, opts.up || 0, { knockdown: opts.knockdown });
    }
    const hpPos = new THREE.Vector3(this.pos.x, this.pos.y + 1.75, this.pos.z);
    this.game.effects.hitSpark(hpPos, opts.color || source?.def?.color || 0xffffff, dmg);
    this.game.ui?.spawnDamageNumber(hpPos, dmg, opts.crit ? 'crit' : opts.type || 'normal');
    if (opts.reflect) {
      this.game.ui?.spawnDamageNumber(new THREE.Vector3(this.pos.x, this.pos.y + 2.2, this.pos.z), '反弹', 'shield');
    }
    this.game.sound?.hit(this, dmg);
    if (source?.isLocal || this.isLocal) this.game.cameraRig?.shake(opts.heavy ? 0.18 : 0.08, opts.heavy ? 0.35 : 0.18);
    if (this.hp <= 0) {
      this.die(source);
    }
    return dmg;
  }

  die(source) {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.deathTime = 0;
    this.verticalVelocity = 0;
    this.knockback.set(0, 0, 0);
    this.attackTimer = 0;
    this.castTimer = 0;
    this.pendingHit = null;
    this.barrierTimer = 0;
    if (this.barrierItem) { this.barrierItem.kill(); this.barrierItem = null; }
    this.collider.setEnabled(false);
    this._setFlash(false);
    this.nameplate.visible = false;
    this.visual.group.visible = true;
    this.visual.model.rotation.z = 0;
    this.game.onFighterKilled(this, source);
  }

  getSnapshotState() {
    return {
      at: this.attackTimer > 0 ? 1 - clamp(this.attackTimer / this.attackDuration, 0, 1) : 0,
      ct: this.castTimer > 0 ? 1 - clamp(this.castTimer / this.castDuration, 0, 1) : 0,
    };
  }

  serialize() {
    return {
      id: this.id,
      netId: this.netId,
      name: this.name,
      defId: this.def.id,
      p: [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)],
      yaw: +this.yaw.toFixed(2),
      hp: Math.max(0, Math.round(this.hp)),
      lives: this.lives,
      kills: this.kills,
      deaths: this.deaths,
      score: Math.round(this.score),
      damageDealt: Math.round(this.damageDealt),
      destruction: this.destruction,
      dead: this.dead,
      elim: this.eliminated,
      at: this.getSnapshotState().at,
      ct: this.getSnapshotState().ct,
      stun: +this.stunTimer.toFixed(2),
      barrier: +this.barrierTimer.toFixed(2),
      fate: this.fateLinked,
      marks: this.quantumMarks,
      cds: [+this.cds.q.toFixed(2), +this.cds.e.toFixed(2), +this.cds.r.toFixed(2)],
      ch: [this.charges.q, this.charges.e, this.charges.r],
      shards: this.shards,
    };
  }
}

