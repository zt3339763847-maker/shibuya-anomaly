import * as THREE from 'three';
import { TAU, clamp, rand, randInt, choose, dist2D } from '../core/utils.js';
import { basicGlow, spriteGlow, getGlowTexture } from '../render/toon.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Vector3();

let fieldSeq = 0;

export class AbilitySystem {
  constructor(game) {
    this.game = game;
    this.fields = [];
  }

  cast(fighter, slot) {
    if (!fighter.alive) return false;
    let ok = false;
    switch (fighter.def.id) {
      case 'zhoutong': ok = this._zhou(fighter, slot); break;
      case 'guojunxi': ok = this._guo(fighter, slot); break;
      case 'hezeyou': ok = this._he(fighter, slot); break;
      case 'wangchen': ok = this._wang(fighter, slot); break;
      default: break;
    }
    if (ok) {
      this.game.sound?.cast(fighter);
      this.game.ui?.pulseSkill(slot);
      this.game.network?.broadcastAbility?.(fighter, slot);
    }
    return ok;
  }

  /* ======================================================== 周同 */
  _zhou(f, slot) {
    const g = this.game;
    if (slot === 'q') {
      const aim = g.resolveAim(f, 14);
      const target = aim.point.clone();
      target.y = 0.35;
      const start = f.pos.clone().setY(f.pos.y + 1.4);
      const visual = makeAnchorVisual(f.def.palette.accent);
      visual.position.copy(start);
      visual.scale.setScalar(0.4);
      const field = this.addField({
        type: 'anchor', owner: f, duration: 4.6,
        origin: start.clone(), target: target.clone(), visual, arrived: false,
        tick: 0, pulse: 0,
        update: (fd, dt) => {
          if (!fd.arrived) {
            const dir = _v.copy(fd.target).sub(fd.visual.position);
            const dist = dir.length();
            if (dist < 0.4) {
              fd.arrived = true;
              fd.visual.position.copy(fd.target);
              fd.visual.scale.setScalar(1);
              g.effects.ring(fd.target.clone().setY(0.05), f.def.palette.accent, { radius: 5.2, duration: 0.6, thickness: 0.05, opacity: 0.6 });
              g.effects.shockwave(fd.target.clone(), f.def.palette.accent, { radius: 2.6, count: 20, light: 4, dust: false });
              g.sound?.teleport();
            } else {
              dir.normalize();
              fd.visual.position.addScaledVector(dir, Math.min(dist, 26 * dt));
              fd.visual.rotation.y += dt * 6;
            }
          } else {
            fd.visual.rotation.y += dt * 2.4;
            fd.pulse += dt;
            const radius = 6.0;
            for (const e of g.fighters) {
              if (!e.alive || e === f) continue;
              const d = dist2D(e.pos, fd.target);
              if (d < radius) {
                const pull = _v2.set(fd.target.x - e.pos.x, 0, fd.target.z - e.pos.z);
                const dl = pull.length();
                if (dl > 0.15) {
                  pull.normalize();
                  e.knockback.addScaledVector(pull, 16 * dt * (1.3 - d / radius));
                  e.verticalVelocity += (1.1 * dt) * (e.grounded ? 1 : 0.2);
                }
                if (d < 2.2) e.rootTimer = Math.max(e.rootTimer, 0.18);
                if (fd.pulse >= 0.48) {
                  g.damage(e, 5, f, { type: 'skill', color: f.def.palette.accent, noKnockback: true, noMark: true, stun: false });
                }
              }
            }
            if (fd.pulse >= 0.48) {
              fd.pulse = 0;
              for (const d of g.arena.debris) {
                const dx = fd.target.x - d.body.translation().x;
                const dz = fd.target.z - d.body.translation().z;
                const dd = Math.hypot(dx, dz);
                if (dd < 7 && dd > 0.3) {
                  const mass = Math.max(0.5, d.body.mass());
                  d.body.applyImpulse({ x: (dx / dd) * mass * 4.5, y: mass * 1.5, z: (dz / dd) * mass * 4.5 }, true);
                }
              }
              g.effects.particleBurst(fd.target.clone().setY(0.5), f.def.palette.accent, 7, {
                speed: 1.5, life: 0.5, size: 0.12, gravity: -1, up: 0.4,
              });
            }
          }
        },
        end: () => {
          g.effects.particleBurst(fdPos(field), f.def.palette.accent, 26, { speed: 8, life: 0.6, size: 0.19, gravity: 3, color2: 0xffffff });
          g.effects.ring(fdPos(field), f.def.palette.accent, { radius: 3, duration: 0.35, thickness: 0.04 });
        },
      });
      g.ui?.centerCallout('重力锚点', 'GRAVITY ANCHOR / 4.6s');
      return true;
    }

    if (slot === 'e') {
      if (f.overloadArmed > 0) {
        // 二段：陨石坠击
        f.overloadArmed = 0;
        f.overloadDash = 0;
        f.meteorSlam = true;
        f.verticalVelocity = -30;
        f.invulnTimer = Math.max(f.invulnTimer, 0.45);
        f.castTimer = 0.45;
        g.cameraRig?.kickFov(6);
        g.sound?.teleport();
        this.addField({
          type: 'meteorTrail', owner: f, duration: 2.5,
          update: (fd, dt) => {
            if (!f.meteorSlam) { fd.t = Math.min(fd.t, 0.01); return; }
            g.effects.particleBurst(f.pos.clone().setY(f.pos.y + 1.2), f.def.palette.accent, 7, {
              speed: 2.2, life: 0.35, size: 0.16, gravity: -2, up: 0.2, color2: 0xffffff,
            });
            g.cameraRig?.shake(0.025, 0.08);
          },
        });
        g.ui?.centerCallout('陨石坠击', 'METEOR IMPACT');
        return true;
      }
      f.overloadArmed = 3.2;
      f.overloadDash = 0.42;
      f.verticalVelocity = Math.max(f.verticalVelocity, 4.5);
      g.effects.dashTrail(f.visual, f.def.palette.accent, 0.6);
      g.effects.castAura(f, f.def.palette.accent, 0.5);
      g.cameraRig?.kickFov(7);
      g.cameraRig?.shake(0.05, 0.15);
      g.ui?.centerCallout('反重力过载', '再次按 E 发动陨石坠击');
      return true;
    }

    if (slot === 'r') {
      const aim = g.resolveAim(f, 17);
      const center = aim.point.clone();
      center.y = 0.25;
      const bh = g.effects.blackHole(center, f.def.palette.accent, { duration: 3.3, radius: 8.5 });
      g.cameraRig?.shake(0.13, 0.55);
      g.cameraRig?.kickFov(5);
      g.screenFlash('#a973ff');
      g.sound?.explosion(true);
      g.ui?.centerCallout('坍缩奇点', 'SINGULARITY / 终焉轰炸');
      let dmgTimer = 0;
      let pullTimer = 0;
      let exploded = false;
      this.addField({
        type: 'singularity', owner: f, duration: 3.25, center: center.clone(), visual: bh,
        update: (fd, dt) => {
          dmgTimer += dt;
          pullTimer += dt;
          const radius = 8.4;
          for (const e of g.fighters) {
            if (!e.alive || e === f) continue;
            const d = dist2D(e.pos, center);
            if (d < radius) {
              const pull = _v.set(center.x - e.pos.x, 0, center.z - e.pos.z);
              const dl = pull.length();
              if (dl > 0.2) {
                pull.normalize();
                const strength = 28 * (1.15 - d / radius);
                e.knockback.addScaledVector(pull, strength * dt);
                if (!e.grounded && e.verticalVelocity < 0) e.verticalVelocity *= 0.96;
              }
              e.rootTimer = Math.max(e.rootTimer, 0.1);
              if (dmgTimer > 0.42) {
                g.damage(e, 7, f, { type: 'skill', color: f.def.palette.accent, noMark: true, noKnockback: true, stun: false });
              }
            }
          }
          if (dmgTimer > 0.42) dmgTimer = 0;
          if (pullTimer > 0.42) {
            pullTimer = 0;
            for (const d of g.arena.debris) {
              const t = d.body.translation();
              const dx = center.x - t.x, dz = center.z - t.z;
              const dd = Math.hypot(dx, dz);
              if (dd < 10 && dd > 0.2) {
                d.body.applyImpulse({ x: (dx / dd) * d.body.mass() * 8, y: 2.5, z: (dz / dd) * d.body.mass() * 8 }, true);
              }
            }
          }
          if (fd.t <= 0.35 && !exploded) {
            exploded = true;
            g.areaDamage(center, 9.2, 140, f, {
              knockback: 34, up: 14, knockdown: true, stun: 0.8, heavy: true, type: 'ult',
              breakDamage: 480, breakRadius: 10, color: 0xc07bff, ult: true,
            });
            g.effects.shockwave(center.clone(), 0xc07bff, { radius: 15, duration: 1.1, count: 80, light: 15 });
            g.effects.ring(center.clone(), 0xffffff, { radius: 20, duration: 0.7, thickness: 0.02, opacity: 0.8 });
            g.effects.particleBurst(center.clone().setY(1.5), 0xffffff, 70, { speed: 24, life: 1.3, size: 0.35, gravity: 4, color2: 0x7a36ff });
            g.cameraRig?.shake(0.45, 0.8);
            g.cameraRig?.kickFov(12);
            g.screenFlash('#ffffff');
            g.sound?.explosion(true);
            if (bh) bh.kill();
          }
        },
        end: () => {
          if (!exploded) {
            g.areaDamage(center, 9.2, 140, f, {
              knockback: 34, up: 14, knockdown: true, heavy: true, type: 'ult',
              breakDamage: 480, breakRadius: 10, color: 0xc07bff, ult: true,
            });
            g.effects.shockwave(center.clone(), 0xc07bff, { radius: 15, duration: 1.1, count: 70, light: 15 });
          }
        },
      });
      return true;
    }
    return false;
  }

