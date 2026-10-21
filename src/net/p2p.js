import Peer from 'peerjs';
import { PLAYER_COLORS } from '../data/characters.js';

const PREFIX = 'shibuya-anomaly-v1-';
const CHARACTER_IDS = new Set(['zhoutong', 'guojunxi', 'hezeyou', 'wangchen']);

function cleanPlayerName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12) || '匿名术师';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  if (Object.keys(input).length > 8) return false;
  for (const key of ['x', 'z', 'yaw', 'pitch']) {
    if (input[key] !== undefined && !isFiniteNumber(input[key])) return false;
  }
  return true;
}

function validAim(aim) {
  if (!aim || typeof aim !== 'object' || Array.isArray(aim)) return false;
  if (Object.keys(aim).length > 6) return false;
  for (const key of ['yaw', 'pitch']) {
    if (aim[key] !== undefined && !isFiniteNumber(aim[key])) return false;
  }
  return true;
}

function cleanRoster(players) {
  if (!Array.isArray(players) || players.length > 8) return [];
  return players
    .filter((p) => p && typeof p === 'object' && typeof p.netId === 'string')
    .slice(0, 4)
    .map((p) => ({
      netId: p.netId.slice(0, 40),
      name: cleanPlayerName(p.name),
      charId: CHARACTER_IDS.has(p.charId) ? p.charId : 'zhoutong',
      host: !!p.host,
      isBot: !!p.isBot,
      color: typeof p.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : '#8a8498',
    }));
}

/**
 * 纯前端 P2P 联机。
 * 房主权威：客户端只发送输入与动作，房主模拟并广播快照。
 * 信令使用 PeerJS 公共云（免费），媒体/数据直连。
 */
export class P2PNetwork {
  constructor(ui, audio) {
    this.ui = ui;
    this.audio = audio;
    this.game = null;
    this.peer = null;
    this.isHost = false;
    this.localNetId = null;
    this.hostId = null;
    this.roomCode = '';
    this.connections = new Map(); // netId -> DataConnection
    this.players = [];
    this.started = false;
    this.active = false;
    this._seq = 0;
    this._session = 0;
    this._pending = new Set();
    this._helloTimeout = null;
    this._snapRate = { _rates: {} };
    this._allowEventRate = { _rates: {} };
    this._lobbyRate = { _rates: {} };
    this._turn = null;
  }

  setGame(game) { this.game = game; }

  _peerOptions() {
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.nextcloud.com:443' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ];
    if (this._turn && Array.isArray(this._turn.urls) && this._turn.urls.length) {
      iceServers.push({
        urls: this._turn.urls,
        username: this._turn.username || '',
        credential: this._turn.credential || '',
      });
    }
    return {
      debug: 1,
      config: { iceServers },
    };
  }

