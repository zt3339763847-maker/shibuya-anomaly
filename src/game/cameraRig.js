import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { clamp, damp, dampAngle, lerp } from '../core/utils.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _ray = new THREE.Vector3();

export class CameraRig {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;
    this.yaw = 0.75;
    this.pitch = -0.04;
    this.firstPerson = false;
    this.fppBlend = 0;
    this.baseFov = 72;
    this.fovKick = 0;
    this.shakeAmount = 0;
    this.shakeTime = 0;
    this.shakeSeed = Math.random() * 100;
    this.spectateTarget = null;
    this.camera.position.set(0, 4, 12);
    this.camera.rotation.order = 'YXZ';
    this._init = false;
    this._lastTarget = new THREE.Vector3();
    this.distance = 3.35;
    this.shoulder = 0.55;
  }

  setInitial(yaw) {
    this.yaw = yaw;
    this._init = false;
  }

  toggleView() {
    this.firstPerson = !this.firstPerson;
    this.game.ui?.setCameraMode(this.firstPerson);
    this.fovKick = this.firstPerson ? 2 : 1;
    this.game.sound?.click();
    return this.firstPerson;
  }

  setFirstPerson(v) {
    this.firstPerson = !!v;
    this.fppBlend = this.firstPerson ? 1 : 0;
    this.game.ui?.setCameraMode(this.firstPerson);
  }

  look(dx, dy, sensitivity = 1) {
    const s = 0.0023 * sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = clamp(this.pitch, -1.02, 0.92);
  }

  shake(amount, duration) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  kickFov(amount) {
    this.fovKick = Math.max(this.fovKick, amount);
  }

  getAimOrigin(out = new THREE.Vector3()) {
    return out.copy(this.camera.position);
  }

  getAimDirection(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  getAimRay(range = 30) {
    const origin = this.getAimOrigin(new THREE.Vector3());
    const dir = this.getAimDirection(new THREE.Vector3());
    return { origin, dir, point: origin.clone().addScaledVector(dir, range) };
  }

  update(dt) {
    const local = this.game.localFighter;
    let target = local;
    if (!target) return;
    if (!target.alive || (target.eliminated && this.spectateTarget?.alive)) {
      target = this.spectateTarget?.alive ? this.spectateTarget : null;
    }
    if (!target) return;

    const isSpectating = target !== local || !local.alive;
    if (isSpectating && this.spectateTarget?.alive) target = this.spectateTarget;
    else if (isSpectating) {
      // 找到任意存活角色
      const alive = this.game.fighters.find((f) => f.alive);
      if (alive) target = alive;
    }

    const headOffset = target === local && this.firstPerson ? 1.66 : 1.55;
    _focus.set(target.pos.x, target.pos.y + headOffset, target.pos.z);

    // 玩家死亡时缓慢环绕视图
    if (isSpectating) {
      this.yaw += dt * 0.12;
      const dist = 7.2;
      const height = 3.2;
      _desired.set(
        _focus.x + Math.sin(this.yaw) * dist,
        _focus.y + height + Math.sin(this.pitch) * dist * 0.4,
        _focus.z + Math.cos(this.yaw) * dist
      );
      this.fppBlend = damp(this.fppBlend, 0, 7, dt);
      this._applyCamera(dt, _focus, _desired, true);
      if (local) local.model.setFirstPerson(false);
      return;
    }

    // 相机朝向：本作角色以 +Z 为前方，因此相机 yaw 需要额外旋转 180°
    _euler.set(this.pitch, this.yaw + Math.PI, 0, 'YXZ');
    const targetQ = _q.setFromEuler(_euler);
    _fwd.set(0, 0, -1).applyEuler(_euler);
    _right.set(1, 0, 0).applyEuler(new THREE.Euler(0, this.yaw + Math.PI, 0, 'YXZ'));

    this.fppBlend = damp(this.fppBlend, this.firstPerson ? 1 : 0, 12, dt);
    const blend = this.fppBlend;

    // OTS 相机位置
    const otsPos = new THREE.Vector3(
      _focus.x - _fwd.x * this.distance + _right.x * this.shoulder,
      _focus.y + 0.25 - _fwd.y * this.distance * 0.3,
      _focus.z - _fwd.z * this.distance + _right.z * this.shoulder
    );
    const fppPos = new THREE.Vector3(
      target.pos.x + _fwd.x * 0.12,
      target.pos.y + 1.65,
      target.pos.z + _fwd.z * 0.12
    );
    _desired.copy(otsPos).lerp(fppPos, blend);

    // 第三人称相机避障
    if (blend < 0.92) {
      const from = new THREE.Vector3(_focus.x, _focus.y + 0.1, _focus.z);
      const to = _desired.clone();
      const delta = to.clone().sub(from);
      const len = delta.length();
      if (len > 0.1) {
        delta.normalize();
        const hit = this.game.world.castRay(
          new RAPIER.Ray(from, delta),
          len,
          true,
          undefined,
          undefined,
          target.collider,
          target.body,
          (col) => !this.game.isFighterCollider(col.handle)
        );
        if (hit && hit.timeOfImpact < len - 0.1) {
          const safe = Math.max(0.4, hit.timeOfImpact - 0.18);
          to.copy(from).addScaledVector(delta, safe);
          _desired.copy(to).lerp(fppPos, blend * 0.65);
        }
      }
    }
    _desired.y = Math.max(_desired.y, 0.28);

    this._applyCamera(dt, _focus, _desired, false, targetQ, blend);

    if (local) {
      const hide = blend > 0.58;
      local.model.setFirstPerson(hide);
      // 程序化模型没有独立的 FPP 手臂，完全隐藏本地身体避免穿模
      local.model.group.visible = !hide && !local.dead;
    }
  }

  _applyCamera(dt, focus, desired, spectating = false, targetQ = null, blend = 0) {
    if (!this._init) {
      this.camera.position.copy(desired);
      this._init = true;
      if (targetQ) this.camera.quaternion.copy(targetQ);
    } else {
      const posLambda = spectating ? 6 : this.firstPerson ? 28 : 15;
      this.camera.position.x = damp(this.camera.position.x, desired.x, posLambda, dt);
      this.camera.position.y = damp(this.camera.position.y, desired.y, posLambda, dt);
      this.camera.position.z = damp(this.camera.position.z, desired.z, posLambda, dt);
      if (targetQ) {
        this.camera.quaternion.slerp(targetQ, 1 - Math.exp(-26 * dt));
      } else if (spectating) {
        this.camera.lookAt(focus);
      }
    }

    // 镜头抖动
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const s = this.shakeAmount * clamp(this.shakeTime * 4, 0, 1);
      const t = performance.now() * 0.05 + this.shakeSeed;
      this.camera.position.x += Math.sin(t * 1.7) * s;
      this.camera.position.y += Math.cos(t * 2.3) * s * 0.8;
      this.camera.rotation.z = Math.sin(t * 1.2) * s * 0.05;
    } else {
      this.camera.rotation.z = damp(this.camera.rotation.z, 0, 8, dt);
      this.shakeAmount = 0;
    }

    const targetFov = this.baseFov + (this.firstPerson ? 4 : 0) + this.fovKick;
    this.camera.fov = damp(this.camera.fov, targetFov, 8, dt);
    this.fovKick = damp(this.fovKick, 0, 5, dt);
    this.camera.updateProjectionMatrix();
  }

  /** 将世界坐标投影到屏幕，供伤害数字 / 标记使用 */
  project(position, out = { x: 0, y: 0, visible: false }) {
    const v = new THREE.Vector3(position.x, position.y, position.z).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    out.visible = v.z > -1 && v.z < 1 && out.x > -40 && out.x < window.innerWidth + 40 && out.y > -40 && out.y < window.innerHeight + 40;
    return out;
  }
}
