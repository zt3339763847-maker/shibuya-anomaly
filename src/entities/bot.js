import * as THREE from 'three';
import { clamp, rand, dist2D, choose, TAU } from '../core/utils.js';

/**
 * 轻量但具有角色差异的 AI。
 * 不依赖导航网格：通过直接追踪、绕行、边缘规避与技能距离判断行动。
 */
export class BotController {
  constructor(fighter, game) {
    this.f = fighter;
    this.game = game;
    this.target = null;
    this.thinkTimer = rand(0.2, 0.7);
    this.decisionTimer = rand(0.35, 0.9);
    this.dodgeTimer = rand(1, 3);
    this.jumpTimer = rand(1, 3);
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.secondStageTimer = -1;
    this.lastTargetId = null;
    this.skillBias = rand(0.75, 1.25);
    this.aggression = rand(0.7, 1.15);
  }

  update(dt) {
    const f = this.f;
    if (!f.alive || f.dead || f.eliminated || f.frozen) return;
    if (this.game.timeStop && this.game.timeStop.owner !== f) return;
    this.thinkTimer -= dt;
    this.decisionTimer -= dt;
    this.dodgeTimer -= dt;
    this.jumpTimer -= dt;

    if (this.thinkTimer <= 0 || !this.target?.alive) {
      this.thinkTimer = rand(0.55, 1.2);
      this.target = this._pickTarget();
      this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    }
    const target = this.target;
    if (!target) {
      f.setIntent(0, 0);
      return;
    }

    const dx = target.pos.x - f.pos.x;
    const dz = target.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const aimY = (target.pos.y + 1.15) - (f.pos.y + 1.38);
    f.setAim(Math.atan2(dx, dz), clamp(Math.atan2(aimY, dist), -0.65, 0.6));

    let pref = f.def.aiRange;
    if (f.def.id === 'guojunxi') pref = 7.5;
    if (f.def.id === 'hezeyou') pref = 9.5;
    if (f.def.id === 'zhoutong') pref = 2.6;
    if (f.def.id === 'wangchen') pref = 2.4;

    let mx = 0, mz = 0;
    if (dist > pref * 1.08) {
      mx = dirX;
      mz = dirZ;
    } else if (dist < pref * 0.62 && pref > 4) {
      mx = -dirX;
      mz = -dirZ;
    } else {
      // 环绕移动，避免所有 AI 挤成一团
      mx = -dirZ * this.strafeDir + dirX * 0.18;
      mz = dirX * this.strafeDir + dirZ * 0.18;
      if (Math.sin(this.game.elapsed * 0.7 + f.pos.x) > 0.85) this.strafeDir *= -1;
    }

    // 边缘规避，优先活下来
    const edge = 21.2 - Math.max(Math.abs(f.pos.x), Math.abs(f.pos.z));
    if (edge < 3.4) {
      const cx = -f.pos.x;
      const cz = -f.pos.z;
      const cl = Math.hypot(cx, cz) || 1;
      const weight = clamp((3.4 - edge) / 3.4, 0, 1) * 2.4;
      mx = mx * (1 - weight) + (cx / cl) * weight;
      mz = mz * (1 - weight) + (cz / cl) * weight;
    }

    // 队友间距（FFA 中彼此保持一点空间）
    for (const other of this.game.fighters) {
      if (other === f || !other.alive) continue;
      const ox = f.pos.x - other.pos.x;
      const oz = f.pos.z - other.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 2.4 && od > 0.001) {
        mx += (ox / od) * 0.35;
        mz += (oz / od) * 0.35;
      }
    }

    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    if (f.stunTimer > 0 || f.rootTimer > 0) f.setIntent(0, 0);
    else f.setIntent(mx * this.aggression, mz * this.aggression);

    // 普攻
    const meleeRange = f.def.id === 'guojunxi' ? 13 : f.def.id === 'hezeyou' ? 15 : 2.9;
    if (dist <= meleeRange && f.attackCooldown <= 0 && Math.abs(this._angleTo(target)) < 0.75 && Math.random() < 0.85) {
      f.tryAttack();
    }