  meteorImpact(f) {
    const g = this.game;
    const center = f.pos.clone();
    center.y = 0.1;
    g.areaDamage(center, 6.3, 105, f, {
      knockback: 25, up: 12, knockdown: true, stun: 0.55, heavy: true, type: 'skill',
      breakDamage: 320, breakRadius: 6.8, color: f.def.palette.accent,
    });
    g.effects.shockwave(center.clone(), f.def.palette.accent, { radius: 10, duration: 0.75, count: 54, light: 10 });
    g.effects.ring(center.clone(), 0xffffff, { radius: 12, duration: 0.55, thickness: 0.02, opacity: 0.7 });
    g.effects.particleBurst(center.clone().setY(0.8), 0xffffff, 40, { speed: 14, life: 0.9, size: 0.26, gravity: 9 });
    g.cameraRig?.shake(0.32, 0.55);
    g.cameraRig?.kickFov(10);
    g.screenFlash('#c18cff');
    g.sound?.explosion(true);
    g.ui?.centerCallout('陨石坠击', 'IMPACT');
  }

  /* ======================================================== 郭俊熙 */
  _guo(f, slot) {
    const g = this.game;
    if (slot === 'q') {
      const aim = g.resolveAim(f, 10);
      const dir = aim.dir.clone(); dir.y = 0;
      if (dir.lengthSq() < 0.01) dir.set(Math.sin(f.aimYaw), 0, Math.cos(f.aimYaw));
      dir.normalize();
      const from = f.pos.clone();
      let dest = f.pos.clone().addScaledVector(dir, 8);
      dest.x = clamp(dest.x, -21.4, 21.4);
      dest.z = clamp(dest.z, -21.4, 21.4);
      f.spaceEcho = 3;
      g.effects.afterimage(f.visual, f.def.palette.accent, { duration: 0.55 });
      f.teleportTo(dest.x, Math.max(0.15, f.pos.y + 0.1), dest.z);
      g.effects.teleportBurst(from.clone(), f.def.palette.accent);
      g.effects.teleportBurst(dest.clone(), f.def.palette.accent);
      g.effects.portal(from.clone().setY(from.y + 1.1), f.def.palette.accent, { duration: 0.55, scale: 0.65 });
      g.effects.portal(dest.clone().setY(dest.y + 1.1), f.def.palette.accent, { duration: 0.55, scale: 0.65 });
      g.effects.afterimage(f.visual, f.def.palette.accent, { duration: 0.4 });
      g.cameraRig?.setGlitch?.(0.4);
      g.postFX?.setGlitch(0.8);
      g.cameraRig?.kickFov(4);
      g.sound?.teleport();
      return true;
    }
    if (slot === 'e') {
      const targets = g.fighters.filter((e) => e.alive && e !== f && dist2D(e.pos, f.pos) <= 25);
      if (!targets.length) {
        g.ui?.toast('附近没有可置换的目标');
        return false;
      }
      targets.sort((a, b) => dist2D(a.pos, f.pos) - dist2D(b.pos, f.pos));
      const t = targets[0];
      const from = f.pos.clone();
      const to = t.pos.clone();
      g.effects.portal(from.clone().setY(from.y + 1.1), 0x8f7dff, { duration: 0.8, scale: 0.75 });
      g.effects.portal(to.clone().setY(to.y + 1.1), 0x8f7dff, { duration: 0.8, scale: 0.75 });
      g.effects.afterimage(f.visual, 0x8f7dff, { duration: 0.55 });
      g.effects.afterimage(t.visual, 0x8f7dff, { duration: 0.55 });
      f.teleportTo(to.x, Math.max(0.15, to.y + 0.1), to.z);
      t.teleportTo(from.x, Math.max(0.15, from.y + 0.1), from.z);
      f.spaceEcho = 3;
      t.addStatus('stun', 1.1);
      t.addStatus('reveal', 2.5);
      f.addStatus('stun', 0.18);
      g.effects.teleportBurst(to.clone(), 0x8f7dff);
      g.effects.teleportBurst(from.clone(), 0x8f7dff);
      g.postFX?.setGlitch(1.2);
      g.cameraRig?.shake(0.15, 0.25);
      g.screenFlash('#a18dff');
      g.ui?.centerCallout('因果置换', 'CAUSALITY SWAP / 空间对调');
      return true;
    }
    if (slot === 'r') {
      const center = f.pos.clone();
      g.effects.cloisterPortals(center.clone().setY(center.y + 1.3), 0x5af2ff, { count: 18, radius: 10 });
      g.effects.ring(center.clone().setY(0.08), 0x5af2ff, { radius: 11, duration: 2.2, thickness: 0.03, opacity: 0.35 });
      g.cameraRig?.shake(0.16, 0.4);
      g.cameraRig?.kickFov(6);
      g.postFX?.pulseSpeed(1);
      g.screenFlash('#bffcff');
      g.ui?.centerCallout('空间断层', 'INFINITE WORMHOLE / 15 HITS');
      f.invulnTimer = Math.max(f.invulnTimer, 2.6);
      let hits = 0;
      let interval = 0;
      this.addField({
        type: 'guoUlt', owner: f, duration: 2.5,
        update: (fd, dt) => {
          interval += dt;
          if (interval < 0.13) return;
          interval = 0;
          if (hits >= 15) { fd.t = 0; return; }
          const enemies = g.fighters.filter((e) => e.alive && e !== f && dist2D(e.pos, center) <= 16);
          if (!enemies.length) { fd.t = 0; return; }
          const target = choose(enemies);
          hits++;
          const tp = target.pos.clone().setY(target.pos.y + 1.1 + rand(-0.4, 0.9));
          const angle = rand(0, TAU);
          const portal = g.effects.portal(tp.clone().add(new THREE.Vector3(Math.cos(angle) * 1.7, 0, Math.sin(angle) * 1.7)), 0x8ffaff, {
            duration: 0.3, scale: 0.42, billboard: true,
          });
          g.effects.slash(tp, 0xd3ffff, { radius: 1.9, duration: 0.24, angle: Math.PI * 1.3 });
          g.effects.beam(f.pos.clone().setY(f.pos.y + 1.2), tp, 0x8ffaff, { duration: 0.12, width: 0.035 });
          g.effects.particleBurst(tp, 0x8ffaff, 12, { speed: 7, life: 0.3, size: 0.14, gravity: 0 });
          g.effects.afterimage(f.visual, 0x5af2ff, { duration: 0.25 });
          const final = hits >= 15;
          g.damage(target, final ? 36 : 7.5, f, {
            type: 'ult', color: 0x5af2ff, stun: final ? 0.6 : 0.12,
            knockback: final ? 17 : 1.8, up: final ? 7 : 0, heavy: final,
            noMark: true,
          });
          if (final) {
            g.effects.shockwave(target.pos.clone(), 0x5af2ff, { radius: 6, duration: 0.55, count: 30, light: 8, dust: false });
            g.cameraRig?.shake(0.2, 0.3);
            g.ui?.centerCallout('空间乱打', '15 / 15 COMPLETE');
          }
          g.sound?.beam();
        },
        end: () => {},
      });
      return true;
    }
    return false;
  }

