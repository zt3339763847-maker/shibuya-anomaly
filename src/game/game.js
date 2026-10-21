import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Arena } from '../world/arena.js';
import { Effects } from '../effects/effects.js';
import { PostFX } from '../render/postfx.js';
import { CameraRig } from './cameraRig.js';
import { AbilitySystem } from './abilities.js';
import { Fighter } from '../entities/fighter.js';
import { BotController } from '../entities/bot.js';
import { Input } from '../core/input.js';
import { CHARACTERS, CHARACTER_MAP, MODES, PLAYER_COLORS } from '../data/characters.js';
import { clamp, damp, lerp, rand, choose, shuffle, dist2D, angleDiff, TAU, formatTime } from '../core/utils.js';
import { basicGlow, spriteGlow } from '../render/toon.js';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 4;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Game {
  constructor({ canvas, ui, audio, rapier }) {
    this.canvas = canvas;
    this.ui = ui;
    this.audio = audio;
    this.RAPIER = rapier || RAPIER;
    this.state = 'menu';
    this.paused = false;
    this.matchOver = false;
    this.hudEditing = false;
    this.isNetClient = false;
    this.isNetHost = false;
    this.localFighter = null;
    this.fighters = [];
    this.bots = [];
    this.projectiles = [];
    this.remoteInputs = new Map();
    this.fighterByNet = new Map();
    this.fighterColliderHandles = new Set();
    this.matrix = null;
    this.timeStop = null;
    this.matchTime = 0;
    this.elapsed = 0;
    this.localCombo = 0;
    this.localComboTimer = 0;
    this.introTimer = 0;
    this.snapshotTimer = 0;
    this.netInputTimer = 0;
    this.lastFrenzyTick = -1;
    this.spectateTarget = null;
    this.lastConfig = null;
    this.sensitivity = 1;
    this._acc = 0;
    this._last = performance.now();
    this._menuAngle = 0.35;
    this._menuTime = 0;
    this._menuTarget = new THREE.Vector3(0, 2.4, 0);

    this._initRenderer();
    this._initScene();
    this._initPhysics();
    this._initGameplay();
    this._bindEvents();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /* ================================================================ setup */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x08080e, 1);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1a1524, 58, 210);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 320);
    this.camera.position.set(28, 12, 28);
    this.camera.lookAt(0, 2, 0);
    this.cameraLight = new THREE.PointLight(0xcfe0ff, 0, 12, 2);
    this.scene.add(this.cameraLight);
  }

  _initPhysics() {
    const R = this.RAPIER;
    this.world = new R.World({ x: 0, y: -25.5, z: 0 });
    this.world.timestep = FIXED_STEP;
    this.world.integrationParameters.numSolverIterations = 4;
  }

  _initGameplay() {
    this.effects = new Effects(this.scene, this.camera);
    this.arena = new Arena(this.scene, this.world, this.effects);
    this.postFX = new PostFX(this.renderer, this.scene, this.camera, 'midt');
    this.cameraRig = new CameraRig(this.camera, this);
    this.abilities = new AbilitySystem(this);
    this.input = new Input(this, this.canvas);
    this.sound = this.audio;
    this.ui?.setGame?.(this);
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.paused) this.pause(true);
    });
    window.addEventListener('pointerdown', () => {
      if (this.state === 'playing' && !this.isNetClient) this.audio?.init();
    }, { once: false });
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postFX?.setSize(w, h);
  }

  /* ================================================================ loop */
  _loop(ts) {
    requestAnimationFrame(this._loop);
    const dtRaw = (ts - this._last) / 1000;
    this._last = ts;
    const dt = clamp(Number.isFinite(dtRaw) ? dtRaw : 0.016, 0, 0.05);

    if (this.state === 'menu') {
      this._updateMenu(dt);
      this.postFX?.render(dt);
      return;
    }

    if (!this.paused) {
      this._processLook();
      if (this.state === 'playing') {
        if (this.cameraRig) this.cameraRig.update(dt);
        this.cameraLight.intensity = 2.2;
        this.cameraLight.position.copy(this.camera.position).add(new THREE.Vector3(0, 0.6, 0));
        this._acc += dt;
        let steps = 0;
        while (this._acc >= FIXED_STEP && steps < MAX_STEPS) {
          this.step(FIXED_STEP);
          this._acc -= FIXED_STEP;
          steps++;
        }
        if (steps === MAX_STEPS) this._acc = 0;
      }
      this._updateFrameEffects(dt);
      if (this.state === 'gameover') {
        this._updateGameOverCamera(dt);
      }
    }
    this.postFX?.render(dt);
    if (this.state === 'playing') this.ui?.updateHUD(this, dt);
  }

  _updateMenu(dt) {
    this._menuTime += dt;
    this.cameraLight.intensity = 0;
    this._menuAngle += dt * 0.035;
    const radius = 31;
    this.camera.position.set(
      Math.cos(this._menuAngle) * radius,
      11 + Math.sin(this._menuTime * 0.13) * 1.6,
      Math.sin(this._menuAngle) * radius
    );
    this.camera.lookAt(this._menuTarget);
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
    this.arena?.update(dt);
    this.effects?.update(dt);
  }

  _processLook() {
    if (!this.input.enabled) return;
    const look = this.input.consumeLook();
    if (look.dx || look.dy) {
      this.cameraRig.look(look.dx, look.dy, this.sensitivity);
    }
  }

  step(dt) {
    this.elapsed += dt;
    if (this.state !== 'playing') return;
    if (this.introTimer > 0) {
      this.introTimer -= dt;
      if (this.introTimer <= 0) {
        this.ui?.centerCallout('战斗开始', 'SURVIVE SHIBUYA');
        this.sound?.ko();
      }
    }

    if (this.isNetClient) {
      this._stepClient(dt);
      return;
    }

    if (this.introTimer <= 0) {
      this._updateLocalIntent();
      this._applyRemoteIntents();
      for (const bot of this.bots) {
        if (bot.f.alive) bot.update(dt);
      }
    } else {
      this.localFighter?.setIntent(0, 0);
      for (const f of this.fighters) f.setIntent(0, 0);
    }

    for (const f of this.fighters) f.update(dt);
    this.world.step();
    this._updateProjectiles(dt);
    this.abilities.update(dt);
    this.arena.update(dt);
    this.effects.update(dt);
    this._updateTimeStop(dt);
    this._updateRespawns(dt);
    this._updateMatchState(dt);
    this._updateCombo(dt);

    if (this.localFighter) {
      this.cameraRig.yaw = this.input.enabled ? this.cameraRig.yaw : this.cameraRig.yaw;
      this.localFighter.setAim(this.cameraRig.yaw, this.cameraRig.pitch);
      if (!this.localFighter.alive && !this.spectateTarget) {
        this._pickSpectateTarget();
      }
    }

    if (this.isNetHost) {
      this.snapshotTimer += dt;
      if (this.snapshotTimer >= 1 / 16) {
        this.snapshotTimer = 0;
        this.network?.sendSnapshot?.(this.serializeSnapshot());
      }
    }
  }

  _stepClient(dt) {
    this.world.step();
    this.arena.update(dt);
    this.effects.update(dt);
    for (const f of this.fighters) f.updateNetVisual(dt);
    this._updateFrameEffects(dt);
    for (const f of this.fighters) f.setAim(this.cameraRig.yaw, this.cameraRig.pitch);
    if (this.localFighter && !this.localFighter.alive) this._pickSpectateTarget();
    // 玩家输入频率 30Hz
    this.netInputTimer += dt;
    if (this.netInputTimer >= 1 / 30) {
      this.netInputTimer = 0;
      const m = this.input.movement();
      this.network?.sendInput?.({
        x: +m.x.toFixed(3),
        z: +m.z.toFixed(3),
        yaw: +this.cameraRig.yaw.toFixed(3),
        pitch: +this.cameraRig.pitch.toFixed(3),
        t: Date.now(),
      });
    }
    this._updateCombo(dt);
    if (this.introTimer > 0) {
      this.introTimer -= dt;
      if (this.introTimer <= 0) this.ui?.centerCallout('战斗开始', 'SURVIVE SHIBUYA');
    }
  }

  _updateFrameEffects(dt) {
    if (this.localFighter?.alive) {
      const shader = this.postFX;
      if (shader) {
        shader.speedLines = Math.max(shader.speedLines, this.localFighter.hasteTimer > 0 ? 0.25 : 0);
      }
    }
    this.ui?.updateCrosshair?.(this.getAimTarget());
  }

  _updateLocalIntent() {
    const f = this.localFighter;
    if (!f) return;
    if (this.input.enabled && this.introTimer <= 0 && f.alive && !this.paused && !this.hudEditing) {
      const m = this.input.movement();
      const yaw = this.cameraRig.yaw;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const rx = -Math.cos(yaw), rz = Math.sin(yaw);
      f.setIntent(rx * m.x + fx * m.z, rz * m.x + fz * m.z);
      f.setAim(yaw, this.cameraRig.pitch);
    } else {
      f.setIntent(0, 0);
    }
  }

  _applyRemoteIntents() {
    for (const [netId, input] of this.remoteInputs) {
      const f = this.fighterByNet.get(netId);
      if (!f || !f.alive) continue;
      const yaw = input.yaw || 0;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const rx = -Math.cos(yaw), rz = Math.sin(yaw);
      f.setAim(yaw, input.pitch || 0);
      f.setIntent(rx * (input.x || 0) + fx * (input.z || 0), rz * (input.x || 0) + fz * (input.z || 0));
    }
  }

  /* ================================================================ match start */
  startLocal({ charId = 'zhoutong', mode = 'survival', botCount = 3, training = false, playerName = '' }) {
    const modeId = training ? 'training' : mode;
    const botTotal = training ? Math.min(3, Math.max(1, botCount || 1)) : botCount;
    const def = CHARACTER_MAP[charId] || CHARACTERS[0];
    const entries = [{
      netId: 'local', name: playerName || def.name, defId: def.id, charId: def.id,
      isBot: false, local: true, charId: def.id,
    }];
    const others = CHARACTERS.filter((c) => c.id !== def.id);
    const bots = shuffle(others).slice(0, botTotal);
    bots.forEach((b, i) => {
      entries.push({
        netId: `bot-${i + 1}`, name: `AI·${b.name}`, defId: b.id, charId: b.id, isBot: true,
      });
    });
    this.lastConfig = { charId, mode, botCount, training, playerName };
    this._beginMatch(entries, modeId, {
      isHost: true,
      localNetId: 'local',
      score: true,
    });
    this.ui?.hideMenu?.();
    this.ui?.showGame?.(this);
    this.input.setEnabled(true);
    this.audio?.init();
    this.audio?.startMusic();
    this.pointerHintPending = true;
    setTimeout(() => {
      if (this.state === 'playing') this.input.requestLock();
    }, 350);
  }

  startHostedMatch(entries, modeId = 'survival') {
    const humans = entries.map((e, i) => ({
      ...e,
      netId: e.netId || `host-${i}`,
      defId: e.charId || e.defId || 'zhoutong',
      local: !!e.local,
    }));
    // 用 AI 填满四名术师，保证联机房间不会空场
    let botIndex = 1;
    const used = new Set(humans.map((h) => h.defId));
    const available = [];
    for (const c of CHARACTERS) if (!used.has(c.id)) available.push(c);
    while (humans.length < 4) {
      const c = available.shift() || CHARACTERS[botIndex % CHARACTERS.length];
      humans.push({
        netId: `bot-${botIndex}`,
        name: `AI·${c.name}`,
        defId: c.id,
        charId: c.id,
        isBot: true,
      });
      botIndex++;
    }
    this.lastConfig = { network: 'host', entries: humans, mode: modeId };
    this._beginMatch(humans, modeId, {
      isHost: true,
      isClient: false,
      localNetId: humans.find((h) => h.local)?.netId || humans[0].netId,
    });
    this.ui?.hideMenu?.();
    this.ui?.showGame?.(this);
    this.input.setEnabled(true);
    this.audio?.init();
    this.audio?.startMusic();
    this.network?.startMatchPayload?.(humans, modeId);
    this.network?.setGame?.(this);
  }

  startClientMatch(payload) {
    const entries = (payload.players || []).map((p) => ({
      ...p,
      defId: p.defId || p.charId || 'zhoutong',
      local: p.netId === payload.localNetId,
    }));
    this.lastConfig = { network: 'client', mode: payload.mode };
    this.isNetClient = true;
    this._beginMatch(entries, payload.mode || 'survival', {
      isHost: false,
      isClient: true,
      localNetId: payload.localNetId,
    });
    this.ui?.hideMenu?.();
    this.ui?.showGame?.(this);
    this.input.setEnabled(true);
    this.audio?.init();
    this.audio?.startMusic();
    this.network?.setGame?.(this);
  }

  _beginMatch(entries, modeId, opts = {}) {
    this._cleanupMatch();
    this.state = 'playing';
    this.paused = false;
    this.matchOver = false;
    this.isNetClient = !!opts.isClient;
    this.isNetHost = !!opts.isHost && !this.isNetClient;
    this.modeId = modeId;
    this.mode = MODES[modeId] || MODES.survival;
    this.matchDuration = this.mode.duration;
    this.matchTime = 0;
    this.elapsed = 0;
    this.introTimer = 2.3;
    this.localCombo = 0;
    this.localComboTimer = 0;
    this.spectateTarget = null;
    this.matrix = null;
    this.timeStop = null;
    this.lastFrenzyTick = -1;
    this.snapshotTimer = 0;
    this.netInputTimer = 0;
    this._acc = 0;
    this.ui?.hideGameOver?.();
    this.ui?.hideSpectate?.();
    this.postFX?.setTimeStop(false, true);
    this.ui?.hideTimeStop?.();

    const spawnIndices = [0, 1, 2, 3, 4, 5];
    const ordered = [...entries];
    this.fighters = [];
    this.fighterByNet.clear();
    this.bots = [];
    this.fighterColliderHandles.clear();
    const lives = this.mode.lives === Infinity ? 999 : this.mode.lives;
    ordered.forEach((e, i) => {
      const def = CHARACTER_MAP[e.defId] || CHARACTERS[i % CHARACTERS.length];
      const isLocal = !!(e.local || (opts.localNetId && e.netId === opts.localNetId));
      const f = new Fighter(this, def, {
        id: e.netId || `fighter-${i}`,
        netId: e.netId || `fighter-${i}`,
        name: e.name || (isLocal ? '术师' : def.name),
        isBot: !!e.isBot,
        isLocal,
        playerColor: PLAYER_COLORS[i % PLAYER_COLORS.length],
        spawnIndex: spawnIndices[i % spawnIndices.length],
        lives,
      });
      f.entry = e;
      f.score = 0;
      // 避免玩家之间初始位置互相挤压
      f.pos.x += rand(-0.4, 0.4);
      f.pos.z += rand(-0.4, 0.4);
      f.visual.group.position.copy(f.pos);
      this.fighters.push(f);
      this.fighterByNet.set(f.netId, f);
      if (f.isLocal) this.localFighter = f;
      if (e.isBot && !this.isNetClient) {
        const bot = new BotController(f, this);
        f.bot = bot;
        this.bots.push(bot);
      }
    });
    this.localFighter = this.fighters.find((f) => f.isLocal) || this.fighters[0];
    this.localFighter.isLocal = true;
    this.cameraRig.setInitial(this.localFighter.aimYaw);
    this.cameraRig.setFirstPerson(false);
    this.ui?.setupMatch?.(this);
    this.ui?.centerCallout('领域展开', 'SHIBUYA INCIDENT / 3 · 2 · 1');
    this.sound?.init?.();
    this.sound?.startMusic?.();
    this.input.setEnabled(true);
    this.canvas.focus?.();
    this._setQuality(this.quality || 'midt');
  }

  rematch() {
    if (this.lastConfig?.network) {
      this.ui?.toast('联机模式请重新创建房间');
      this.quitToMenu();
      return;
    }
    if (this.lastConfig?.network === 'host') {
      this.ui?.toast('请重新创建房间');
      this.quitToMenu();
      return;
    }
    if (this.lastConfig) this.startLocal(this.lastConfig);
    else this.quitToMenu();
  }

  _cleanupMatch() {
    this.input?.setEnabled(false);
    for (const p of this.projectiles) this._removeProjectile(p, true);
    this.projectiles = [];
    this.abilities?.clear();
    for (const f of this.fighters) f.dispose?.();
    this.fighters = [];
    this.bots = [];
    this.fighterByNet.clear();
    this.remoteInputs.clear();
    this.fighterColliderHandles.clear();
    this.localFighter = null;
    this.matrix = null;
    this.timeStop = null;
    this.isNetHost = false;
    this.isNetClient = false;
    this.effects?.clear();
    this.arena?.reset();
    this.ui?.hideTimeStop?.();
    this.ui?.hideSpectate?.();
    this.postFX?.setTimeStop(false, true);
    this.scene.fog = new THREE.Fog(0x1a1524, 58, 210);
  }

  quitToMenu() {
    this._cleanupMatch();
    this.state = 'menu';
    this.paused = false;
    this.input.setEnabled(false);
    this.audio?.stopMusic();
    this.network?.disconnect?.();
    this.ui?.showMenu?.();
    this.ui?.hideGame?.();
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
    this._menuAngle = 0.35;
  }

  handlePlayerDisconnect(netId) {
    const f = this.fighterByNet.get(netId);
    this.remoteInputs.delete(netId);
    if (!f) return;
    f.eliminated = true;
    f.dead = true;
    f.hp = 0;
    f.collider?.setEnabled(false);
    f.visual.group.visible = false;
    f.nameplate.visible = false;
    this.ui?.addKillFeed?.({ type: 'kill', name: '连接中断', target: f.name });
    this.ui?.toast?.(`${f.name} 已断开连接`);
    const alive = this.fighters.filter((x) => !x.eliminated);
    if (this.modeId === 'survival' && alive.length <= 1 && !this.matchOver) {
      this.finishMatch(alive[0] || null);
    }
  }

  /* ================================================================ actions */
  handleAction(action) {
    if (this.state !== 'playing' || this.paused || this.hudEditing) {
      if (action === 'pause' && this.state === 'playing' && !this.paused) this.pause(true);
      return;
    }
    if (action === 'pause') { this.pause(true); return; }
    if (action === 'camera') {
      this.cameraRig.toggleView();
      return;
    }
    if (action === 'scoreboard') {
      this.ui?.toggleScoreboard?.();
      return;
    }
    if (action === 'scoreboardOff') {
      this.ui?.toggleScoreboard?.(false);
      return;
    }
    if (action === 'hudhelp') { this.ui?.openHelp?.(); return; }
    if (!this.localFighter || this.localFighter.eliminated) return;
    if (this.introTimer > 0) return;
    if (this.isNetClient) {
      if (['attack', 'jump', 'dodge', 'q', 'e', 'r'].includes(action)) {
        this.network?.sendAction?.(action, {
          yaw: this.cameraRig.yaw, pitch: this.cameraRig.pitch,
        });
        this.sound?.click();
      }
      return;
    }
    const f = this.localFighter;
    if (action === 'attack') f.tryAttack();
    else if (action === 'jump') f.queueJump();
    else if (action === 'dodge') f.tryDodge();
    else if (action === 'q' || action === 'e' || action === 'r') f.trySkill(action);
  }

  setRemoteInput(netId, input) {
    if (!netId) return;
    if (input) this.remoteInputs.set(netId, input);
    else this.remoteInputs.delete(netId);
  }

  remoteAction(netId, action, aim = {}) {
    const f = this.fighterByNet.get(netId);
    if (!f || !f.alive || this.introTimer > 0) return;
    if (Number.isFinite(aim.yaw)) f.setAim(aim.yaw, aim.pitch || 0);
    if (action === 'attack') f.tryAttack();
    else if (action === 'jump') f.queueJump();
    else if (action === 'dodge') f.tryDodge();
    else if (action === 'q' || action === 'e' || action === 'r') f.trySkill(action);
  }

  isInputBlocked() {
    return this.state !== 'playing' || this.paused || this.hudEditing || this.introTimer > 0;
  }

  pause(on) {
    if (this.state !== 'playing') return;
    this.paused = !!on;
    if (this.paused) {
      this.input.setEnabled(false);
      this.ui?.showPause?.(true);
      this.input.releaseLock();
      this.audio?.setMusicIntensity(-0.2);
    } else {
      this.input.setEnabled(true);
      this.ui?.showPause?.(false);
      this.audio?.setMusicIntensity(0.4);
      this.pointerHintPending = true;
    }
  }

  openHudEditor() {
    if (!this.localFighter) return;
    this.hudEditing = true;
    this.paused = true;
    this.input.setEnabled(false);
    this.ui?.openHudEditor?.();
  }

  closeHudEditor() {
    this.hudEditing = false;
    this.paused = false;
    this.input.setEnabled(true);
    this.ui?.closeHudEditor?.();
    this.ui?.setPointerLock?.(false);
    this.pointerHintPending = true;
  }

  _setQuality(q) {
    this.quality = q;
    this.postFX?.setQuality(q);
    const ratio = q === 'low' ? Math.min(window.devicePixelRatio, 1) : q === 'high' ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  flashHurt() {
    this.ui?.flashHurt?.();
    this.postFX?.pulseDamage(0.6);
  }

  /* ================================================================ combat data */
  resolveAim(fighter, range = 20) {
    let origin, dir;
    if (fighter.isLocal && this.cameraRig) {
      origin = this.cameraRig.getAimOrigin(new THREE.Vector3());
      dir = this.cameraRig.getAimDirection(new THREE.Vector3()).normalize();
    } else {
      origin = fighter.getAimOrigin(new THREE.Vector3());
      dir = fighter.aimDirection(new THREE.Vector3());
    }
    let dist = range;
    if (this.world) {
      const hit = this.world.castRay(
        new RAPIER.Ray(origin, dir), range, true,
        undefined, undefined, fighter.collider, fighter.body,
        (col) => !this.isFighterCollider(col.handle)
      );
      if (hit) dist = Math.max(0.4, hit.timeOfImpact);
    }
    const point = origin.clone().addScaledVector(dir, dist);
    return { origin, dir, point, distance: dist };
  }

  getAimTarget(maxDist = 60) {
    if (!this.localFighter || !this.localFighter.alive) return null;
    const origin = this.cameraRig.getAimOrigin(new THREE.Vector3());
    const dir = this.cameraRig.getAimDirection(new THREE.Vector3());
    let best = null;
    let bestT = maxDist;
    for (const f of this.fighters) {
      if (f === this.localFighter || !f.alive) continue;
      const center = f.pos.clone().setY(f.pos.y + 1.0);
      const to = center.clone().sub(origin);
      const t = to.dot(dir);
      if (t <= 0 || t > maxDist) continue;
      const perp = to.clone().addScaledVector(dir, -t).length();
      if (perp < 0.85 && t < bestT) { bestT = t; best = f; }
    }
    return best;
  }

  registerFighterCollider(handle) { this.fighterColliderHandles.add(handle); }
  unregisterFighterCollider(handle) { this.fighterColliderHandles.delete(handle); }
  isFighterCollider(handle) { return this.fighterColliderHandles.has(handle); }

  separateFighters(f, dt) {
    for (const other of this.fighters) {
      if (other === f || !other.alive) continue;
      const dx = f.pos.x - other.pos.x;
      const dz = f.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 1.15) {
        const push = (1.15 - d) * 0.5;
        f.pos.x += (dx / d) * push * dt * 8;
        f.pos.z += (dz / d) * push * dt * 8;
      }
    }
  }

  performBasicAttack(f, hit) {
    if (!f.alive) return;
    const aim = hit.aim;
    if (this.isNetHost) {
      this.network?.broadcastEvent?.({
        type: 'basic', id: f.netId, char: f.def.id, combo: hit.combo,
        origin: [aim.origin.x, aim.origin.y, aim.origin.z],
        dir: [aim.dir.x, aim.dir.y, aim.dir.z],
      });
    }
    if (f.def.id === 'guojunxi') {
      this._spawnAirSlash(f, hit, aim);
      return;
    }
    if (f.def.id === 'hezeyou') {
      this._fireQuantumBeam(f, hit, aim);
      return;
    }
    // 周同 / 王琛近战
    const third = hit.combo >= (hit.maxCombo || 3);
    const isZhou = f.def.id === 'zhoutong';
    const range = isZhou ? (third ? 4.2 : 2.9) : (third ? 3.3 : 2.7);
    const angle = third ? 1.45 : 0.95;
    const baseDamage = isZhou ? (third ? 58 : hit.combo === 1 ? 26 : 31) : (third ? 46 : hit.combo === 1 ? 24 : 29);
    const forward = f.forward(new THREE.Vector3());
    const targets = [];
    for (const e of this.fighters) {
      if (!e.alive || e === f) continue;
      const to = new THREE.Vector3(e.pos.x - f.pos.x, 0, e.pos.z - f.pos.z);
      const d = to.length();
      if (d > range + 0.55) continue;
      if (Math.abs(angleDiff(Math.atan2(to.x, to.z), f.aimYaw)) > angle) continue;
      if (Math.abs(e.pos.y - f.pos.y) > 2.3) continue;
      targets.push(e);
    }

    if (third) {
      const center = f.pos.clone().addScaledVector(forward, 1.5);
      center.y = 0.1;
      this.areaDamage(center, isZhou ? 4.5 : 3.7, baseDamage, f, {
        type: 'basic', color: f.def.palette.accent,
        knockback: isZhou ? 14 : 10, up: isZhou ? 9 : 6, knockdown: true, stun: 0.4,
        heavy: true, breakDamage: isZhou ? 180 : 120, breakRadius: 4.6,
        basic: true,
      });
      this.effects.shockwave(center, f.def.palette.accent, { radius: isZhou ? 6 : 4.5, duration: 0.55, count: 30, light: 6 });
      this.effects.slash(f.pos.clone().setY(f.pos.y + 1.2), f.def.palette.accent, { radius: 4, angle: Math.PI * 1.5 });
      this.cameraRig.shake(0.14, 0.25);
      this.cameraRig.kickFov(4);
    } else {
      for (const e of targets) {
        const dir = new THREE.Vector3(e.pos.x - f.pos.x, 0, e.pos.z - f.pos.z).normalize();
        this.dealDamage(e, baseDamage, f, {
          type: 'basic', color: f.def.palette.accent,
          knockback: isZhou ? 7 : 5.5, up: 1.2, stun: 0.24, knockdown: false,
          knockbackDir: dir, basic: true,
        });
        this.effects.slash(e.pos.clone().setY(e.pos.y + 1.2), isZhou ? 0xb98cff : 0xff5577, {
          radius: 2.2, duration: 0.22, angle: Math.PI * 1.15,
        });
        this.cameraRig.shake(0.05, 0.12);
      }
      if (!targets.length) {
        const p = f.pos.clone().addScaledVector(forward, 1.5).setY(f.pos.y + 1.0);
        this.effects.slash(p, f.def.palette.accent, { radius: 1.7, duration: 0.18, angle: Math.PI });
      }
      this._damageBreakablesCone(f, range + 0.8, angle, isZhou ? 78 : 64, f.def.palette.accent);
    }
    if (isZhou && third) this.ui?.centerCallout('破城锤', 'GROUND BREAKER');
    if (f.def.id === 'wangchen' && third) this.ui?.centerCallout('时滞斩', 'TIME EDGE');
  }

  _damageBreakablesCone(f, range, angle, damage, color) {
    const list = this.arena.getBreakablesInRadius(f.pos, range + 1);
    for (const b of list) {
      const to = new THREE.Vector3(b.center.x - f.pos.x, 0, b.center.z - f.pos.z);
      const d = to.length();
      if (d > range + b.radius) continue;
      if (Math.abs(angleDiff(Math.atan2(to.x, to.z), f.aimYaw)) > angle && d > 1.5) continue;
      this._damageBreakable(b, damage, f, { cause: 'melee' });
    }
  }

  _fireQuantumBeam(f, hit, aim) {
    const origin = aim.origin.clone();
    const dir = aim.dir.clone();
    const range = hit.combo >= 4 ? 30 : 26;
    let wallDist = range;
    const wallHit = this.world.castRay(
      new RAPIER.Ray(origin, dir), range, true,
      undefined, undefined, f.collider, f.body,
      (col) => !this.isFighterCollider(col.handle)
    );
    if (wallHit) wallDist = Math.max(0.6, wallHit.timeOfImpact);

    const hits = [];
    for (const e of this.fighters) {
      if (!e.alive || e === f) continue;
      const center = e.pos.clone().setY(e.pos.y + 1.05);
      const t = center.clone().sub(origin).dot(dir);
      if (t <= 0.2 || t > Math.min(range, wallDist + 0.35)) continue;
      const point = origin.clone().addScaledVector(dir, t);
      if (point.distanceTo(center) > 1.25) continue;
      hits.push({ target: e, t });
    }
    hits.sort((a, b) => a.t - b.t);
    const targets = hit.combo >= 4 ? hits : hits.slice(0, 1);
    const nearest = targets[0];
    const endT = nearest ? Math.min(nearest.t, wallDist) : wallDist;
    const end = origin.clone().addScaledVector(dir, endT);
    const muzzle = f.pos.clone().setY(f.pos.y + 1.33).addScaledVector(f.forward(new THREE.Vector3()), 0.4);
    this.effects.beam(muzzle, end, 0x5af2ff, { duration: 0.16, width: hit.combo >= 4 ? 0.11 : 0.07 });
    this.effects.impact(end, 0x7bfff0, { count: 14, speed: 5, radius: 0.8, heavy: hit.combo >= 4 });
    if (hit.combo >= 4) this.effects.beam(muzzle, end, 0xffffff, { duration: 0.1, width: 0.03 });
    this.cameraRig.shake(0.035, 0.08);
    this.cameraRig.kickFov(1.5);
    this.sound?.beam();
    const damage = hit.combo >= 4 ? 38 : 24;
    for (const { target } of targets) {
      this.dealDamage(target, damage, f, {
        type: 'basic', ranged: true, color: 0x5af2ff, stun: 0.18, knockback: 2, up: 0.6,
        knockbackDir: dir, basic: true,
      });
      this.ui?.hitmarker?.(hit.combo >= 4);
    }
    // 光束贯穿可破坏物
    for (const b of this.arena.breakables) {
      if (b.broken) continue;
      const t = b.center.clone().sub(origin).dot(dir);
      if (t <= 0.2 || t > Math.min(range, wallDist + 0.4)) continue;
      const point = origin.clone().addScaledVector(dir, t);
      if (point.distanceTo(b.center) > b.radius + 0.8) continue;
      this._damageBreakable(b, hit.combo >= 4 ? 150 : 80, f, { cause: 'beam' });
    }
    if (nearest && hit.combo >= 4) this.effects.ring(nearest.target.pos.clone(), 0x5af2ff, { radius: 2.4, duration: 0.3, thickness: 0.05, vertical: true, billboard: true });
  }

  _spawnAirSlash(f, hit, aim) {
    const forward = f.forward(new THREE.Vector3());
    const start = f.pos.clone().setY(f.pos.y + 1.22).addScaledVector(forward, 0.55);
    const echo = !!hit.echo;
    const speed = 36;
    const range = echo ? 33 : 22;
    const damage = hit.combo >= 3 ? 33 : 23;
    const group = new THREE.Group();
    group.position.copy(start);
    const color = echo ? 0xbffcff : 0x5af2ff;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.92, 28, 1, -Math.PI * 0.55, Math.PI * 1.1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    group.add(ring);
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.3, 22),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    group.add(inner);
    const glow = spriteGlow(color, 2.0, 0.55);
    group.add(glow);
    this.scene.add(group);
    const proj = {
      owner: f, pos: start.clone(), prev: start.clone(), dir: aim.dir.clone(),
      speed, range, traveled: 0, radius: echo ? 0.9 : 0.7, damage,
      pierce: echo ? 4 : 0, hitIds: new Set(), alive: true, mesh: group, kind: 'airslash', color,
      rotate: 0,
    };
    this.projectiles.push(proj);
    this.sound?.swing(f, hit.combo);
    this.cameraRig.kickFov(2);
    if (echo) {
      this.effects.ring(start.clone(), 0x5af2ff, { radius: 1.6, duration: 0.3, thickness: 0.08, vertical: true, billboard: true });
      f.spaceEcho = 0;
    }
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.alive) { this._removeProjectile(p); this.projectiles.splice(i, 1); continue; }
      if (this.timeStop && this.timeStop.owner !== p.owner) continue;
      p.prev.copy(p.pos);
      const step = p.dir.clone().multiplyScalar(p.speed * dt);
      p.pos.add(step);
      p.traveled += step.length();
      p.mesh.position.copy(p.pos);
      if (this.camera) p.mesh.quaternion.copy(this.camera.quaternion);
      p.mesh.rotateZ(p.rotate += dt * 8);
      // 世界碰撞
      const dir = step.clone().normalize();
      const len = step.length();
      const wall = this.world.castRay(
        new RAPIER.Ray(p.prev, dir), len, true,
        undefined, undefined, p.owner.collider, p.owner.body,
        (col) => !this.isFighterCollider(col.handle)
      );
      let wallDist = len;
      if (wall) wallDist = wall.timeOfImpact;
      // 可破坏物
      let blocked = false;
      for (const b of this.arena.breakables) {
        if (b.broken) continue;
        const center = b.center.clone();
        const t = center.clone().sub(p.prev).dot(dir);
        if (t < 0 || t > wallDist) continue;
        const point = p.prev.clone().addScaledVector(dir, t);
        if (point.distanceTo(center) > b.radius + p.radius) continue;
        this._damageBreakable(b, p.damage * 2.6, p.owner, { cause: 'slash' });
        this.effects.particleBurst(point, p.color, 18, { speed: 7, life: 0.5, size: 0.16, gravity: 2, color2: 0xffffff });
        wallDist = t;
        blocked = true;
        break;
      }
      // 敌人
      let hitSomething = false;
      for (const e of this.fighters) {
        if (!e.alive || e === p.owner || p.hitIds.has(e.id)) continue;
        const center = e.pos.clone().setY(e.pos.y + 1.05);
        const t = center.clone().sub(p.prev).dot(dir);
        if (t < 0 || t > wallDist) continue;
        const point = p.prev.clone().addScaledVector(dir, t);
        if (point.distanceTo(center) > p.radius + 0.52) continue;
        p.hitIds.add(e.id);
        this.dealDamage(e, p.damage, p.owner, {
          type: 'basic', ranged: true, color: p.color, stun: 0.28,
          knockback: 7, up: 1.4, knockbackDir: dir, basic: true,
        });
        this.effects.slash(point, p.color, { radius: 2.6, duration: 0.3, angle: Math.PI * 1.3 });
        this.effects.particleBurst(point, 0xffffff, 14, { speed: 8, life: 0.4, size: 0.15, gravity: 0, color2: p.color });
        hitSomething = true;
        if (p.pierce > 0) p.pierce--;
        else { blocked = true; break; }
      }
      if (wall || blocked) {
        const point = p.prev.clone().addScaledVector(dir, Math.max(0.1, wallDist));
        this.effects.impact(point, p.color, { count: 18, speed: 6, radius: 1.3, heavy: false });
        p.alive = false;
      } else if (p.traveled > p.range) {
        p.alive = false;
      }
      if (!p.alive || hitSomething) {
        if (!p.alive) {
          this._removeProjectile(p);
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  _removeProjectile(p, dispose = true) {
    p.mesh.removeFromParent();
    if (dispose) {
      p.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    p.alive = false;
  }

  /* ================================================================ damage */
  damage(target, amount, source, opts = {}) {
    return this.dealDamage(target, amount, source, opts);
  }

  dealDamage(target, amount, source, opts = {}) {
    if (!target || !target.alive || target.eliminated) return 0;
    if (amount <= 0) return 0;
    if (target.invulnTimer > 0 && !opts.trueDamage) return 0;

    // 量子壁垒
    if (target.barrierTimer > 0) {
      if (opts.ranged) {
        this.effects.impact(target.pos.clone().setY(target.pos.y + 1.1), 0x5af2ff, { count: 20, speed: 5, radius: 1.6, heavy: true });
        this.effects.ring(target.pos.clone().setY(target.pos.y + 0.1), 0x5af2ff, { radius: 2.2, duration: 0.3, thickness: 0.07 });
        this.ui?.spawnDamageNumber(target.pos.clone().setY(target.pos.y + 2), 'BLOCK', 'shield');
        this.sound?.tick();
        return 0;
      }
      if (opts.melee && source && !opts.reflected) {
        const reflect = Math.round(amount * 0.4);
        this.dealDamage(source, reflect, target, {
          type: 'reflect', noShare: true, noMark: true, reflected: true,
          color: 0x5af2ff, stun: 0.1, knockback: 0,
        });
        this.effects.beam(target.pos.clone().setY(target.pos.y + 1.2), source.pos.clone().setY(source.pos.y + 1.1), 0x5af2ff, { duration: 0.18, width: 0.04 });
        if (source.isLocal) this.flashHurt();
      }
    }

    let dmg = amount;
    if (source?.def?.id === 'zhoutong' && target.knockdownTimer > 0) dmg *= 1.3;
    if (source?.def?.id === 'wangchen' && opts.basic) {
      for (const k of ['q', 'e', 'r']) target.cds[k] = Math.min(target.cdMaxs[k] + 6, target.cds[k] + 1.5);
    }

    dmg = Math.round(dmg);
    const actual = target.receiveDamage(dmg, source, {
      ...opts,
      crit: opts.crit || dmg >= 70,
      heavy: opts.heavy || dmg >= 60,
      knockbackDir: opts.knockbackDir,
    });
    if (!actual) return 0;

    if (source) {
      source.damageDealt += actual;
      source.score += actual * 0.12;
    }
    if (source?.isLocal && !this.isNetClient) {
      this.localCombo = this.localComboTimer > 0 ? this.localCombo + 1 : 1;
      this.localComboTimer = 2.1;
      this.ui?.setCombo?.(this.localCombo);
      this.ui?.hitmarker?.(dmg >= 50);
      if (dmg >= 50) this.cameraRig.shake(0.06, 0.15);
    }
    if (target.isLocal && !this.isNetClient) {
      this.flashHurt();
      if (actual > 30) this.ui?.hurtFlash?.();
    }

    // 何则佑被动：量子印记
    if (source?.def?.id === 'hezeyou' && !opts.noMark && target.alive) {
      target.addStatus('mark', 5);
      if (target.quantumMarks >= 3) {
        target.quantumMarks = 0;
        target.addStatus('root', 1);
        target.addStatus('reveal', 2.2);
        this.effects.ring(target.pos.clone().setY(0.06), 0x35ffcf, { radius: 3.3, duration: 0.55, thickness: 0.06 });
        this.effects.particleBurst(target.pos.clone().setY(1.1), 0x5af2ff, 34, { speed: 9, life: 0.7, size: 0.22, gravity: 1, color2: 0xffffff });
        this.effects.beam(target.pos.clone().setY(2.4), target.pos.clone().setY(0.2), 0x5af2ff, { duration: 0.25, width: 0.06 });
        this.ui?.centerCallout('量子爆破', 'RESONANCE DETONATION');
        this.sound?.freeze();
        this.dealDamage(target, 34, source, {
          trueDamage: true, type: 'passive', noMark: true, noShare: true,
          color: 0x35ffcf, stun: 0.2, knockback: 4,
        });
      }
    }

    // 何则佑量子锁链：伤害共享
    if (this.matrix && target.fateLinked && !opts.noShare && source !== target) {
      const others = [...this.matrix.targets].filter((e) => e !== target && e.alive);
      for (const other of others) {
        this.effects.linkLine(
          target.pos.clone().setY(target.pos.y + 1.2),
          other.pos.clone().setY(other.pos.y + 1.2), 0x35ffcf, 0.3
        );
        this.dealDamage(other, actual * 0.5, this.matrix.owner, {
          type: 'matrix', noShare: true, noMark: true, color: 0x35ffcf,
          stun: 0.06, noKnockback: true,
        });
      }
    }

    // 纳米磁网：30% 分摊给最近的另一名敌人
    if (target.netLinkedTimer > 0 && !opts.noShare) {
      let nearest = null, nd = 15;
      for (const e of this.fighters) {
        if (!e.alive || e === target || e === source) continue;
        const d = dist2D(e.pos, target.pos);
        if (d < nd) { nd = d; nearest = e; }
      }
      if (nearest) {
        this.effects.linkLine(target.pos.clone().setY(target.pos.y + 1.1), nearest.pos.clone().setY(nearest.pos.y + 1.1), 0x35ffcf, 0.3);
        this.dealDamage(nearest, actual * 0.3, source, {
          type: 'net', noShare: true, noMark: true, noKnockback: true, stun: false,
        });
      }
    }

    // 时停累积动能
    if (this.timeStop && target !== this.timeStop.owner) {
      this.timeStop.hits[target.id] = (this.timeStop.hits[target.id] || 0) + actual;
    }

    if (this.isNetHost && (dmg >= 50 || opts.ult)) {
      this.network?.broadcastEvent?.({ type: 'hit', id: target.netId, dmg: actual, color: opts.color || 0xffffff });
    }
    return actual;
  }

  areaDamage(center, radius, damage, source, opts = {}) {
    let hits = 0;
    for (const e of this.fighters) {
      if (!e.alive || e === source || e.eliminated) continue;
      const d = dist2D(e.pos, center);
      if (d > radius) continue;
      if (Math.abs(e.pos.y - center.y) > 5.5) continue;
      const dir = new THREE.Vector3(e.pos.x - center.x, 0, e.pos.z - center.z);
      if (dir.lengthSq() < 0.001) dir.set(rand(-1, 1), 0, rand(-1, 1));
      dir.normalize();
      const falloff = 1 - Math.min(0.35, (d / radius) * 0.25);
      this.dealDamage(e, damage * falloff, source, {
        ...opts,
        knockbackDir: dir,
        knockback: opts.knockback ?? 15,
        melee: opts.melee ?? true,
      });
      hits++;
    }
    if (opts.breakDamage) {
      this._damageBreakablesInArea(center, opts.breakRadius || radius * 1.05, opts.breakDamage, source, opts);
    }
    return hits;
  }

  _damageBreakablesInArea(center, radius, amount, source, opts = {}) {
    const list = this.arena.getBreakablesInRadius(center, radius);
    for (const b of list) {
      this._damageBreakable(b, amount, source, { cause: opts.cause || 'explosion', color: opts.color });
    }
  }

  _damageBreakable(b, amount, source, opts = {}) {
    if (!b || b.broken) return;
    const broke = this.arena.damageBreakable(b, amount, { cause: source, impulse: opts.impulse });
    if (broke) {
      if (source) {
        source.destruction++;
        source.score += 35 + Math.round(b.maxHp * 0.12);
      }
      this.ui?.addKillFeed?.({ type: 'destroy', name: source?.name, target: b.type });
      if (this.isNetHost) this.network?.broadcastBreak?.(b.id);
      if (source?.isLocal) {
        this.ui?.spawnDamageNumber(b.center.clone().setY(b.center.y + 1.2), '破坏', 'crit');
        this.cameraRig.shake(0.12, 0.25);
      }
    }
  }

  onWallSlam(fighter, speed, normal) {
    if (!fighter.alive) return;
    const attacker = fighter.lastAttacker;
    const extra = Math.round(7 + speed * 1.55);
    this.effects.impact(fighter.pos.clone().setY(fighter.pos.y + 1.1), 0xffcf5c, {
      count: 34, speed: 10, radius: 2.3, heavy: true,
    });
    this.effects.ring(fighter.pos.clone(), 0xffcf5c, { radius: 3.4, duration: 0.45, thickness: 0.025, vertical: true, billboard: true });
    this.effects.particleBurst(fighter.pos.clone().setY(fighter.pos.y + 1.2), 0xffe2a3, 30, {
      speed: 8, life: 0.8, size: 0.2, gravity: 8, color2: 0xffffff,
    });
    fighter.addStatus('stun', 1.0);
    fighter.addStatus('knockdown', 1.1);
    this.dealDamage(fighter, extra, attacker, {
      trueDamage: true, type: 'wall', color: 0xffcf5c, heavy: true,
      stun: 1.0, knockback: 0, noShare: true, noMark: true,
    });
    this.cameraRig.shake(0.26, 0.35);
    this.sound?.explosion(false);
    this.ui?.centerCallout?.('撞墙碎裂', `WALL SPLAT · +${extra} DMG`);
    if (attacker?.isLocal) this.ui?.hitmarker?.(true);
    // 撞上可破坏物时额外破坏
    const near = this.arena.getBreakableAt(fighter.pos, 1.4);
    if (near) {
      this._damageBreakable(near, 220, attacker, { cause: 'wallsplat' });
    }
    if (this.isNetHost) this.network?.broadcastEvent?.({ type: 'wallsplat', id: fighter.netId, dmg: extra });
  }

  onFighterFall(fighter) {
    if (!fighter.alive) return;
    const attacker = fighter.lastAttacker && this.elapsed - fighter.lastAttackerTime < 6 ? fighter.lastAttacker : null;
    fighter.hp = 0;
    this.ui?.centerCallout?.(
      attacker ? `${attacker.name} · 击落` : '坠落',
      'RING OUT / FALL INTO SHIBUYA'
    );
    this.effects.particleBurst(fighter.pos.clone(), 0xff5577, 30, { speed: 8, life: 0.9, size: 0.22, gravity: -1, color2: 0xffffff });
    fighter.die(attacker);
    if (fighter.isLocal) this.flashHurt();
  }

  onFighterKilled(fighter, source) {
    if (fighter._killHandled) return;
    fighter._killHandled = true;
    setTimeout(() => { fighter._killHandled = false; }, 100);
    fighter.deaths++;
    if (source && source !== fighter) {
      source.kills++;
      source.score += 220;
      source.maxKills = Math.max(source.maxKills || 0, source.kills);
    }
    this.sound?.death();
    if (source?.isLocal) {
      this.ui?.centerCallout?.('击破', 'K.O.');
      this.sound?.ko();
    } else if (fighter.isLocal) {
      this.ui?.centerCallout?.('被击破', 'K.O.');
      this.sound?.ko();
    }
    this.ui?.addKillFeed?.({
      type: 'kill', name: source?.name || '环境', target: fighter.name,
      color: source?.playerColor, weapon: fighter.deathCause,
    });

    if (this.modeId === 'survival') {
      fighter.lives = Math.max(0, fighter.lives - 1);
      if (fighter.lives <= 0) {
        fighter.eliminated = true;
        fighter.respawnTimer = 0;
        if (fighter.isLocal) {
          this.ui?.showSpectate?.();
          this._pickSpectateTarget();
          this.ui?.toast('你已被淘汰 · 观战中');
        }
      } else {
        fighter.respawnTimer = 3.2;
        if (fighter.isLocal) this.ui?.toast(`剩余生命 ${fighter.lives} · 3 秒后重生`);
      }
    } else {
      // 狂暴 / 训练场无限复活
      fighter.respawnTimer = this.modeId === 'training' ? 1.4 : 2.4;
    }
    if (this.isNetHost) this.network?.broadcastKill?.(fighter.netId, source?.netId || null);
    const alive = this.fighters.filter((f) => !f.eliminated);
    if (this.modeId === 'survival' && alive.length <= 1) {
      const winner = alive[0] || null;
      queueMicrotask(() => this.finishMatch(winner));
    }
    this.ui?.updateScoreboard?.(this);
  }

  _updateRespawns(dt) {
    if (this.isNetClient) return;
    for (const f of this.fighters) {
      if (f.eliminated) continue;
      if (f.dead && f.respawnTimer <= 0) {
        const spawn = this.pickSpawn(f);
        f.respawn(spawn);
        f.invulnTimer = 2.0;
        f.score = Math.max(0, f.score - 30);
        this.effects.teleportBurst(f.pos.clone(), f.def.palette.accent);
        this.effects.ring(f.pos.clone(), f.def.palette.accent, { radius: 3, duration: 0.6, thickness: 0.04 });
        if (f.isLocal) {
          this.ui?.hideSpectate?.();
          this.spectateTarget = null;
          this.cameraRig._init = false;
          this.cameraRig.setInitial(f.aimYaw);
          this.ui?.centerCallout?.('重返战场', 'RESPAWN');
        }
      }
    }
  }

  pickSpawn(f) {
    const points = this.arena.spawnPoints;
    let best = points[0];
    let bestScore = -Infinity;
    for (const p of points) {
      let nearest = 999;
      for (const other of this.fighters) {
        if (!other.alive || other === f) continue;
        nearest = Math.min(nearest, dist2D(p, other.pos));
      }
      const score = nearest + rand(0, 6);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)));
  }

  _pickSpectateTarget() {
    const alive = this.fighters.filter((f) => f.alive && !f.isLocal);
    if (!alive.length) return;
    alive.sort((a, b) => (b.kills * 100 + b.score) - (a.kills * 100 + a.score));
    this.spectateTarget = alive[0];
    this.cameraRig.spectateTarget = alive[0];
    this.ui?.setSpectateName?.(alive[0].name);
  }

  /* ================================================================ time stop */
  startTimeStop(owner) {
    if (this.timeStop) return false;
    this.timeStop = {
      owner, timeLeft: 3.5, total: 3.5, hits: {}, ended: false,
    };
    for (const f of this.fighters) {
      if (f !== owner) {
        f.frozen = true;
        f.knockback.set(0, 0, 0);
      }
    }
    this.postFX?.setTimeStop(true);
    this.ui?.showTimeStop?.(true);
    this.sound?.freeze();
    this.screenFlash('#ffffff');
    this.cameraRig?.shake(0.08, 0.4);
    if (this.isNetHost) this.network?.broadcastEvent?.({ type: 'timestop', active: true, owner: owner.netId, duration: 3.5 });
    return true;
  }

  _updateTimeStop(dt) {
    if (!this.timeStop) return;
    const ts = this.timeStop;
    ts.timeLeft -= dt;
    this.ui?.updateTimeStop?.(ts.timeLeft, ts.total);
    if (!ts.owner.alive) ts.timeLeft = 0;
    if (ts.timeLeft <= 0) this.endTimeStop();
  }

  endTimeStop() {
    const ts = this.timeStop;
    if (!ts) return;
    this.timeStop = null;
    const owner = ts.owner;
    for (const f of this.fighters) f.frozen = false;
    this.postFX?.setTimeStop(false);
    this.ui?.showTimeStop?.(false);
    this.effects.particleBurst(owner.pos.clone().setY(owner.pos.y + 1.4), 0xffffff, 40, {
      speed: 12, life: 1.0, size: 0.28, gravity: 0, color2: 0xffcf5c,
    });
    this.screenFlash('#ffffff');
    this.cameraRig?.shake(0.2, 0.4);
    this.sound?.unfreeze();
    // 累积动能爆发
    for (const [id, dmg] of Object.entries(ts.hits)) {
      const target = this.fighters.find((f) => f.id === id);
      if (!target?.alive) continue;
      const burst = Math.round(dmg * 0.7 + 12);
      this.effects.ring(target.pos.clone().setY(target.pos.y + 0.05), 0xffffff, { radius: 4, duration: 0.55, thickness: 0.03 });
      this.effects.shockwave(target.pos.clone(), 0xffcf5c, { radius: 4.5, duration: 0.55, count: 28, light: 8, dust: false });
      this.dealDamage(target, burst, owner, {
        trueDamage: true, type: 'timestop', color: 0xffcf5c, heavy: true,
        stun: 0.7, knockback: 16, up: 7, knockdown: true, noShare: true, noMark: true,
      });
      this.ui?.spawnDamageNumber(target.pos.clone().setY(target.pos.y + 2.1), `动能 +${burst}`, 'crit');
    }
    if (Object.keys(ts.hits).length) {
      this.ui?.centerCallout?.('时间恢复', 'KINETIC RELEASE / 动能爆发');
      this.sound?.explosion(true);
    }
    if (this.isNetHost) this.network?.broadcastEvent?.({ type: 'timestop', active: false, owner: owner.netId });
  }

  /* ================================================================ match state */
  _updateMatchState(dt) {
    if (this.modeId === 'frenzy') {
      this.matchTime += dt;
      const remain = Math.max(0, this.matchDuration - this.matchTime);
      if (remain <= 10 && Math.ceil(remain) !== this.lastFrenzyTick) {
        this.lastFrenzyTick = Math.ceil(remain);
        this.sound?.tick();
        this.ui?.toast(`决战时刻 · ${this.lastFrenzyTick}`);
      }
      if (remain <= 0) {
        const standings = this.getStandings();
        this.finishMatch(standings[0]?.f || null);
      }
    } else {
      this.matchTime += dt;
    }
    if (this.localFighter?.eliminated && this.state === 'playing') {
      const alive = this.fighters.filter((f) => f.alive);
      if (alive.length && !this.spectateTarget?.alive) this._pickSpectateTarget();
    }
    this.ui?.updateFrenzy?.((this.matchDuration - this.matchTime), this.modeId);
  }

  _updateCombo(dt) {
    if (this.localComboTimer > 0) {
      this.localComboTimer -= dt;
      if (this.localComboTimer <= 0) {
        this.localCombo = 0;
        this.ui?.setCombo?.(0);
      }
    }
  }

  getStandings() {
    return [...this.fighters].sort((a, b) => {
      const sa = a.score + a.kills * 100;
      const sb = b.score + b.kills * 100;
      return sb - sa;
    }).map((f, i) => ({ f, rank: i + 1 }));
  }

  finishMatch(winner) {
    if (this.matchOver) return;
    this.matchOver = true;
    const standings = this.getStandings();
    if (!winner) winner = standings[0]?.f || null;
    this.state = 'gameover';
    this.input.setEnabled(false);
    this.input.releaseLock();
    const isWinner = winner === this.localFighter;
    if (isWinner) this.sound?.win(); else this.sound?.ko();
    if (this.isNetHost) this.network?.broadcastEvent?.({ type: 'end', winner: winner?.netId || null, standings: standings.map((s) => s.f.netId) });
    this.ui?.showGameOver?.({
      winner,
      standings,
      local: this.localFighter,
      mode: this.mode,
      matchTime: this.matchTime,
      isWinner,
    });
    this.cameraRig.spectateTarget = winner;
    this._gameOverWinner = winner;
  }

  _updateGameOverCamera(dt) {
    const winner = this._gameOverWinner;
    if (!winner) return;
    this._menuAngle += dt * 0.15;
    const target = winner.pos;
    const radius = 7;
    this.camera.position.x = damp(this.camera.position.x, target.x + Math.cos(this._menuAngle) * radius, 2, dt);
    this.camera.position.z = damp(this.camera.position.z, target.z + Math.sin(this._menuAngle) * radius, 2, dt);
    this.camera.position.y = damp(this.camera.position.y, target.y + 3.2, 2, dt);
    this.camera.lookAt(target.x, target.y + 1.2, target.z);
    this.effects.update(dt);
    this.arena.update(dt);
  }

  screenFlash(color = '#ffffff') { this.ui?.screenFlash?.(color); }

  /* ================================================================ networking */
  getNetworkPayload() {
    return {
      players: this.fighters.map((f) => ({
        netId: f.netId, name: f.name, defId: f.def.id, charId: f.def.id, isBot: f.isBot,
      })),
      mode: this.modeId,
    };
  }

  serializeSnapshot() {
    return {
      t: +this.matchTime.toFixed(2),
      elapsed: +this.elapsed.toFixed(2),
      fighters: this.fighters.map((f) => f.serialize()),
      broken: this.arena.breakables.filter((b) => b.broken).map((b) => b.id),
      ts: this.timeStop ? {
        owner: this.timeStop.owner.netId,
        left: +this.timeStop.timeLeft.toFixed(2),
        total: this.timeStop.total,
      } : null,
      matrix: !!this.matrix,
      state: this.state,
    };
  }

  applyNetworkSnapshot(snap) {
    if (!snap || !this.isNetClient) return;
    this.matchTime = snap.t ?? this.matchTime;
    this.elapsed = snap.elapsed ?? this.elapsed;
    for (const state of snap.fighters || []) {
      const f = this.fighterByNet.get(state.netId) || this.fighters.find((x) => x.netId === state.netId || x.id === state.id);
      if (f) f.applyNetSnapshot(state);
    }
    if (snap.broken) {
      for (const b of this.arena.breakables) {
        if (!b.broken && snap.broken.includes(b.id)) {
          this.arena.break(b, { silent: true });
        }
      }
    }
    // 时停视觉同步
    if (snap.ts && !this.timeStop) {
      this.timeStop = { owner: this.fighterByNet.get(snap.ts.owner) || this.localFighter, timeLeft: snap.ts.left, total: snap.ts.total, hits: {}, remote: true };
      this.postFX?.setTimeStop(true);
      this.ui?.showTimeStop?.(true);
      this.sound?.freeze();
      for (const f of this.fighters) if (f.netId !== snap.ts.owner) f.frozen = true;
    } else if (!snap.ts && this.timeStop?.remote) {
      this.timeStop = null;
      this.postFX?.setTimeStop(false);
      this.ui?.showTimeStop?.(false);
      for (const f of this.fighters) f.frozen = false;
      this.sound?.unfreeze();
    }
    if (snap.ts) this.ui?.updateTimeStop?.(snap.ts.left, snap.ts.total);
    this.ui?.updateFromSnapshot?.(snap);
  }

  handleNetworkEvent(evt) {
    if (!evt) return;
    if (evt.type === 'ability') {
      this.playRemoteAbility(evt);
    } else if (evt.type === 'basic') {
      this.playRemoteBasic(evt);
    } else if (evt.type === 'timestop') {
      if (evt.active) {
        if (!this.timeStop) {
          this.timeStop = { owner: this.fighterByNet.get(evt.owner) || this.localFighter, timeLeft: evt.duration || 3.5, total: 3.5, hits: {}, remote: true };
          this.postFX?.setTimeStop(true);
          this.ui?.showTimeStop?.(true);
          this.sound?.freeze();
          this.screenFlash('#ffffff');
        }
      } else if (this.timeStop?.remote) {
        this.timeStop = null;
        this.postFX?.setTimeStop(false);
        this.ui?.showTimeStop?.(false);
        this.sound?.unfreeze();
      }
    } else if (evt.type === 'end') {
      this.finishFromNet(evt);
    } else if (evt.type === 'hit') {
      const f = this.fighterByNet.get(evt.id);
      if (f) this.effects.hitSpark(f.pos.clone().setY(f.pos.y + 1.3), evt.color || 0xffffff, evt.dmg || 10);
    } else if (evt.type === 'break') {
      const b = this.arena.breakables.find((x) => x.id === evt.id);
      if (b && !b.broken) this.arena.break(b, { silent: true });
    } else if (evt.type === 'kill') {
      const target = this.fighterByNet.get(evt.id);
      const source = evt.source ? this.fighterByNet.get(evt.source) : null;
      if (target) this.ui?.addKillFeed?.({ type: 'kill', name: source?.name || '环境', target: target.name });
    } else if (evt.type === 'wallsplat') {
      const f = this.fighterByNet.get(evt.id);
      if (f) {
        this.effects.impact(f.pos.clone().setY(f.pos.y + 1.1), 0xffcf5c, { count: 24, speed: 8, radius: 2, heavy: true });
        this.ui?.spawnDamageNumber?.(f.pos.clone().setY(f.pos.y + 1.9), '撞墙', 'crit');
      }
    }
  }

  playRemoteAbility(evt) {
    const f = this.fighterByNet.get(evt.id);
    if (!f) return;
    const def = f.def;
    const point = evt.point ? new THREE.Vector3(evt.point[0], evt.point[1], evt.point[2]) : f.pos.clone();
    const slot = evt.slot;
    if (slot === 'r') {
      if (def.id === 'zhoutong') {
        this.effects.blackHole(point, def.palette.accent, { duration: 3.2, radius: 8 });
        this.effects.shockwave(point, def.palette.accent, { radius: 12, count: 40, light: 8 });
        this.cameraRig?.shake(0.2, 0.5);
      } else if (def.id === 'guojunxi') {
        this.effects.cloisterPortals(f.pos.clone().setY(f.pos.y + 1.3), 0x5af2ff, { count: 14, radius: 9 });
        this.effects.ring(f.pos.clone().setY(0.08), 0x5af2ff, { radius: 11, duration: 2.2, thickness: 0.03, opacity: 0.35 });
      } else if (def.id === 'hezeyou') {
        this.effects.matrixField(f.pos, 0x35ffcf, { radius: 16, duration: 8 });
      } else if (def.id === 'wangchen') {
        this.screenFlash('#ffffff');
      }
    } else {
      this.effects.castAura(f, def.palette.accent, 0.5);
      this.effects.shockwave(point.clone().setY(0.2), def.palette.accent, { radius: 3.2, count: 16, dust: false, light: 3 });
      if (def.id === 'guojunxi' && slot === 'q') {
        this.effects.teleportBurst(f.pos.clone(), 0x5af2ff);
      }
    }
    this.ui?.centerCallout?.(`${def.name} · ${def.skills[slot]?.name || ''}`, 'REMOTE CAST');
  }

  playRemoteBasic(evt) {
    const f = this.fighterByNet.get(evt.id);
    if (!f) return;
    const origin = new THREE.Vector3(evt.origin?.[0] || f.pos.x, evt.origin?.[1] || f.pos.y + 1.2, evt.origin?.[2] || f.pos.z);
    const dir = new THREE.Vector3(evt.dir?.[0] || 0, evt.dir?.[1] || 0, evt.dir?.[2] || 1).normalize();
    if (evt.char === 'guojunxi') {
      const start = f.pos.clone().setY(f.pos.y + 1.2).addScaledVector(dir, 0.7);
      this.effects.slash(start, 0x5af2ff, { radius: 2.2, duration: 0.25, angle: Math.PI * 1.2 });
      this.effects.beam(start, start.clone().addScaledVector(dir, 9), 0x5af2ff, { duration: 0.12, width: 0.04 });
    } else if (evt.char === 'hezeyou') {
      this.effects.beam(origin, origin.clone().addScaledVector(dir, 24), 0x5af2ff, { duration: 0.13, width: 0.045 });
    } else {
      const p = f.pos.clone().addScaledVector(dir, 1.7).setY(f.pos.y + 1.1);
      this.effects.slash(p, evt.char === 'wangchen' ? 0xff5577 : 0xb98cff, { radius: evt.combo >= 3 ? 3.5 : 2.1, duration: 0.22 });
      if (evt.combo >= 3) this.effects.ring(f.pos.clone(), f.def.palette.accent, { radius: 3.2, duration: 0.3, thickness: 0.05 });
    }
  }

  finishFromNet(evt) {
    if (this.matchOver) return;
    const winner = evt.winner ? this.fighterByNet.get(evt.winner) : null;
    this.matchOver = true;
    this.state = 'gameover';
    this.input.setEnabled(false);
    const standings = this.getStandings();
    this.ui?.showGameOver?.({
      winner, standings, local: this.localFighter, mode: this.mode,
      matchTime: this.matchTime, isWinner: winner === this.localFighter, network: true,
    });
    this._gameOverWinner = winner;
  }
}