    // 闪避 / 跳跃
    if (this.dodgeTimer <= 0) {
      this.dodgeTimer = rand(1.6, 4.2);
      if (f.hp < f.maxHp * 0.45 || (dist < 4 && Math.random() < 0.35)) f.tryDodge();
    }
    if (this.jumpTimer <= 0) {
      this.jumpTimer = rand(2.2, 5.5);
      if (Math.random() < 0.24 || (f.currentSpeed < 0.4 && dist > 4)) f.queueJump();
    }

    // 二段技能
    if (f.def.id === 'zhoutong' && f.overloadArmed > 0 && this.secondStageTimer < 0) {
      this.secondStageTimer = rand(0.35, 0.9);
    }
    if (this.secondStageTimer > 0) {
      this.secondStageTimer -= dt;
      if (this.secondStageTimer <= 0) {
        this.secondStageTimer = -1;
        if (f.overloadArmed > 0) f.trySkill('e');
      }
    }

    // 技能决策
    if (this.decisionTimer <= 0) {
      this.decisionTimer = rand(0.7, 1.6) / this.skillBias;
      if (f.stunTimer <= 0 && Math.random() < this._skillChance(dist)) {
        this._useSkill(target, dist);
      }
    }
  }

  _pickTarget() {
    const f = this.f;
    const alive = this.game.fighters.filter((x) => x.alive && x !== f && !x.eliminated);
    if (!alive.length) return null;
    // 70% 最近，30% 血量最低 / 积分最高，增加可看性
    if (Math.random() < 0.72) {
      alive.sort((a, b) => dist2D(a.pos, f.pos) - dist2D(b.pos, f.pos));
      return alive[0];
    }
    alive.sort((a, b) => a.hp - b.hp);
    return alive[0];
  }

  _angleTo(target) {
    const dx = target.pos.x - this.f.pos.x;
    const dz = target.pos.z - this.f.pos.z;
    const want = Math.atan2(dx, dz);
    let d = (want - this.f.aimYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    return d;
  }

  _skillChance(dist) {
    const f = this.f;
    if (dist < 3) return 0.38;
    if (dist < 10) return 0.24;
    return 0.12;
  }

  _useSkill(target, dist) {
    const f = this.f;
    const id = f.def.id;
    const rReady = f.cds.r <= 0;
    const roll = Math.random();
    if (id === 'zhoutong') {
      if (rReady && dist < 14 && roll < 0.18 + (dist < 8 ? 0.15 : 0)) { f.trySkill('r'); return; }
      if (dist < 8 && f.cds.e <= 0 && f.overloadArmed <= 0 && roll < 0.55) { f.trySkill('e'); return; }
      if (dist < 11 && f.cds.q <= 0) { f.trySkill('q'); return; }
      if (dist < 4 && f.cds.e <= 0) { f.trySkill('e'); return; }
    } else if (id === 'guojunxi') {
      if (rReady && dist < 13 && roll < 0.34) { f.trySkill('r'); return; }
      if (dist > 8 && f.charges.q > 0 && roll < 0.7) { f.trySkill('q'); return; }
      if (dist < 21 && dist > 3 && f.cds.e <= 0 && roll < 0.5) { f.trySkill('e'); return; }
      if (dist < 7 && f.charges.q > 0) { f.trySkill('q'); return; }
    } else if (id === 'hezeyou') {
      if (rReady && this.game.fighters.filter((x) => x.alive && x !== f).length >= 2 && dist < 15 && roll < 0.36) { f.trySkill('r'); return; }
      if (dist < 13 && f.charges.q > 0 && roll < 0.55) { f.trySkill('q'); return; }
      if (f.hp < f.maxHp * 0.72 && f.cds.e <= 0 && roll < 0.7) { f.trySkill('e'); return; }
      if (dist < 6 && f.charges.q > 0) { f.trySkill('q'); return; }
    } else if (id === 'wangchen') {
      if (rReady && dist < 13 && roll < 0.28) { f.trySkill('r'); return; }
      if (f.hp < f.maxHp * 0.55 && f.cds.q <= 0 && roll < 0.75) { f.trySkill('q'); return; }
      if (f.cds.e <= 0 && dist < 9 && roll < 0.55) { f.trySkill('e'); return; }
      if (dist < 3 && f.cds.q <= 0) f.trySkill('q');
    }
  }
}
