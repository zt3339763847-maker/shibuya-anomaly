import { CHARACTERS, CHARACTER_MAP } from '../data/characters.js';
import { clamp, damp, formatTime, makeId } from '../core/utils.js';

const STORAGE_SETTINGS = 'shibuya_settings_v1';
const STORAGE_HUD = 'shibuya_hud_layout_v1';
const STORAGE_NAME = 'shibuya_player_name';

const CONTROL_NAMES = {
  attack: '普攻', jump: '跳跃', dodge: '闪避',
  q: '技能一', e: '技能二', r: '终极技能', camera: '视角切换',
};

const DEFAULT_LAYOUT = {
  attack: { x: 88, y: 70, size: 100, opacity: 86 },
  jump: { x: 76, y: 84, size: 100, opacity: 82 },
  dodge: { x: 95, y: 52, size: 100, opacity: 82 },
  q: { x: 70, y: 58, size: 100, opacity: 82 },
  e: { x: 82, y: 46, size: 100, opacity: 82 },
  r: { x: 92, y: 33, size: 100, opacity: 88 },
  camera: { x: 7, y: 19, size: 100, opacity: 75 },
  joystick: { x: 8, y: 82, size: 100, opacity: 82 },
};

const TYPE_NAMES = { column: '水泥柱', glass: '玻璃幕墙', car: '报废汽车', crate: '废墟木箱' };