  /* ======================================================== 何则佑 */
  _he(f, slot) {
    const g = this.game;
    if (slot === 'q') {
      const aim = g.resolveAim(f, 13);
      const point = aim.point.clone();
      point.y = 0.06;
      const net = g.effects.netTrap(point.clone(), 0x35ffcf, { radius: 2.65, duration: 20 });
      g.effects.ring(point.clone().setY(0.05), 0x35ffcf, { radius: 2.65, duration: 0.5, thickness: 0.22, opacity: 0.25 });
      const field = this.addField({
        type: 'net', owner: f, duration: 20, point: point.clone(), triggered: false, netItem: net,
        update: (fd, dt) => {
          if (fd.triggered) return;
          for (const e of g.fighters) {
            if (!e.alive || e === f) continue;
            if (dist2D(e.pos, fd.point) < 2.7) {
              fd.triggered = true;
              e.addStatus('root', 2.5);
              e.addStatus('net', 6);
              g.damage(e, 8, f, { type: 'skill', color: 0x35ffcf, noMark: false, noKnockback: true, stun: false });
              g.effects.shockwave(fd.point.clone(), 0x35ffcf, { radius: 3.2, duration: 0.5, count: 24, light: 5, dust: false });
              g.effects.particleBurst(e.pos.clone().setY(0.6), 0x35ffcf, 26, { speed: 5, life: 0.7, size: 0.18, gravity: 0 });
              g.effects.ring(e.pos.clone().setY(0.07), 0xffffff, { radius: 3, duration: 0.7, thickness: 0.045 });
              g.ui?.centerCallout('纳米磁网', 'TARGET LOCKED / ROOT 2.5s');
              g.sound?.freeze();
              break;
            }
          }
        },
        end: () => {
          if (net) net.kill();
        },
      });
      g.ui?.toast(`纳米磁网已布置 (剩余 ${Math.max(0, f.charges.q)} 充能)`);
      return true;
    }
    if (slot === 'e') {
      f.barrierTimer = 4.2;
      if (f.barrierItem) f.barrierItem.kill();
      f.barrierItem = g.effects.barrier(f, 0x5af2ff, 4.2);
      g.effects.ring(f.pos.clone().setY(0.08), 0x5af2ff, { radius: 3.4, duration: 0.5, thickness: 0.05 });
      g.effects.castAura(f, 0x5af2ff, 0.6);
      g.ui?.centerCallout('量子相位壁垒', 'BARRIER / 4.2s · 反弹 40%');
      return true;
    }
    if (slot === 'r') {
      const radius = 16;
      const matrix = g.effects.matrixField(f.pos.clone(), 0x35ffcf, { radius, duration: 8 });
      const linked = new Set(g.fighters.filter((e) => e.alive && e !== f && dist2D(e.pos, f.pos) <= radius));
      if (!linked.size) {
        g.ui?.toast('矩阵领域内没有敌人');
        // 仍然释放视觉效果，但无实际链接
      }
      linked.forEach((e) => { e.fateLinked = true; e.addStatus('reveal', 8); });
      g.matrix = { owner: f, targets: linked, duration: 8 };
      g.postFX?.pulseSpeed(0.8);
      g.screenFlash('#62ffe0');
      g.cameraRig?.kickFov(7);
      g.ui?.centerCallout('量子锁链·矩阵', 'FATE MATRIX / 伤害共享 50%');
      let lineTimer = 0;
      this.addField({
        type: 'matrix', owner: f, duration: 8, matrix,
        update: (fd, dt) => {
          if (!f.alive) { fd.t = 0; return; }
          lineTimer += dt;
          const arr = [...linked].filter((e) => e.alive && dist2D(e.pos, f.pos) <= radius + 4);
          linked.forEach((e) => { if (!e.alive) e.fateLinked = false; });
          if (lineTimer >= 0.35) {
            lineTimer = 0;
            for (let i = 0; i < arr.length; i++) {
              for (let j = i + 1; j < arr.length; j++) {
                g.effects.linkLine(
                  arr[i].pos.clone().setY(arr[i].pos.y + 1.1),
                  arr[j].pos.clone().setY(arr[j].pos.y + 1.1),
                  0x35ffcf, 0.34
                );
              }
            }
          }
          matrix.targets = new Set(arr);
        },
        end: () => {
          linked.forEach((e) => { e.fateLinked = false; });
          if (g.matrix === matrix) g.matrix = null;
          if (matrix) matrix.kill?.();
          g.ui?.toast('量子锁链已解除');
        },
      });
      return true;
    }
    return false;
  }

