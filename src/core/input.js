import { clamp } from '../core/utils.js';

const KEY_ACTIONS = {
  KeyW: 'move',
  KeyA: 'move',
  KeyS: 'move',
  KeyD: 'move',
  Space: 'jump',
  ShiftLeft: 'dodge',
  ShiftRight: 'dodge',
  KeyQ: 'q',
  KeyE: 'e',
  KeyR: 'r',
  KeyV: 'camera',
  KeyP: 'pause',
  Escape: 'pause',
  Tab: 'scoreboard',
  KeyH: 'hudhelp',
};

export class Input {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.enabled = false;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const fine = matchMedia('(pointer: fine)').matches;
    const noHover = matchMedia('(hover: none)').matches;
    this.hasTouch = navigator.maxTouchPoints > 0;
    // 触屏笔记本/一体机的主指针通常是 fine；不能仅凭 maxTouchPoints 就判定为手机
    this.isMobile = (coarse && !fine) || (noHover && this.hasTouch);
    this.touch = this.isMobile;
    this._queryCoarse = matchMedia('(pointer: coarse)');
    this._queryFine = matchMedia('(pointer: fine)');
    this._queryHover = matchMedia('(hover: none)');
    this._recomputeMode = () => {
      const next = (this._queryCoarse.matches && !this._queryFine.matches) || (this._queryHover.matches && this.hasTouch);
      if (next === this.isMobile) return;
      this.isMobile = next;
      this.touch = next;
      if (next) this.releaseLock();
      this.game.ui?.setTouchMode?.(next);
    };
    for (const q of [this._queryCoarse, this._queryFine, this._queryHover]) {
      if (q.addEventListener) q.addEventListener('change', this._recomputeMode);
      else q.addListener?.(this._recomputeMode);
    }
    this._skipMouse = 0;
    this.joy = { x: 0, y: 0, active: false, id: null, baseX: 0, baseY: 0 };
    this.lookTouches = new Map();
    this.pointerLocked = false;
    this.wasLocked = false;
    this.lockSupported = !!(canvas.requestPointerLock || canvas.webkitRequestPointerLock);
    this.lockError = !this.lockSupported;
    this._lockTimer = null;
    this.dragLook = null;
    this.rmbDown = false;
    this.joystickEl = document.getElementById('joystick');
    this.joystickKnob = document.getElementById('joystick-knob');
    this.touchLayer = document.getElementById('touch-layer');
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      const action = KEY_ACTIONS[e.code];
      if (action) {
        if (['Space', 'Tab', 'KeyV'].includes(e.code)) e.preventDefault();
        if (e.repeat) return;
        if (action === 'move') {
          this.keys.add(e.code);
          return;
        }
        this.game.handleAction(action);
        return;
      }
      if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') this.keys.add(e.code);
    }, { passive: false });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.rmbDown = false;
      this.dragLook = null;
      this.joy.active = false;
      this.joy.x = this.joy.y = 0;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) {
        e.preventDefault();
        this.rmbDown = true;
        this._startDragLook(e, 2);
        return;
      }
      if (e.button !== 0) return;
      if (this.pointerLocked) {
        this.mouseDown = true;
        this.game.handleAction('attack');
        return;
      }
      // 未锁定鼠标时：先进入拖拽视角状态。锁定成功后会切换为原生鼠标视角；
      // 若浏览器拒绝 Pointer Lock，右键/左键拖拽仍然可以控制视角。
      this._startDragLook(e, 0);
      if (this.lockError) {
        this.mouseDown = true;
        this.game.handleAction('attack');
      } else {
        this.requestLock();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rmbDown = false;
      if (this.dragLook && this.dragLook.button === e.button) this.dragLook = null;
      if (e.buttons === 0) {
        this.rmbDown = false;
        this.dragLook = null;
      }
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked) {
        if (this._skipMouse > 0) { this._skipMouse--; return; }
        this.mouseDX += clamp(e.movementX || 0, -250, 250);
        this.mouseDY += clamp(e.movementY || 0, -250, 250);
        return;
      }
      if (!this.dragLook) return;
      const dx = (e.clientX - this.dragLook.lastX);
      const dy = (e.clientY - this.dragLook.lastY);
      this.dragLook.lastX = e.clientX;
      this.dragLook.lastY = e.clientY;
      this.dragLook.moved += Math.abs(dx) + Math.abs(dy);
      this.mouseDX += clamp(dx, -250, 250) * 1.15;
      this.mouseDY += clamp(dy, -250, 250) * 1.15;
    });
    const onLockChange = () => {
      const locked = document.pointerLockElement === this.canvas || document.webkitPointerLockElement === this.canvas;
      const wasLocked = this.wasLocked;
      this.pointerLocked = locked;
      if (locked) {
        this.lockError = false;
        this.dragLook = null;
        this.wasLocked = true;
        this._skipMouse = 1;
        if (this._lockTimer) clearTimeout(this._lockTimer);
        this._lockTimer = null;
      } else {
        this.wasLocked = false;
        this.mouseDX = 0;
        this.mouseDY = 0;
        this.dragLook = null;
        this.keys.clear();
        // Escape 在 Pointer Lock 下通常不会派发 keydown。单人模式下自动暂停；
        // 联机时不能暂停房主/其他人的对局，因此保留“点击锁定”提示和拖拽备用视角。
        if (wasLocked && this.enabled && this.game?.state === 'playing' && !this.game.paused && !this.game.hudEditing) {
          const networked = !!this.game.network?.started;
          if (!networked) {
            setTimeout(() => {
              if (!this.pointerLocked && this.enabled && this.game?.state === 'playing' && !this.game.paused && !this.game.hudEditing) {
                this.game.pause(true);
              }
            }, 30);
          } else {
            this.game?.sendIdleNetworkInput?.();
          }
        }
      }
      this.game.ui?.setPointerLock(locked);
    };
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('webkitpointerlockchange', onLockChange);
    const onLockError = () => {
      this.lockError = true;
      this.pointerLocked = false;
      this.game.ui?.onPointerLockError?.();
    };
    document.addEventListener('pointerlockerror', onLockError);
    document.addEventListener('webkitpointerlockerror', onLockError);

    this._bindTouch();
  }

  _startDragLook(event, button) {
    this.dragLook = {
      button,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: 0,
    };
  }

  _bindTouch() {
    if (!this.touchLayer) return;
    this.touchLayer.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.game.isInputBlocked() || this.game.hudEditing) return;
      e.preventDefault();
      this.touchLayer.setPointerCapture?.(e.pointerId);
      const left = e.clientX < window.innerWidth * 0.47;
      if (left) {
        if (this.joy.active) return;
        this.joy.active = true;
        this.joy.id = e.pointerId;
        this.joy.baseX = e.clientX;
        this.joy.baseY = e.clientY;
        this.joy.startX = e.clientX;
        this.joy.startY = e.clientY;
        this.joy.x = 0;
        this.joy.y = 0;
        this._positionJoystick(e.clientX, e.clientY, true);
      } else {
        this.lookTouches.set(e.pointerId, { x: e.clientX, y: e.clientY, start: performance.now() });
      }
    });
    this.touchLayer.addEventListener('pointermove', (e) => {
      if (!this.joy.active && !this.lookTouches.has(e.pointerId)) return;
      e.preventDefault();
      if (e.pointerId === this.joy.id) {
        const dx = e.clientX - this.joy.baseX;
        const dy = e.clientY - this.joy.baseY;
        const max = 47;
        const len = Math.hypot(dx, dy);
        const clamped = Math.min(max, len);
        const nx = len > 0 ? (dx / len) * clamped : 0;
        const ny = len > 0 ? (dy / len) * clamped : 0;
        this.joy.x = nx / max;
        this.joy.y = ny / max;
        if (this.joystickKnob) this.joystickKnob.style.transform = `translate(${nx}px, ${ny}px)`;
      } else if (this.lookTouches.has(e.pointerId)) {
        const t = this.lookTouches.get(e.pointerId);
        this.mouseDX += (e.clientX - t.x) * 1.15;
        this.mouseDY += (e.clientY - t.y) * 1.15;
        t.x = e.clientX;
        t.y = e.clientY;
      }
    }, { passive: false });
    const end = (e) => {
      if (e.pointerId === this.joy.id) {
        this.joy.active = false;
        this.joy.id = null;
        this.joy.x = this.joy.y = 0;
        if (this.joystickKnob) this.joystickKnob.style.transform = 'translate(0,0)';
        this._positionJoystick(0, 0, false);
      }
      this.lookTouches.delete(e.pointerId);
    };
    this.touchLayer.addEventListener('pointerup', end);
    this.touchLayer.addEventListener('pointercancel', end);
    this.touchLayer.addEventListener('pointerleave', (e) => {
      if (e.pointerId === this.joy.id && e.buttons === 0) end(e);
    });
  }

  _positionJoystick(x, y, active) {
    if (!this.joystickEl) return;
    if (active) {
      this.joystickEl.classList.add('active', 'floating');
      this.joystickEl.style.left = `${x}px`;
      this.joystickEl.style.top = `${y}px`;
      this.joystickEl.style.bottom = 'auto';
      this.joystickEl.style.transform = 'translate(-50%, -50%)';
    } else {
      this.joystickEl.classList.remove('active', 'floating');
      this.joystickEl.style.left = '';
      this.joystickEl.style.top = '';
      this.joystickEl.style.bottom = '';
      this.joystickEl.style.transform = '';
      this.game.ui?.restoreJoystick?.();
    }
  }

  requestLock() {
    if (this.isMobile) return false;
    if (!this.enabled || !this.game || this.game.state !== 'playing' || this.game.paused || this.game.hudEditing) return false;
    const fn = this.canvas.requestPointerLock || this.canvas.webkitRequestPointerLock;
    if (!fn) {
      this.lockError = true;
      this.game.ui?.onPointerLockError?.();
      return false;
    }
    try {
      const result = fn.call(this.canvas);
      this.lockError = false;
      if (this._lockTimer) clearTimeout(this._lockTimer);
      this._lockTimer = setTimeout(() => {
        this._lockTimer = null;
        if (!this.pointerLocked) {
          this.lockError = true;
          this.game.ui?.onPointerLockError?.();
        }
      }, 900);
      if (result?.catch) {
        result.catch(() => {
          this.lockError = true;
          if (this._lockTimer) clearTimeout(this._lockTimer);
          this._lockTimer = null;
          this.game.ui?.onPointerLockError?.();
        });
      }
      return true;
    } catch (e) {
      this.lockError = true;
      this.game.ui?.onPointerLockError?.();
      return false;
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    else if (document.webkitPointerLockElement === this.canvas) document.webkitExitPointerLock?.();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.releaseLock();
    if (!v) {
      this.keys.clear();
      this.mouseDown = false;
      this.rmbDown = false;
      this.dragLook = null;
      this.mouseDX = 0;
      this.mouseDY = 0;
      if (this._lockTimer) clearTimeout(this._lockTimer);
      this._lockTimer = null;
      this.joy.active = false;
      this.joy.x = this.joy.y = 0;
      this.lookTouches.clear();
    }
  }

  consumeLook() {
    const out = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  movement() {
    let x = 0, z = 0;
    if (this.keys.has('KeyW')) z += 1;
    if (this.keys.has('KeyS')) z -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyA')) x -= 1;
    if (this.joy.active) {
      x += this.joy.x;
      z += -this.joy.y;
    }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z, magnitude: Math.min(1, len) };
  }

  isMoving() {
    const m = this.movement();
    return m.magnitude > 0.08;
  }
}