function escapeText(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export class UI {
  constructor() {
    this.game = null;
    this.preview = null;
    this.network = null;
    this.selectedChar = 'zhoutong';
    this.selectedMode = 'survival';
    this.local = null;
    this.hpDisplay = 1;
    this.frameCount = 0;
    this.damageNumbers = [];
    this.scoreboardVisible = false;
    this.isTouch = (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0) || (navigator.maxTouchPoints > 0 && window.innerWidth < 1100);
    this.config = this._loadJSON(STORAGE_SETTINGS, { sens: 1, volume: 70, bloom: 55, quality: 'midt' });
    this.layout = { ...DEFAULT_LAYOUT, ...this._loadJSON(STORAGE_HUD, {}) };
    for (const key of Object.keys(DEFAULT_LAYOUT)) {
      this.layout[key] = { ...DEFAULT_LAYOUT[key], ...(this.layout[key] || {}) };
    }
    this.skillEls = {};
    this.actionEls = {};
    this._calloutTimer = null;
    this._toastTimer = null;
    this._killTimers = [];
    this._netRoom = '';
    this._netIsHost = false;
    this._settingsOnly = false;
    this._bindStatic();
    this._buildMenu();
    this._bindMenu();
    this._bindHUD();
    this._bindSettings();
    this._bindNet();
    this._bindHudEditor();
    this._createScoreboard();
    this._createAuxElements();
    this.applyLayout();
    this.applySettings();
    this.selectCharacter(this.selectedChar, true);
    if (this.isTouch) document.body.classList.add('is-touch');
  }

  /* ================================================================ helpers */
  _loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
    } catch (e) { return { ...fallback }; }
  }

  _saveJSON(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* noop */ }
  }

  _el(id) { return document.getElementById(id); }

  _createAuxElements() {
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'color-flash';
    this._el('hud').appendChild(this.flashEl);
  }

  setGame(game) {
    this.game = game;
    this.applySettings();
  }

  setPreview(preview) {
    this.preview = preview;
    this.preview.setCharacter(this.selectedChar);
  }

  applyPortraits(portraits) {
    if (!portraits) return;
    for (const c of CHARACTERS) {
      const card = document.querySelector(`.char-card[data-char="${c.id}"] .cc-img`);
      if (card && portraits[c.id]) card.style.backgroundImage = `url(${portraits[c.id]})`;
    }
  }

  getSelection() {
    return {
      charId: this.selectedChar,
      mode: this.selectedMode,
      botCount: parseInt(this._el('bot-count')?.value || '3', 10),
      charName: CHARACTER_MAP[this.selectedChar]?.name,
    };
  }

  /* ================================================================ menu */
  _buildMenu() {
    const roster = this._el('char-roster');
    roster.innerHTML = '';
    for (const c of CHARACTERS) {
      const card = document.createElement('button');
      card.className = 'char-card';
      card.dataset.char = c.id;
      card.style.setProperty('--accent', c.color);
      card.innerHTML = `
        <span class="cc-img"></span>
        <span class="cc-tint"></span>
        <span class="cc-kanji">${c.kanji}</span>
        <span class="cc-meta">
          <span class="cc-no">${c.no} / ${c.element}</span>
          <span class="cc-name">${c.name}</span>
          <span class="cc-role">${c.role}</span>
        </span>`;
      roster.appendChild(card);
    }
  }

  _bindStatic() {
    const body = document.body;
    if (this.isTouch) {
      body.classList.add('is-touch');
      document.documentElement.style.setProperty('--touch', '1');
    }
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('is-touch');
      }, 200);
    });
  }

  _bindMenu() {
    document.querySelectorAll('.char-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectCharacter(card.dataset.char);
        this.game?.audio?.click?.();
        this.network?.updateCharacter?.(this.selectedChar);
      });
    });
    document.querySelectorAll('.mode-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectedMode = card.dataset.mode;
        document.querySelectorAll('.mode-card').forEach((c) => c.classList.toggle('selected', c === card));
        this.game?.audio?.click?.();
      });
    });
    this._el('btn-start').addEventListener('click', () => this._startGame());
    this._el('btn-training').addEventListener('click', () => this._startGame(true));
    this._el('btn-net').addEventListener('click', () => this.openNet());
    this._el('btn-help-top').addEventListener('click', () => this.openHelp());
    this._el('btn-settings-top').addEventListener('click', () => this.openSettingsMenu());
    this._el('btn-help-close').addEventListener('click', () => this.closeHelp());
  }

  selectCharacter(id, silent = false) {
    const def = CHARACTER_MAP[id];
    if (!def) return;
    this.selectedChar = id;
    document.querySelectorAll('.char-card').forEach((card) => {
      card.classList.toggle('selected', card.dataset.char === id);
    });
    this._el('detail-role').textContent = def.role;
    this._el('detail-element').textContent = def.element;
    this._el('detail-name').innerHTML = `${def.name} <small>${def.roman}</small>`;
    this._el('detail-tagline').textContent = def.tagline;
    this._el('detail-desc').textContent = def.desc;
    this._el('detail-stats').innerHTML = [
      ['破坏', def.stats.power], ['速度', def.stats.speed], ['射程', def.stats.range], ['技巧', def.stats.technique],
    ].map(([label, value]) => `
      <div class="stat-line"><b>${label}</b><span><i style="width:${value * 20}%"></i></span><em>${value}</em></div>
    `).join('');
    this._el('preview-no').textContent = def.no;
    this._el('preview-name').textContent = def.name;
    this._el('preview-roman').textContent = def.roman;
    this._el('preview-role').textContent = `${def.element} / ${def.role.toUpperCase()}`;
    this._el('preview-quote').textContent = def.quote;
    this._el('preview-ability-mini').innerHTML = ['q', 'e', 'r'].map((slot) => `
      <div class="pam-item"><b>${def.skills[slot].icon}</b><span>${def.skills[slot].name}</span></div>
    `).join('');
    const menu = this._el('menu');
    menu.style.setProperty('--accent', def.color);
    const detail = this._el('char-detail');
    detail.style.setProperty('--accent', def.color);
    const pv = document.querySelector('.preview-frame');
    pv?.style.setProperty('--accent', def.color);
    this.preview?.setCharacter(id);
    if (!silent) this._el('menu').animate?.(
      [{ filter: 'brightness(1.15)' }, { filter: 'brightness(1)' }],
      { duration: 220, easing: 'ease-out' }
    );
  }

  _startGame(training = false) {
    if (!this.game) { this.toast('游戏仍在初始化'); return; }
    if (this.game.state === 'playing') return;
    this.game.audio?.init();
    this.game.audio?.click();
    const s = this.getSelection();
    this.hideMenu();
    this.hideNet();
    if (!this.isTouch) this.game.input?.requestLock?.();
    this.game.startLocal({
      charId: s.charId,
      mode: s.mode,
      botCount: training ? 1 : s.botCount,
      training,
    });
  }

  showMenu() {
    this._el('menu').classList.remove('hidden');
    this._el('hud').classList.add('hidden');
    this.hidePause();
    this.hideGameOver();
    this.hideNet();
    this.closeHelp();
    this.closeHudEditor();
    this.hideTimeStop();
    this.hideSpectate();
    this.scoreboardVisible = false;
    this._el('scoreboard-overlay')?.classList.add('hidden');
    this.setPointerLock(true);
    this.preview?.setActive(true);
    this.local = null;
  }

  hideMenu() {
    this._el('menu').classList.add('hidden');
    this.preview?.setActive(false);
  }

  showGame() {
    this._el('hud').classList.remove('hidden');
  }

  hideGame() {
    this._el('hud').classList.add('hidden');
  }

  /* ================================================================ HUD setup */
  setupMatch(game) {
    this.game = game;
    this.local = game.localFighter;
    if (!this.local) return;
    const def = this.local.def;
    this._el('hud').classList.remove('hidden');
    this._el('hud').classList.remove('hidden');
    this._el('hud').style.setProperty('--accent', def.color);
    this._el('player-panel').style.setProperty('--accent', def.color);
    this._el('avatar-glyph').textContent = def.glyph;
    this._el('player-avatar').style.setProperty('--accent', def.color);
    this._el('hud-player-name').textContent = this.local.name || def.name;
    this._el('hud-player-roman').textContent = def.roman;
    this._el('hud-mode').textContent = game.mode.name;
    this._el('shard-box').style.display = def.id === 'wangchen' ? '' : 'none';
    this._buildSkillBar(def);
    this._buildMobileSkillLabels(def);
    this.hpDisplay = 1;
    this._lastHpText = null;
    this._lastStatus = null;
    this._lastShards = null;
    this.scoreboardVisible = false;
    this._el('scoreboard-overlay')?.classList.add('hidden');
    this._el('hud-hp-fill').style.transform = 'scaleX(1)';
    this._el('hud-hp-lag').style.transform = 'scaleX(1)';
    this._el('killfeed').innerHTML = '';
    this._el('damage-layer').innerHTML = '';
    this.damageNumbers = [];
    this._el('hud-statuses').innerHTML = '';
    this.scoreboardVisible = false;
    this._el('scoreboard-overlay')?.classList.add('hidden');
    this._el('time-stop-overlay').classList.remove('active');
    this._el('spectate-bar').classList.add('hidden');
    this._el('hud-hp-text').textContent = `${Math.round(this.local.maxHp)} / ${Math.round(this.local.maxHp)}`;
    this.setCameraMode(game.cameraRig.firstPerson);
    this.applySettings();
    this._el('btn-sound').classList.toggle('muted', !!this.game.audio?.muted);
    this._el('btn-sound').textContent = this.game.audio?.muted ? '✕' : '♪';
    // 冷却遮罩
    for (const [key, btn] of Object.entries(this.actionEls)) {
      if (!['q', 'e', 'r'].includes(key)) continue;
      if (!btn.querySelector('.cd-mask')) {
        const mask = document.createElement('span'); mask.className = 'cd-mask';
        const num = document.createElement('span'); num.className = 'cd-num';
        btn.append(mask, num);
      }
    }
    this.hidePause();
    this.hideGameOver();
    this.hideNet();
    this.setPointerLock(false);
    this.updateScoreboard(game);
  }

  _buildSkillBar(def) {
    const bar = this._el('skill-bar');
    bar.innerHTML = '';
    this.skillEls = {};
    for (const slot of ['q', 'e', 'r']) {
      const skill = def.skills[slot];
      const btn = document.createElement('button');
      btn.className = `skill-btn${slot === 'r' ? ' ult' : ''}`;
      btn.dataset.skill = slot;
      btn.style.setProperty('--accent', skill.color || def.color);
      btn.title = `${skill.name} · ${skill.desc}  [CD ${skill.cd}s${skill.charges ? ` / ${skill.charges} 充能` : ''}]`;
      btn.innerHTML = `
        <span class="sk-key">${slot.toUpperCase()}</span>
        <span class="sk-icon">${skill.icon}</span>
        <span class="sk-name">${skill.name}</span>
        <span class="sk-cd"></span>
        <span class="sk-cdtext"></span>
        <span class="sk-charge"></span>`;
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.game?.handleAction(slot); });
      bar.appendChild(btn);
      this.skillEls[slot] = {
        root: btn,
        cd: btn.querySelector('.sk-cd'),
        cdText: btn.querySelector('.sk-cdtext'),
        charge: btn.querySelector('.sk-charge'),
        max: skill.cd,
      };
    }
  }

  _buildMobileSkillLabels(def) {
    this.actionEls = {};
    document.querySelectorAll('.act-btn').forEach((btn) => {
      this.actionEls[btn.dataset.action] = btn;
      btn.style.setProperty('--accent', def.color);
      if (btn.classList.contains('act-skill')) {
        const slot = btn.dataset.action;
        const skill = def.skills[slot];
        if (skill) {
          btn.querySelector('span').textContent = skill.icon;
          btn.querySelector('small').textContent = skill.name.slice(0, 4);
          btn.title = `${skill.name} · ${skill.desc}`;
          btn.style.setProperty('--accent', skill.color || def.color);
        }
      }
    });
    for (const [key, el] of Object.entries(this.actionEls)) {
      if (!el._hudDragBound) {
        this._bindDrag(el, key);
        el._hudDragBound = true;
      }
    }
  }

  /* ================================================================ HUD update */
  updateHUD(game, dt) {
    if (!this.local || !game || game.state !== 'playing') return;
    const f = this.local;
    this.frameCount++;
    const ratio = clamp(f.hp / f.maxHp, 0, 1);
    this.hpDisplay = damp(this.hpDisplay, ratio, 8, dt);
    this._el('hud-hp-fill').style.transform = `scaleX(${ratio})`;
    this._el('hud-hp-lag').style.transform = `scaleX(${this.hpDisplay})`;
    const hpText = `${Math.max(0, Math.round(f.hp))} / ${Math.round(f.maxHp)}`;
    if (this._lastHpText !== hpText) {
      this._el('hud-hp-text').textContent = hpText;
      this._lastHpText = hpText;
    }
    const stock = this.local.lives >= 999 ? '∞' : '◆ '.repeat(Math.max(0, this.local.lives)).trim();
    this._el('hud-stock').textContent = stock || '—';
    this._el('hud-alive').textContent = game.fighters.filter((x) => !x.eliminated).length;
    this._el('hud-player-name').textContent = f.name;

    // timer
    let timer = '∞';
    if (game.modeId === 'frenzy') timer = formatTime(Math.max(0, game.matchDuration - game.matchTime));
    else if (game.modeId === 'survival') timer = formatTime(game.matchTime);
    this._el('hud-timer').textContent = timer;

    // statuses
    const statuses = [];
    if (f.stunTimer > 0) statuses.push(['stun', '眩晕']);
    if (f.rootTimer > 0) statuses.push(['root', '定身']);
    if (f.barrierTimer > 0) statuses.push(['shield', '壁垒']);
    if (f.hasteTimer > 0) statuses.push(['haste', '加速']);
    if (f.quantumMarks > 0) statuses.push(['mark', `量子 ×${f.quantumMarks}`]);
    if (f.netLinkedTimer > 0) statuses.push(['root', '磁网']);
    if (f.invulnTimer > 1.2) statuses.push(['shield', '无敌']);
    if (game.timeStop && game.timeStop.owner === f) statuses.push(['stop', '时停']);
    const statusHtml = statuses.map(([cls, text]) => `<span class="status-chip ${cls}">${text}</span>`).join('');
    if (this._lastStatus !== statusHtml) {
      this._el('hud-statuses').innerHTML = statusHtml;
      this._lastStatus = statusHtml;
    }

    // cooldowns / skills
    for (const slot of ['q', 'e', 'r']) {
      const se = this.skillEls[slot];
      if (!se) continue;
      const chargeMax = f.chargeMax[slot] || 0;
      let remain = 0, max = se.max, count = 0;
      if (chargeMax) {
        count = f.charges[slot];
        remain = count < chargeMax ? f.rechargeTimers[slot] : 0;
        max = se.max;
      } else {
        remain = f.cds[slot];
        max = f.cdMaxs[slot] || se.max;
      }
      const cdRatio = max > 0 ? clamp(remain / max, 0, 1) : 0;
      se.cd.style.setProperty('--cd', `${cdRatio * 100}%`);
      se.cdText.textContent = remain > 0.08 ? (remain > 10 ? Math.ceil(remain) : remain.toFixed(1)) : '';
      se.charge.textContent = chargeMax ? `${count}/${chargeMax}` : '';
      const ready = remain <= 0.01 && (!chargeMax || count > 0);
      se.root.classList.toggle('ready', ready);
      se.root.classList.toggle('disabled', !ready);
      const ab = this.actionEls[slot];
      if (ab) {
        const mask = ab.querySelector('.cd-mask');
        const num = ab.querySelector('.cd-num');
        if (mask && num) {
          const on = remain > 0.08 || (chargeMax && count <= 0);
          mask.classList.toggle('on', on);
          num.classList.toggle('on', on);
          mask.style.setProperty('--cd', `${cdRatio * 100}%`);
          num.textContent = remain > 0.08 ? (remain > 10 ? Math.ceil(remain) : remain.toFixed(1)) : '';
        }
      }
    }
    // shards
    if (f.shardMax) {
      const html = Array.from({ length: f.shardMax }, (_, i) => `<i class="shard${i < f.shards ? ' on' : ''}"></i>`).join('');
      if (this._lastShards !== html) {
        this._el('hud-shards').innerHTML = html;
        this._lastShards = html;
      }
    }

    // combo
    this._el('combo-num').textContent = game.localCombo || 0;
    this._el('combo-num').parentElement.classList.toggle('show', (game.localCombo || 0) > 1);

    // scoreboard mini
    if (this.frameCount % 20 === 0) this.updateScoreboard(game);
    // minimap
    if (this.frameCount % 6 === 0) this._drawMinimap(game);
    this._updateDamageNumbers(dt);

    // spectate
    if (f.eliminated) {
      const bar = this._el('spectate-bar');
      bar.classList.remove('hidden');
      this._el('spectate-name').textContent = game.spectateTarget?.name || '—';
    } else {
      this._el('spectate-bar').classList.add('hidden');
    }
    // 声音状态
  }

  updateFromSnapshot(snap) {
    // 客户端由 updateHUD 处理
  }

  _updateDamageNumbers(dt) {
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i];
      d.age += dt;
      if (d.age > 0.9 || !this.game?.cameraRig) {
        d.el.remove();
        this.damageNumbers.splice(i, 1);
        continue;
      }
      const p = this.game.cameraRig.project(d.pos);
      if (!p.visible) { d.el.style.display = 'none'; continue; }
      d.el.style.display = '';
      d.el.style.left = `${p.x}px`;
      d.el.style.top = `${p.y}px`;
    }
  }

  spawnDamageNumber(pos, value, type = 'normal') {
    if (!this.game || this.game.state !== 'playing') return;
    const el = document.createElement('div');
    el.className = `dmg-num ${type}`;
    el.textContent = value;
    this._el('damage-layer').appendChild(el);
    const p = this.game.cameraRig?.project(pos);
    if (p) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
    this.damageNumbers.push({ el, pos: pos.clone ? pos.clone() : pos, age: 0 });
    while (this.damageNumbers.length > 28) {
      this.damageNumbers[0].el.remove();
      this.damageNumbers.shift();
    }
  }

  updateCrosshair(target) {
    const ch = this._el('crosshair');
    if (!ch) return;
    const local = this.game?.localFighter;
    ch.classList.toggle('enemy', !!target);
    ch.classList.toggle('hidden-ch', !local || !local.alive || this.game.paused);
  }

  hitmarker(crit = false) {
    const el = this._el('hitmarker');
    if (!el) return;
    el.classList.remove('show', 'crit');
    void el.offsetWidth;
    el.classList.add('show');
    if (crit) el.classList.add('crit');
  }

  flashHurt() {
    this._el('hud-screen-fx').classList.add('hurt');
    clearTimeout(this._hurtTimer);
    this._hurtTimer = setTimeout(() => this._el('hud-screen-fx').classList.remove('hurt'), 180);
  }

  hurtFlash() { this.flashHurt(); }

  flashSpeed() {
    const el = this._el('speed-flash');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  screenFlash(color = '#fff') {
    if (!this.flashEl) return;
    this.flashEl.style.background = color;
    this.flashEl.classList.remove('go'); void this.flashEl.offsetWidth; this.flashEl.classList.add('go');
  }

  setCombo(n) {
    this._el('combo-num').textContent = n;
    this._el('combo-num').parentElement.classList.toggle('show', n > 1);
  }

  centerCallout(main, sub = '') {
    const el = this._el('center-callout');
    if (!el) return;
    el.className = 'center-callout';
    el.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = main;
    el.appendChild(b);
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      el.appendChild(small);
    }
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this._calloutTimer);
    this._calloutTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }

  toast(message, duration = 2200) {
    const el = this._el('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  addKillFeed(data) {
    const feed = this._el('killfeed');
    if (!feed) return;
    const item = document.createElement('div');
    item.className = 'kf-item';
    if (data.type === 'destroy') {
      const b = document.createElement('b'); b.textContent = data.name || '某人';
      const span = document.createElement('span'); span.textContent = ` 摧毁了 ${TYPE_NAMES[data.target] || '场景'}`;
      item.append(b, span);
    } else {
      const b = document.createElement('b'); b.textContent = data.name || '环境';
      const icon = document.createElement('span'); icon.className = 'kf-skill'; icon.textContent = '⚔';
      const target = document.createElement('b'); target.textContent = data.target || '术师';
      item.append(b, icon, target);
    }
    feed.prepend(item);
    while (feed.children.length > 5) feed.lastElementChild.remove();
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transition = 'opacity .3s';
      setTimeout(() => item.remove(), 320);
    }, 4200);
  }

  setCameraMode(fpp) {
    const el = this._el('btn-cam');
    if (el) el.innerHTML = `视角 <b>${fpp ? 'FPP' : 'OTS'}</b>`;
  }

  setPointerLock(locked) {
    const hint = this._el('pointer-hint');
    if (!hint) return;
    const show = this.game?.state === 'playing' && !this.game.paused && !this.isTouch && !locked;
    hint.classList.toggle('hidden', !show);
  }

  updateTimeStop(left, total) {
    const small = document.querySelector('#time-stop-overlay .ts-copy small');
    if (small) small.textContent = `TIME STOP / ${Math.max(0, left).toFixed(2)}s`;
  }

  showTimeStop(active) {
    const el = this._el('time-stop-overlay');
    el.classList.toggle('active', !!active);
    if (active) {
      this.updateTimeStop(3.5, 3.5);
      this.screenFlash('#ffffff');
    }
  }

  hideTimeStop() {
    this._el('time-stop-overlay')?.classList.remove('active');
  }

  showSpectate() {
    this._el('spectate-bar').classList.remove('hidden');
    this._el('spectate-bar').querySelector('small').textContent = '观战中 · 等待战斗结束';
  }

  hideSpectate() { this._el('spectate-bar')?.classList.add('hidden'); }

  setSpectateName(name) {
    const el = this._el('spectate-name');
    if (el) el.textContent = name || '—';
  }

  setScoreboardVisible(show) {
    if (show) {
      this._createScoreboard();
      this._el('scoreboard-overlay').classList.remove('hidden');
      this._fillScoreboard();
    } else {
      this._el('scoreboard-overlay').classList.add('hidden');
    }
  }

  toggleScoreboard(force) {
    this.scoreboardVisible = force === undefined ? !this.scoreboardVisible : !!force;
    this.setScoreboardVisible(this.scoreboardVisible);
  }

  _createScoreboard() {
    if (this._el('scoreboard-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'scoreboard-overlay';
    overlay.className = 'scoreboard-overlay hidden';
    overlay.innerHTML = `
      <div class="sb-panel">
        <div class="sb-panel-head"><b>咒力战况</b><span>LIVE SCOREBOARD / TAB</span></div>
        <div class="sb-full-row head"><span>#</span><span></span><span>术师</span><span class="col-hide">定位</span><span class="col-hide">击破</span><span class="col-hide">破坏</span><span class="sc">积分</span></div>
        <div id="sb-full-list"></div>
      </div>`;
    document.body.appendChild(overlay);
  }

  _fillScoreboard() {
    if (!this.game) return;
    const list = this._el('sb-full-list');
    if (!list) return;
    list.innerHTML = '';
    this.game.getStandings().forEach(({ f, rank }) => {
      const row = document.createElement('div');
      row.className = `sb-full-row${f === this.game.localFighter ? ' me' : ''}`;
      row.innerHTML = `
        <span class="rank">${String(rank).padStart(2, '0')}</span>
        <span class="dot" style="--c:${f.playerColor}"></span>
        <span class="nm">${escapeText(f.name)}<small>${f.def.roman}</small></span>
        <span class="col-hide">${f.def.role}</span>
        <span class="col-hide"><em>${f.kills}</em></span>
        <span class="col-hide"><em>${f.destruction}</em></span>
        <span class="sc">${Math.round(f.score)}</span>`;
      list.appendChild(row);
    });
  }

  updateScoreboard(game) {
    if (!game) return;
    const mini = this._el('scoreboard-mini');
    if (mini) {
      mini.innerHTML = '';
      const standings = game.getStandings().slice(0, 4);
      for (const { f } of standings) {
        const row = document.createElement('div');
        row.className = `sb-row${f === game.localFighter ? ' me' : ''}`;
        row.style.setProperty('--c', f.playerColor);
        row.innerHTML = `<i></i><b>${escapeText(f.name)}</b><em>${Math.round(f.score)}</em>`;
        mini.appendChild(row);
      }
    }
    if (this.scoreboardVisible) this._fillScoreboard();
  }

  _drawMinimap(game) {
    const canvas = this._el('minimap');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(5,5,10,.8)';
    ctx.fillRect(0, 0, w, h);
    const toMap = (x, z) => [((x + 23) / 46) * w, ((z + 23) / 46) * h];
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo((i / 6) * w, 0); ctx.lineTo((i / 6) * w, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i / 6) * h); ctx.lineTo(w, (i / 6) * h); ctx.stroke();
    }
    // rooftop rectangle
    const [x0, y0] = toMap(-22, -22);
    const [x1, y1] = toMap(22, 22);
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // breakables
    for (const b of game.arena.breakables) {
      if (b.broken) continue;
      const [bx, by] = toMap(b.center.x, b.center.z);
      ctx.fillStyle = b.type === 'glass' ? 'rgba(90,242,255,.55)' : b.type === 'car' ? 'rgba(255,207,92,.55)' : 'rgba(180,170,200,.4)';
      ctx.fillRect(bx - 2, by - 2, 4, 4);
    }
    // fighters
    for (const f of game.fighters) {
      if (!f.alive) continue;
      const [fx, fy] = toMap(f.pos.x, f.pos.z);
      const isLocal = f === game.localFighter;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(-f.yaw + Math.PI);
      ctx.fillStyle = f.playerColor;
      ctx.shadowColor = f.playerColor;
      ctx.shadowBlur = isLocal ? 9 : 4;
      ctx.beginPath();
      if (isLocal) {
        ctx.moveTo(0, -7); ctx.lineTo(5.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5.5, 5);
      } else {
        ctx.moveTo(0, -4.5); ctx.lineTo(4.5, 4.5); ctx.lineTo(-4.5, 4.5);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // 边缘危险
    ctx.strokeStyle = 'rgba(255,46,99,.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.font = '8px monospace';
    ctx.fillText('SHIBUYA / ROOFTOP', 6, h - 6);
  }

  pulseSkill(slot) {
    const se = this.skillEls[slot];
    if (!se?.root) return;
    se.root.animate?.(
      [{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }],
      { duration: 260, easing: 'ease-out' }
    );
  }

  /* ================================================================ pause etc */
  showPause(on) {
    if (on) {
      this._settingsOnly = false;
      const card = document.querySelector('.pause-card');
      card?.classList.remove('settings-only');
      const h2 = card?.querySelector('h2');
      if (h2) h2.innerHTML = '暂停 <small>PAUSED</small>';
      this._el('pause-menu').classList.remove('hidden');
      this._el('pointer-hint')?.classList.add('hidden');
    } else {
      this._el('pause-menu').classList.add('hidden');
    }
  }

  hidePause() { this._el('pause-menu')?.classList.add('hidden'); }

  openSettingsMenu() {
    if (this.game?.state === 'playing' && !this.game.paused) this.game.pause(true);
    const card = document.querySelector('.pause-card');
    card?.classList.add('settings-only');
    const h2 = card?.querySelector('h2');
    if (h2) h2.innerHTML = '设置 <small>SETTINGS</small>';
    this._settingsOnly = true;
    this._el('pause-menu').classList.remove('hidden');
  }

  openHelp() {
    if (this.game?.state === 'playing' && !this.game.paused) this.game.pause(true);
    this._el('help-modal').classList.remove('hidden');
  }

  closeHelp() { this._el('help-modal')?.classList.add('hidden'); }

  showGameOver(data) {
    const modal = this._el('gameover');
    const kicker = this._el('go-kicker');
    const title = this._el('go-title');
    const sub = this._el('go-sub');
    const stats = this._el('go-stats');
    const local = data.local;
    kicker.textContent = data.network ? 'P2P MATCH COMPLETE' : 'MATCH COMPLETE';
    const win = data.isWinner;
    title.innerHTML = win ? '胜利 <small>VICTORY</small>' : `${escapeText(data.winner?.name || '平局')} 获胜 <small>DEFEAT</small>`;
    sub.textContent = win ? '涩谷的废墟上，只留下你的名字。' : data.winner ? `${data.winner.name} 的领域覆盖了整座天台。` : '无人能够离开这片领域。';
    const modeTime = data.mode?.id === 'frenzy' ? formatTime(data.matchTime || 0) : formatTime(data.matchTime || 0);
    stats.innerHTML = `
      <div class="go-stat"><b>${local?.kills || 0}</b><span>击破 KILLS</span></div>
      <div class="go-stat"><b>${Math.round(local?.damageDealt || 0)}</b><span>总伤害 DAMAGE</span></div>
      <div class="go-stat"><b>${local?.destruction || 0}</b><span>场景破坏 DESTROYED</span></div>
      <div class="go-stat"><b>${Math.round(local?.score || 0)}</b><span>积分 SCORE</span></div>`;
    // standings
    let standingEl = modal.querySelector('.go-standings');
    if (!standingEl) {
      standingEl = document.createElement('div');
      standingEl.className = 'go-standings';
      stats.after(standingEl);
    }
    standingEl.innerHTML = '';
    (data.standings || []).forEach(({ f, rank }) => {
      const row = document.createElement('div');
      row.className = `go-srow${f === local ? ' me' : ''}`;
      row.innerHTML = `<b>${rank}</b><span>${escapeText(f.name)}</span><em>${Math.round(f.score)}</em><small>${f.kills}K / ${f.destruction}D</small>`;
      standingEl.appendChild(row);
    });
    this._el('gameover').classList.remove('hidden');
    this._el('pointer-hint')?.classList.add('hidden');
    this.soundWin?.(win);
  }

  soundWin(win) { /* 声音由 Game 处理 */ }

  hideGameOver() { this._el('gameover')?.classList.add('hidden'); }

  /* ================================================================ settings */
  _bindSettings() {
    const sens = this._el('set-sens');
    const vol = this._el('set-volume');
    const bloom = this._el('set-bloom');
    const quality = this._el('set-quality');
    sens.value = this.config.sens;
    vol.value = this.config.volume;
    bloom.value = this.config.bloom;
    quality.value = this.config.quality;
    this._updateSettingOutputs();
    const onChange = () => {
      this.config.sens = parseFloat(sens.value);
      this.config.volume = parseInt(vol.value, 10);
      this.config.bloom = parseInt(bloom.value, 10);
      this.config.quality = quality.value;
      this._updateSettingOutputs();
      this.applySettings();
      this._saveJSON(STORAGE_SETTINGS, this.config);
    };
    [sens, vol, bloom, quality].forEach((el) => el.addEventListener('input', onChange));
    this._el('btn-resume').addEventListener('click', () => {
      this.game?.pause(false);
      if (!this.isTouch) this.game?.input?.requestLock?.();
    });
    this._el('btn-open-hud-editor').addEventListener('click', () => {
      this._el('pause-menu').classList.add('hidden');
      this.game?.openHudEditor();
    });
    this._el('btn-pause-help').addEventListener('click', () => this.openHelp());
    this._el('btn-quit').addEventListener('click', () => { this.game?.quitToMenu(); this.hidePause(); });
    this._el('btn-pause-close').addEventListener('click', () => {
      if (this._settingsOnly) {
        this.hidePause();
        if (this.game?.state === 'playing' && this.game.paused) this.game.pause(false);
      } else {
        this.game?.pause(false);
      }
      if (!this.isTouch && this.game?.state === 'playing') this.game?.input?.requestLock?.();
    });
    this._el('btn-sound').addEventListener('click', () => {
      const muted = this.game?.audio?.toggleMute?.();
      this._el('btn-sound').textContent = muted ? '✕' : '♪';
      this._el('btn-sound').classList.toggle('muted', !!muted);
    });
  }

  _updateSettingOutputs() {
    this._el('out-sens').textContent = Number(this.config.sens).toFixed(1);
    this._el('out-volume').textContent = `${this.config.volume}%`;
    this._el('out-bloom').textContent = `${this.config.bloom}%`;
  }

  applySettings() {
    if (this.game) {
      this.game.sensitivity = this.config.sens;
      this.game.audio?.setVolume?.(this.config.volume / 100);
      if (this.config.quality && this.game.quality !== this.config.quality) {
        this.game._setQuality?.(this.config.quality);
      }
      this.game.postFX?.setBloomStrength?.((this.config.bloom / 100) * 0.9);
    } else {
      this.game?.audio?.setVolume?.(this.config.volume / 100);
    }
  }

  /* ================================================================ HUD buttons */
  _bindHUD() {
    this._el('btn-pause').addEventListener('click', () => this.game?.pause(true));
    this._el('btn-cam').addEventListener('click', () => this.game?.handleAction('camera'));
    this._el('btn-hud-edit').addEventListener('click', () => {
      if (this.game?.state !== 'playing') return;
      this.game.openHudEditor();
    });
    this._el('btn-rematch').addEventListener('click', () => this.game?.rematch());
    this._el('btn-back-menu').addEventListener('click', () => this.game?.quitToMenu());
    // 移动端动作键
    document.querySelectorAll('.act-btn').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (document.body.classList.contains('hud-editing')) return;
        if (!this.game) return;
        this.game.handleAction(btn.dataset.action);
        btn.classList.add('pressed');
        setTimeout(() => btn.classList.remove('pressed'), 100);
      });
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    });
    // 帮助遮罩关闭
    this._el('btn-help-close').addEventListener('click', () => this.closeHelp());
    this._el('help-modal').querySelector('.modal-backdrop')?.addEventListener('click', () => this.closeHelp());
  }

  /* ================================================================ HUD editor */
  _bindHudEditor() {
    this._el('he-save').addEventListener('click', () => this.game?.closeHudEditor());
    this._el('he-reset').addEventListener('click', () => {
      this.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
      this._saveJSON(STORAGE_HUD, this.layout);
      this.applyLayout();
      this._selectControl(this.selectedControl || 'attack');
    });
    const size = this._el('he-size');
    const opacity = this._el('he-opacity');
    size.addEventListener('input', () => {
      if (!this.selectedControl) return;
      this.layout[this.selectedControl].size = parseInt(size.value, 10);
      this._el('he-size-out').textContent = `${size.value}%`;
      this.applyLayout();
      this._saveJSON(STORAGE_HUD, this.layout);
    });
    opacity.addEventListener('input', () => {
      if (!this.selectedControl) return;
      this.layout[this.selectedControl].opacity = parseInt(opacity.value, 10);
      this._el('he-opacity-out').textContent = `${opacity.value}%`;
      this.applyLayout();
      this._saveJSON(STORAGE_HUD, this.layout);
    });
    // drag handlers for buttons
    for (const [key, el] of Object.entries(this.actionEls)) {
      this._bindDrag(el, key);
    }
    const joy = this._el('joystick');
    if (joy) this._bindDrag(joy, 'joystick');
  }

  _bindDrag(el, key) {
    el.addEventListener('pointerdown', (e) => {
      if (!document.body.classList.contains('hud-editing')) return;
      e.preventDefault();
      e.stopPropagation();
      this._selectControl(key);
      const rect = el.getBoundingClientRect();
      const offsetX = rect.left + rect.width / 2 - e.clientX;
      const offsetY = rect.top + rect.height / 2 - e.clientY;
      el.setPointerCapture?.(e.pointerId);
      const move = (ev) => {
        const x = clamp(((ev.clientX + offsetX) / window.innerWidth) * 100, 4, 96);
        const y = clamp(((ev.clientY + offsetY) / window.innerHeight) * 100, 4, 96);
        this.layout[key].x = Math.round(x * 10) / 10;
        this.layout[key].y = Math.round(y * 10) / 10;
        this._applyControl(key);
      };
      const up = () => {
        el.releasePointerCapture?.(e.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        this._saveJSON(STORAGE_HUD, this.layout);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  _selectControl(key) {
    this.selectedControl = key;
    document.querySelectorAll('.act-btn, .joystick').forEach((el) => el.classList.remove('selected'));
    const el = key === 'joystick' ? this._el('joystick') : this.actionEls[key];
    el?.classList.add('selected');
    this._el('he-selected-name').textContent = key === 'joystick' ? '移动摇杆' : CONTROL_NAMES[key] || key;
    const data = this.layout[key];
    this._el('he-size').value = data.size;
    this._el('he-opacity').value = data.opacity;
    this._el('he-size-out').textContent = `${data.size}%`;
    this._el('he-opacity-out').textContent = `${data.opacity}%`;
  }

  applyLayout() {
    for (const key of ['attack', 'jump', 'dodge', 'q', 'e', 'r', 'camera']) {
      this._applyControl(key);
    }
    this._applyJoystick();
  }

  _applyControl(key) {
    const btn = this.actionEls?.[key] || document.querySelector(`.act-btn[data-action="${key}"]`);
    if (!btn) return;
    const d = this.layout[key];
    if (!d) return;
    btn.style.setProperty('--x', `${d.x}%`);
    btn.style.setProperty('--y', `${d.y}%`);
    btn.style.setProperty('--opacity', (d.opacity / 100).toFixed(2));
    const base = key === 'attack' ? 82 : key === 'r' ? 66 : key === 'camera' ? 40 : 55;
    btn.style.setProperty('--size', `${base * (d.size / 100)}px`);
  }

  _applyJoystick() {
    const joy = this._el('joystick');
    if (!joy) return;
    const d = this.layout.joystick;
    joy.style.left = `${d.x}%`;
    joy.style.top = `${d.y}%`;
    joy.style.bottom = 'auto';
    joy.style.transform = 'translate(-50%, -50%)';
    joy.style.setProperty('--size', `${128 * (d.size / 100)}px`);
    joy.style.setProperty('--opacity', (d.opacity / 100).toFixed(2));
  }

  restoreJoystick() {
    const joy = this._el('joystick');
    if (!joy) return;
    this._applyJoystick();
    this._el('joystick-knob').style.transform = 'translate(0,0)';
  }

  openHudEditor() {
    this._el('hud-editor').classList.remove('hidden');
    document.body.classList.add('hud-editing');
    this._el('hud').classList.remove('hidden');
    this.hidePause();
    this.applyLayout();
    this._selectControl(this.selectedControl || 'attack');
  }

  closeHudEditor() {
    this._el('hud-editor').classList.add('hidden');
    document.body.classList.remove('hud-editing');
    this._saveJSON(STORAGE_HUD, this.layout);
  }

  /* ================================================================ network */
  _bindNet() {
    const nameInput = this._el('net-name');
    const roomInput = this._el('net-room');
    try { nameInput.value = localStorage.getItem(STORAGE_NAME) || ''; } catch (e) { /* noop */ }
    const query = new URLSearchParams(location.search);
    if (query.get('room')) {
      const inviteRoom = query.get('room').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      roomInput.value = inviteRoom;
      this.pendingRoom = inviteRoom;
    }
    this._el('btn-host').addEventListener('click', () => this._netHost());
    this._el('btn-join').addEventListener('click', () => this._netJoin());
    this._el('btn-net-close').addEventListener('click', () => this.hideNet(true));
    this._el('btn-copy-code').addEventListener('click', () => {
      const code = this._el('lobby-code').textContent;
      const origin = `${location.origin}${location.pathname}`;
      const invite = `${origin}?room=${encodeURIComponent(code)}`;
      const text = `【咒域·涩谷】房间码 ${code}\n${invite}`;
      navigator.clipboard?.writeText(text).then(() => this.toast('邀请链接已复制，发给队友即可加入')).catch(() => this.toast(`房间码：${code}`));
    });
    this._el('btn-net-start').addEventListener('click', () => {
      this.network?.startGame?.();
    });
    this._el('net-modal').querySelector('.modal-backdrop')?.addEventListener('click', () => this.hideNet(true));
  }

  _sanitizeName() {
    const input = this._el('net-name');
    let name = (input.value || '').trim().slice(0, 12);
    if (!name) name = '匿名术师';
    input.value = name;
    try { localStorage.setItem(STORAGE_NAME, name); } catch (e) { /* noop */ }
    return name;
  }

  _netHost() {
    if (!this.network) { this.setNetStatus('联机模块尚未初始化', 'err'); return; }
    const name = this._sanitizeName();
    let code = (this._el('net-room').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!code) {
      code = makeId('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      while (code.length < 5) code += 'X';
      this._el('net-room').value = code;
    }
    this._netIsHost = true;
    this.setNetStatus('正在创建 P2P 房间…', 'connecting');
    this.network.host(code, name, this.getSelection());
    history.replaceState?.(null, '', `?room=${code}`);
  }

  _netJoin() {
    if (!this.network) { this.setNetStatus('联机模块尚未初始化', 'err'); return; }
    const name = this._sanitizeName();
    const code = (this._el('net-room').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (code.length < 4) { this.setNetStatus('请输入 4-6 位房间码', 'err'); return; }
    this._netIsHost = false;
    this.setNetStatus('正在连接房主…', 'connecting');
    this.network.join(code, name, this.getSelection());
    history.replaceState?.(null, '', `?room=${code}`);
  }

  openNet() {
    if (this.game?.state === 'playing') return;
    this._el('net-modal').classList.remove('hidden');
    this.setNetStatus('房主为权威主机，最多 4 名术师。使用免服务器的 PeerJS 直连。', '');
    this.hideLobby();
  }

  hideNet(leave = false) {
    this._el('net-modal')?.classList.add('hidden');
    this.hideLobby();
    if (leave) this.network?.leave?.();
  }

  setNetStatus(text, type = '') {
    const el = this._el('net-status');
    if (!el) return;
    el.textContent = text;
    el.className = `net-status ${type || ''}`;
  }

  showLobby({ code, isHost, players, hostId }) {
    this._netRoom = code;
    this._netIsHost = !!isHost;
    this._el('net-lobby').classList.remove('hidden');
    this._el('lobby-code').textContent = code;
    const list = this._el('lobby-list');
    list.innerHTML = '';
    for (const p of players || []) {
      const row = document.createElement('div');
      row.className = `lobby-player${p.netId === hostId ? ' host' : ''}`;
      const dot = document.createElement('i');
      dot.style.setProperty('--c', p.color || '#fff');
      const b = document.createElement('b'); b.textContent = p.name || '术师';
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = p.netId === hostId ? 'HOST' : 'P2P';
      const char = document.createElement('span'); char.className = 'char'; char.textContent = CHARACTER_MAP[p.charId]?.name || '';
      row.append(dot, b, tag, char);
      list.appendChild(row);
    }
    while (list.children.length < 4) {
      const row = document.createElement('div');
      row.className = 'lobby-player';
      row.style.opacity = '.35';
      const dot = document.createElement('i'); dot.style.setProperty('--c', '#555');
      const b = document.createElement('b'); b.textContent = '等待术师…';
      row.append(dot, b);
      list.appendChild(row);
    }
    this._el('btn-net-start').style.display = isHost ? '' : 'none';
    this._el('btn-net-start').disabled = false;
    this._el('lobby-hint').textContent = isHost
      ? (players?.length > 1 ? '全员就绪，可以开始。' : '可单机带 AI 开局，或等待队友。')
      : '等待房主开始战斗…';
    this.setNetStatus(isHost ? '房间已创建。将房间码发给队友。' : '已连接房主，等待开始。', 'ok');
  }

  hideLobby() {
    this._el('net-lobby')?.classList.add('hidden');
  }

  onNetworkClosed(reason = '') {
    this.hideLobby();
    this.setNetStatus(reason || '联机已断开', 'err');
  }

  /* ================================================================ boot */
  bootProgress(pct, text) {
    const bar = this._el('boot-bar');
    if (bar) bar.style.width = `${clamp(pct, 0, 100)}%`;
    if (text) this._el('boot-status').textContent = text;
  }

  hideBoot() {
    const boot = this._el('boot');
    if (!boot) return;
    boot.style.opacity = '0';
    boot.style.visibility = 'hidden';
    setTimeout(() => boot.remove(), 550);
    this._el('menu').classList.remove('hidden');
    this.preview?.setActive(true);
    if (this.pendingRoom) {
      setTimeout(() => this.openNet(), 420);
    }
  }

  showFatal(message) {
    const boot = this._el('boot');
    if (boot) {
      boot.innerHTML = `<div class="boot-mark">!</div><div class="boot-title">无法启动</div><div class="boot-sub" style="letter-spacing:.08em;line-height:1.8;text-align:center;max-width:70vw">${escapeText(message)}</div>`;
    }
  }
}