  /* ======================================================== 王琛 */
  _wang(f, slot) {
    const g = this.game;
    if (slot === 'q') {
      if (!f.history.length) return false;
      const now = g.elapsed;
      const targetTime = now - 3;
      let entry = f.history[0];
      for (const h of f.history) {
        if (h.t <= targetTime + 0.2) entry = h;
      }
      const from = f.pos.clone();
      const healAmount = f.damageLog.filter((d) => d.t >= now - 3.2).reduce((a, d) => a + d.amount, 0) * 0.7;
      f.teleportTo(entry.x, Math.max(0.1, entry.y), entry.z);
      f.invulnTimer = Math.max(f.invulnTimer, 0.5);
      f.heal(healAmount);
      g.effects.teleportBurst(from, 0xffcf5c);
      g.effects.teleportBurst(f.pos.clone(), 0xffcf5c);
      g.effects.afterimage(f.visual, 0xffcf5c, { duration: 0.7 });
      g.effects.ring(f.pos.clone().setY(0.05), 0xffcf5c, { radius: 4.5, duration: 0.8, thickness: 0.025 });
      g.effects.particleBurst(f.pos.clone().setY(1.2), 0xffcf5c, 30, { speed: 2, life: 1, size: 0.16, gravity: -5, up: 1 });
      g.postFX?.setGlitch(0.6);
      g.ui?.centerCallout('时间回溯', 'REWIND 3.0s · 恢复 70% 损失');
      g.sound?.teleport();
      return true;
    }
    if (slot === 'e') {
      f.addStatus('haste', 4.2, { power: 1 });
      f.castTimer = 0.4;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.02, 8, 48), basicGlow(0xffcf5c, 0.65));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.12;
      f.visual.group.add(ring);
      let trailT = 0;
      this.addField({
        type: 'haste', owner: f, duration: 4.2,
        update: (fd, dt) => {
          ring.rotation.z += dt * 5;
          ring.scale.setScalar(1 + Math.sin(fd.t * 6) * 0.08);
          trailT += dt;
          if (trailT > 0.1) {
            trailT = 0;
            g.effects.afterimage(f.visual, 0xffcf5c, { duration: 0.28 });
          }
        },
        end: () => {
          ring.removeFromParent();
          ring.geometry.dispose();
          ring.material.dispose();
        },
      });
      g.effects.ring(f.pos.clone().setY(0.07), 0xffcf5c, { radius: 5, duration: 0.6, thickness: 0.04 });
      g.effects.castAura(f, 0xff335f, 0.5);
      g.ui?.centerCallout('时间加速', 'TIME ACCELERATION ×2 / 4.2s');
      return true;
    }
    if (slot === 'r') {
      if (!g.startTimeStop(f)) {
        g.ui?.toast('绝对领域尚未准备好');
        return false;
      }
      return true;
    }
    return false;
  }

  addField(field) {
    field.id = ++fieldSeq;
    field.elapsed = 0;
    this.fields.push(field);
    return field;
  }

  update(dt) {
    const { game } = this;
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      if (!f.owner.alive && f.type !== 'meteorTrail') { f.t = 0; }
      // 时间停止时，除时停拥有者外的持续场也会冻结
      if (game.timeStop && game.timeStop.owner !== f.owner) continue;
      f.t -= dt;
      f.elapsed += dt;
      f.update?.(f, dt);
      if (f.t <= 0) {
        f.end?.(f);
        cleanupFieldVisual(f.visual);
        this.fields.splice(i, 1);
      }
    }
  }

  clear() {
    for (const f of this.fields) {
      try { f.end?.(f); } catch (e) { /* noop */ }
      cleanupFieldVisual(f.visual);
    }
    this.fields.length = 0;
    this.game.matrix = null;
  }
}

function fdPos(field) {
  return field.target ? field.target.clone().setY(0.4) : new THREE.Vector3();
}

function makeAnchorVisual(color) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  group.add(core);
  const glow = spriteGlow(color, 2.2, 0.8);
  group.add(glow);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.45 + i * 0.14, 0.012 + i * 0.004, 6, 32),
      basicGlow(i === 1 ? 0xffffff : color, 0.7)
    );
    ring.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
    ring.userData.spin = rand(1, 3);
    group.add(ring);
  }
  const light = new THREE.PointLight(color, 4, 12, 2);
  group.add(light);
  return group;
}

function disposeVisual(group) {
  if (!group || !group.traverse) return;
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

function cleanupFieldVisual(visual) {
  if (!visual) return;
  if (visual.object) {
    visual.kill?.();
    return;
  }
  if (visual.removeFromParent) {
    visual.removeFromParent();
    disposeVisual(visual);
  }
}

