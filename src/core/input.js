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
    this.touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    this.isMobile = this.touch;
    this.joy = { x: 0, y: 0, active: false, id: null, baseX: 0, baseY: 0 };
    this.lookTouches = new Map();
    this.pointerLocked = false;
    this.wasLocked = false;
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
      this.joy.active = false;
      this.joy.x = this.joy.y = 0;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      if (this.isMobile && this.touch) return;
      if (!this.pointerLocked) {
        this.requestLock();
        return;
      }
      this.mouseDown = true;
      this.game.handleAction('attack');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.game.ui?.setPointerLock(this.pointerLocked);
      if (this.pointerLocked) this.wasLocked = true;
    });
    this.canvas.addEventListener('click', () => {
      if (this.enabled && !this.pointerLocked && !this.isMobile) this.requestLock();
    });

    this._bindTouch();
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
    if (this.isMobile) return;
    const promise = this.canvas.requestPointerLock?.();
    if (promise?.catch) promise.catch(() => {});
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.releaseLock();
    if (!v) {
      this.keys.clear();
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