  _peerId(code) {
    return PREFIX + String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  host(code, name, selection) {
    this.leave();
    const session = this._session;
    this.isHost = true;
    this.roomCode = code;
    this.hostId = 'host';
    this.localNetId = 'host';
    this.started = false;
    this.players = [{
      netId: 'host', name: cleanPlayerName(name), charId: selection.charId, host: true, color: PLAYER_COLORS[0],
    }];
    this.ui.setNetStatus('正在连接 PeerJS 信令服务器…', 'connecting');
    this._turn = this.ui.getTurnConfig?.() || null;
    try {
      this.peer = new Peer(this._peerId(code), this._peerOptions());
    } catch (e) {
      this.ui.setNetStatus(`无法创建 P2P 节点：${e.message}`, 'err');
      return;
    }
    this.peer.on('open', () => {
      if (session !== this._session) return;
      this.active = true;
      this.ui.setNetStatus('房间已创建，正在等待队友…', 'ok');
      this.ui.showLobby({
        code, isHost: true, players: this.players, hostId: 'host',
      });
      this.ui.setNetStatus('房间已创建。将房间码发给队友。', 'ok');
    });
    this.peer.on('connection', (conn) => {
      if (session !== this._session) { try { conn.close(); } catch (e) { /* noop */ } return; }
      this._onHostConnection(conn, session);
    });
    this.peer.on('error', (err) => { if (session === this._session) this._onError(err); });
    this.peer.on('disconnected', () => {
      if (session !== this._session || !this.active) return;
      try { this.peer.reconnect(); } catch (e) { /* noop */ }
    });
  }

  join(code, name, selection) {
    this.leave();
    const session = this._session;
    this.isHost = false;
    this.roomCode = code;
    this.started = false;
    this.localNetId = null;
    this._handshakeDone = false;
    this._closeHandled = false;
    this.ui.setNetStatus('正在连接 PeerJS 信令服务器…', 'connecting');
    this._turn = this.ui.getTurnConfig?.() || null;
    try {
      this.peer = new Peer(this._peerOptions());
    } catch (e) {
      this.ui.setNetStatus(`无法创建 P2P 节点：${e.message}`, 'err');
      return;
    }
    this.peer.on('open', () => {
      if (session !== this._session) return;
      this.ui.setNetStatus('正在寻找房主…', 'connecting');
      const conn = this.peer.connect(this._peerId(code), {
        reliable: true,
        metadata: { name, charId: selection.charId },
      });
      this.hostConn = conn;
      this._helloTimeout = setTimeout(() => {
        if (session !== this._session || this._handshakeDone) return;
        this.ui.setNetStatus('连接/握手超时。请检查房间码与网络，或让房主使用移动网络热点。', 'err');
        this._closeHandled = true;
        try { conn.close(); } catch (e) { /* noop */ }
        this.leave(false);
      }, 12000);
      conn.on('open', () => {
        if (session !== this._session) return;
        conn.send({ type: 'hello', name, charId: selection.charId });
        this.ui.setNetStatus('已连接房主，等待握手…', 'connecting');
      });
      conn.on('data', (data) => { if (session === this._session) this._onClientData(data, session); });
      conn.on('close', () => {
        if (session !== this._session || this._closeHandled) return;
        this._closeHandled = true;
        clearTimeout(this._helloTimeout);
        this.active = false;
        if (!this._handshakeDone) {
          this.ui.setNetStatus('与房主的连接在握手完成前断开。请检查房间码或网络后重试。', 'err');
        } else {
          this.ui.onNetworkClosed('与房主的连接已断开');
          if (this.game?.state === 'playing') {
            this.ui.toast('房主已断开，返回大厅');
            this.game.quitToMenu();
          }
        }
      });
      conn.on('error', (err) => { if (session === this._session) this._onError(err); });
    });
    this.peer.on('error', (err) => { if (session === this._session) this._onError(err); });
  }

  _onHostConnection(conn, session) {
    if (session !== this._session) return;
    if (this._pending.size >= 8) {
      conn.on('open', () => { try { conn.close(); } catch (e) { /* noop */ } });
      return;
    }
    if (this.started) {
      conn.on('open', () => {
        if (session !== this._session) return;
        try { conn.send({ type: 'reject', reason: '战斗已开始' }); } catch (e) { /* noop */ }
        setTimeout(() => conn.close(), 300);
      });
      return;
    }
    if (this.players.length >= 4) {
      conn.on('open', () => {
        if (session !== this._session) return;
        try { conn.send({ type: 'reject', reason: '房间已满' }); } catch (e) { /* noop */ }
        setTimeout(() => conn.close(), 300);
      });
      return;
    }
    this._pending.add(conn);
    const helloTimer = setTimeout(() => {
      if (session === this._session && !conn.netId) {
        try { conn.close(); } catch (e) { /* noop */ }
      }
    }, 10000);
    conn.on('open', () => {
      if (session !== this._session) return;
      this.ui.setNetStatus('有术师正在接入…', 'connecting');
    });
    conn.on('data', (data) => {
      if (session !== this._session || !conn.open) return;
      if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') return;
      if (Object.keys(data).length > 10) return;
      if (data.type === 'hello') {
        if (conn.netId) return; // 一个连接只能加入一次，防止重复占用名额
        if (typeof data.name !== 'string' || data.name.length > 64) return;
        if (this.started || this.players.length >= 4) {
          try { conn.send({ type: 'reject', reason: '无法加入' }); } catch (e) { /* noop */ }
          conn.close();
          return;
        }
        clearTimeout(helloTimer);
        this._pending.delete(conn);
        if (!conn.open) return;
        const netId = `guest-${++this._seq}`;
        conn.netId = netId;
        const player = {
          netId,
          name: cleanPlayerName(data.name),
          charId: CHARACTER_IDS.has(data.charId) ? data.charId : 'zhoutong',
          host: false,
          color: PLAYER_COLORS[(this.players.length) % PLAYER_COLORS.length],
        };
        this.connections.set(netId, conn);
        this.players.push(player);
        try {
          conn.send({ type: 'welcome', netId, hostId: 'host', room: this.roomCode, players: this.players, mode: this.ui.selectedMode });
        } catch (e) { /* noop */ }
        this._broadcastLobby();
        this.ui.setNetStatus(`${player.name} 加入了房间`, 'ok');
      } else if (data.type === 'input') {
        if (!conn.netId || !this.connections.has(conn.netId) || !this.started || !this._allowRate(conn, 'input', 70)) return;
        if (!validInput(data.input)) return;
        this.game?.setRemoteInput(conn.netId, data.input);
      } else if (data.type === 'action') {
        if (!conn.netId || !this.connections.has(conn.netId) || !this.started || !this._allowRate(conn, 'action', 20)) return;
        if (typeof data.action !== 'string' || data.action.length > 10) return;
        if (!['attack', 'jump', 'dodge', 'q', 'e', 'r'].includes(data.action)) return;
        if (!validAim(data.aim || {})) return;
        this.game?.remoteAction(conn.netId, data.action, data.aim || {});
      } else if (data.type === 'char') {
        if (!conn.netId || !this.connections.has(conn.netId) || this.started || typeof data.charId !== 'string' || !CHARACTER_IDS.has(data.charId) || !this._allowRate(conn, 'char', 5)) return;
        const p = this.players.find((x) => x.netId === conn.netId);
        if (p) {
          p.charId = data.charId;
          this._broadcastLobby();
        }
      } else if (data.type === 'bye') {
        this._dropConnection(conn.netId);
      }
    });
    conn.on('close', () => {
      clearTimeout(helloTimer);
      this._pending.delete(conn);
      if (session === this._session) this._dropConnection(conn.netId);
    });
    conn.on('error', () => {
      clearTimeout(helloTimer);
      this._pending.delete(conn);
      if (session === this._session) this._dropConnection(conn.netId);
    });
  }

  _allowRate(conn, bucket, maxPerSecond) {
    if (!conn._rates) conn._rates = {};
    const now = performance.now();
    const timestamps = conn._rates[bucket] || (conn._rates[bucket] = []);
    while (timestamps.length && timestamps[0] < now - 1000) timestamps.shift();
    if (timestamps.length >= maxPerSecond) return false;
    timestamps.push(now);
    return true;
  }

  _dropConnection(netId) {
    if (!netId) return;
    const conn = this.connections.get(netId);
    if (!conn) return;
    this.connections.delete(netId);
    try { conn.close(); } catch (e) { /* noop */ }
    conn.netId = null;
    const idx = this.players.findIndex((p) => p.netId === netId);
    const player = idx >= 0 ? this.players[idx] : null;
    if (idx >= 0) this.players.splice(idx, 1);
    this.game?.setRemoteInput(netId, null);
    if (this.started) {
      this.game?.handlePlayerDisconnect?.(netId);
      this.ui.toast(`${player?.name || '一名术师'} 离开了战斗`);
    } else {
      this._broadcastLobby();
    }
  }

  _onClientData(data, session) {
    if (session !== this._session) return;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') return;
    if (Object.keys(data).length > 10) return;
    if (data.type === 'reject') {
      this.ui.setNetStatus(`无法加入：${cleanPlayerName(data.reason || '房间不可用')}`, 'err');
      this.leave(false);
    } else if (data.type === 'welcome') {
      if (this.started || this._handshakeDone || !data.netId || typeof data.netId !== 'string') return;
      this.active = true;
      this._handshakeDone = true;
      clearTimeout(this._helloTimeout);
      this.localNetId = data.netId;
      this.hostId = typeof data.hostId === 'string' ? data.hostId : 'host';
      this.roomCode = String(data.room || this.roomCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      this.players = cleanRoster(data.players);
      this.ui.showLobby({
        code: this.roomCode, isHost: false, players: this.players, hostId: this.hostId,
      });
      this.ui.setNetStatus('已连接到房主。等待房主开始战斗。', 'ok');
    } else if (data.type === 'lobby') {
      if (this.started || !this._allowRate(this._lobbyRate, 'lobby', 10)) return;
      this.players = cleanRoster(data.players);
      this.ui.showLobby({
        code: this.roomCode, isHost: false, players: this.players, hostId: this.hostId,
      });
    } else if (data.type === 'start') {
      if (this.started || !data.payload || !Array.isArray(data.payload.players) || data.payload.players.length > 8) return;
      this.started = true;
      this.active = true;
      clearTimeout(this._helloTimeout);
      this.players = cleanRoster(data.payload.players);
      this.ui.hideNet(false);
      this.game?.startClientMatch({ ...data.payload, players: this.players, localNetId: this.localNetId });
      this.audio?.init?.();
    } else if (data.type === 'snap') {
      if (this.started && data.snap && typeof data.snap === 'object' && this._allowRate(this._snapRate, 'snap', 30)) {
        this.game?.applyNetworkSnapshot(data.snap);
      }
    } else if (data.type === 'event') {
      if (this.started && data.event && typeof data.event === 'object' && this._allowRate(this._allowEventRate, 'event', 40)) {
        this.game?.handleNetworkEvent(data.event);
      }
    } else if (data.type === 'hostbye') {
      this._closeHandled = true;
      this.active = false;
      this.ui.onNetworkClosed('房主已离开房间');
      if (this.game?.state === 'playing') this.game.quitToMenu();
      this.leave(false);
    }
  }

  _broadcastLobby() {
    const msg = {
      type: 'lobby',
      room: this.roomCode,
      hostId: 'host',
      players: this.players,
    };
    for (const conn of this.connections.values()) {
      if (conn.open) {
        try { conn.send(msg); } catch (e) { /* noop */ }
      }
    }
    this.ui.showLobby({
      code: this.roomCode, isHost: true, players: this.players, hostId: 'host',
    });
  }

  updateCharacter(charId) {
    if (!this.active || !CHARACTER_IDS.has(charId)) return;
    if (this.isHost) {
      const p = this.players.find((x) => x.netId === 'host');
      if (p && !this.started) { p.charId = charId; this._broadcastLobby(); }
    } else if (this.hostConn?.open) {
      try { this.hostConn.send({ type: 'char', charId }); } catch (e) { /* noop */ }
    }
  }

  startGame() {
    if (this.started) return;
    if (!this.isHost) {
      this.ui.setNetStatus('只有房主可以开始战斗', 'err');
      return;
    }
    if (!this.game) {
      this.ui.setNetStatus('游戏尚未初始化', 'err');
      return;
    }
    if (!this.players.length) return;
    const entries = this.players.map((p, i) => ({
      netId: p.netId,
      name: cleanPlayerName(p.name),
      charId: CHARACTER_IDS.has(p.charId) ? p.charId : 'zhoutong',
      defId: CHARACTER_IDS.has(p.charId) ? p.charId : 'zhoutong',
      local: p.netId === this.localNetId,
      isBot: false,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    }));
    this.started = true;
    try {
      this.game.startHostedMatch(entries, this.ui.selectedMode);
    } catch (e) {
      this.started = false;
      this.ui.setNetStatus(`开始战斗失败：${e.message}`, 'err');
      return;
    }
    if (this.game.state !== 'playing' || !this.game.localFighter) {
      this.started = false;
      this.ui.setNetStatus('开始战斗失败，请重试', 'err');
      return;
    }
    this.ui.hideNet(false);
    this.game.input?.requestLock?.();
  }

  /** 由 Game 在创建完所有角色（含 AI）后调用，发送统一的开始数据 */
  startMatchPayload(players, modeId) {
    if (!this.isHost) return;
    const roster = (this.game?.fighters || []).map((f) => ({
      netId: f.netId, name: f.name, defId: f.def.id, charId: f.def.id, isBot: f.isBot,
    }));
    const base = { players: roster, mode: modeId };
    for (const conn of this.connections.values()) {
      if (!conn.open) continue;
      try {
        conn.send({ type: 'start', payload: { ...base, localNetId: conn.netId } });
      } catch (e) { /* noop */ }
    }
    this.ui.hideNet(false);
  }

  sendInput(input) {
    if (this.isHost || !this.hostConn?.open || !this.started) return;
    try { this.hostConn.send({ type: 'input', input }); } catch (e) { /* noop */ }
  }

  sendAction(action, aim) {
    if (this.isHost || !this.hostConn?.open || !this.started) return;
    try { this.hostConn.send({ type: 'action', action, aim }); } catch (e) { /* noop */ }
  }

  _connCanReceive(conn) {
    const channel = conn.dataChannel || conn._dc;
    return !channel || (channel.bufferedAmount || 0) < 256 * 1024;
  }

  sendSnapshot(snapshot) {
    if (!this.isHost || !this.connections.size) return;
    const msg = { type: 'snap', snap: snapshot };
    for (const conn of this.connections.values()) {
      if (!conn.open || !this._connCanReceive(conn)) continue;
      try { conn.send(msg); } catch (e) { /* noop */ }
    }
  }

  broadcastAbility(fighter, slot) {
    if (!this.isHost || !this.connections.size) return;
    let point = [fighter.pos.x, fighter.pos.y, fighter.pos.z];
    try {
      const aim = this.game?.resolveAim?.(fighter, slot === 'r' ? 18 : 13);
      if (aim?.point) point = [aim.point.x, aim.point.y, aim.point.z];
    } catch (e) { /* noop */ }
    this.broadcastEvent({ type: 'ability', id: fighter.netId, slot, point });
  }

  broadcastEvent(event) {
    if (!this.isHost || !this.connections.size) return;
    const msg = { type: 'event', event };
    for (const conn of this.connections.values()) {
      if (!conn.open || !this._connCanReceive(conn)) continue;
      try { conn.send(msg); } catch (e) { /* noop */ }
    }
  }

  broadcastKill(targetId, sourceId) {
    this.broadcastEvent({ type: 'kill', id: targetId, source: sourceId });
  }

  broadcastBreak(id) {
    this.broadcastEvent({ type: 'break', id });
  }

  _onError(err) {
    const type = err?.type || '';
    let message = `联机错误：${err?.message || type || '未知错误'}`;
    if (type === 'unavailable-id') message = '这个房间码已被占用，请换一个。';
    else if (type === 'peer-unavailable') message = '找不到该房间。请确认房主已创建房间，且房间码正确。';
    else if (type === 'network' || type === 'server-error') message = '无法连接 PeerJS 信令服务器，请检查网络或稍后再试。';
    else if (type === 'browser-incompatible') message = '当前浏览器不支持 WebRTC。';
    this.ui.setNetStatus(message, 'err');
    if (type === 'unavailable-id' || type === 'browser-incompatible') this.leave(false);
  }

  leave(notify = true) {
    this._session++;
    clearTimeout(this._helloTimeout);
    try {
      if (notify && this.hostConn?.open) this.hostConn.send({ type: 'bye' });
      if (this.isHost) {
        for (const conn of this.connections.values()) {
          try { if (conn.open && this.started) conn.send({ type: 'hostbye' }); } catch (e) { /* noop */ }
          try { conn.close(); } catch (e) { /* noop */ }
          conn.netId = null;
        }
      }
      this.hostConn?.close?.();
    } catch (e) { /* noop */ }
    try { this.peer?.destroy?.(); } catch (e) { /* noop */ }
    this.peer = null;
    this.hostConn = null;
    this.connections.clear();
    this._pending.clear();
    this.players = [];
    this.started = false;
    this.active = false;
    this.localNetId = null;
    this.isHost = false;
    this._seq = 0;
    this._turn = null;
    this._handshakeDone = false;
    this._closeHandled = false;
  }

  disconnect() {
    this.leave();
  }
}
