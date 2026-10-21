import Peer from 'peerjs';
import { PLAYER_COLORS } from '../data/characters.js';

const PREFIX = 'shibuya-anomaly-v1-';

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
    this._helloTimeout = null;
  }

  setGame(game) { this.game = game; }

  _peerOptions() {
    return {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    };
  }

  _peerId(code) {
    return PREFIX + String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  host(code, name, selection) {
    this.leave();
    this.isHost = true;
    this.roomCode = code;
    this.hostId = 'host';
    this.localNetId = 'host';
    this.started = false;
    this.players = [{
      netId: 'host', name, charId: selection.charId, host: true, color: PLAYER_COLORS[0],
    }];
    this.ui.setNetStatus('正在连接 PeerJS 信令服务器…', 'connecting');
    try {
      this.peer = new Peer(this._peerId(code), this._peerOptions());
    } catch (e) {
      this.ui.setNetStatus(`无法创建 P2P 节点：${e.message}`, 'err');
      return;
    }
    this.peer.on('open', () => {
      this.active = true;
      this.ui.setNetStatus('房间已创建，正在等待队友…', 'ok');
      this.ui.showLobby({
        code, isHost: true, players: this.players, hostId: 'host',
      });
      this.ui.setNetStatus('房间已创建。将房间码发给队友。', 'ok');
    });
    this.peer.on('connection', (conn) => this._onHostConnection(conn));
    this.peer.on('error', (err) => this._onError(err));
    this.peer.on('disconnected', () => {
      if (!this.active) return;
      try { this.peer.reconnect(); } catch (e) { /* noop */ }
    });
  }

  join(code, name, selection) {
    this.leave();
    this.isHost = false;
    this.roomCode = code;
    this.started = false;
    this.localNetId = null;
    this.ui.setNetStatus('正在连接 PeerJS 信令服务器…', 'connecting');
    try {
      this.peer = new Peer(this._peerOptions());
    } catch (e) {
      this.ui.setNetStatus(`无法创建 P2P 节点：${e.message}`, 'err');
      return;
    }
    this.peer.on('open', () => {
      this.ui.setNetStatus('正在寻找房主…', 'connecting');
      const conn = this.peer.connect(this._peerId(code), {
        reliable: true,
        metadata: { name, charId: selection.charId },
      });
      this.hostConn = conn;
      this._helloTimeout = setTimeout(() => {
        if (!conn.open) {
          this.ui.setNetStatus('连接超时。请检查房间码与网络，或让房主使用移动网络热点。', 'err');
          this.leave();
        }
      }, 12000);
      conn.on('open', () => {
        clearTimeout(this._helloTimeout);
        conn.send({ type: 'hello', name, charId: selection.charId });
        this.ui.setNetStatus('已连接房主，等待握手…', 'connecting');
      });
      conn.on('data', (data) => this._onClientData(data));
      conn.on('close', () => {
        this.ui.onNetworkClosed('与房主的连接已断开');
        this.active = false;
        if (this.game?.state === 'playing') {
          this.ui.toast('房主已断开，返回大厅');
          this.game.quitToMenu();
        }
      });
      conn.on('error', (err) => this._onError(err));
    });
    this.peer.on('error', (err) => this._onError(err));
  }

  _onHostConnection(conn) {
    if (this.started) {
      conn.on('open', () => {
        try { conn.send({ type: 'reject', reason: '战斗已开始' }); } catch (e) { /* noop */ }
        setTimeout(() => conn.close(), 300);
      });
      return;
    }
    if (this.players.length >= 4) {
      conn.on('open', () => {
        try { conn.send({ type: 'reject', reason: '房间已满' }); } catch (e) { /* noop */ }
        setTimeout(() => conn.close(), 300);
      });
      return;
    }
    conn.on('open', () => {
      this.ui.setNetStatus('有术师正在接入…', 'connecting');
    });
    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'hello') {
        if (this.started || this.players.length >= 4) {
          try { conn.send({ type: 'reject', reason: '无法加入' }); } catch (e) { /* noop */ }
          conn.close();
          return;
        }
        const netId = `guest-${++this._seq}`;
        conn.netId = netId;
        const player = {
          netId,
          name: String(data.name || '匿名术师').slice(0, 12),
          charId: ['zhoutong', 'guojunxi', 'hezeyou', 'wangchen'].includes(data.charId) ? data.charId : 'zhoutong',
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
        this.game?.setRemoteInput(conn.netId, data.input);
      } else if (data.type === 'action') {
        this.game?.remoteAction(conn.netId, data.action, data.aim || {});
      } else if (data.type === 'char') {
        const p = this.players.find((x) => x.netId === conn.netId);
        if (p && !this.started) {
          p.charId = data.charId;
          this._broadcastLobby();
        }
      } else if (data.type === 'bye') {
        this._dropConnection(conn.netId);
      }
    });
    conn.on('close', () => this._dropConnection(conn.netId));
    conn.on('error', () => this._dropConnection(conn.netId));
  }

  _dropConnection(netId) {
    if (!netId) return;
    const conn = this.connections.get(netId);
    if (!conn) return;
    this.connections.delete(netId);
    const idx = this.players.findIndex((p) => p.netId === netId);
    const player = idx >= 0 ? this.players[idx] : null;
    if (idx >= 0) this.players.splice(idx, 1);
    this.game?.setRemoteInput(netId, null);
    if (this.started) {
      this.game?.handlePlayerDisconnect?.(netId);
      this.ui.toast(`${player?.name || '一名术师'} 离开了战斗`);
    }
    if (!this.started) this._broadcastLobby();
  }

  _onClientData(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'reject') {
      this.ui.setNetStatus(`无法加入：${data.reason || '房间不可用'}`, 'err');
      this.leave(false);
    } else if (data.type === 'welcome') {
      this.active = true;
      this.localNetId = data.netId;
      this.hostId = data.hostId || 'host';
      this.roomCode = data.room || this.roomCode;
      this.players = data.players || [];
      this.ui.showLobby({
        code: this.roomCode, isHost: false, players: this.players, hostId: this.hostId,
      });
      this.ui.setNetStatus('已连接到房主。等待房主开始战斗。', 'ok');
    } else if (data.type === 'lobby') {
      this.players = data.players || this.players;
      this.ui.showLobby({
        code: data.room || this.roomCode, isHost: false, players: this.players, hostId: this.hostId,
      });
    } else if (data.type === 'start') {
      this.started = true;
      this.active = true;
      clearTimeout(this._helloTimeout);
      this.players = data.payload?.players || this.players;
      this.ui.hideNet(false);
      this.game?.startClientMatch({ ...data.payload, localNetId: this.localNetId });
      this.audio?.init?.();
    } else if (data.type === 'snap') {
      if (this.started) this.game?.applyNetworkSnapshot(data.snap);
    } else if (data.type === 'event') {
      if (this.started) this.game?.handleNetworkEvent(data.event);
    } else if (data.type === 'hostbye') {
      this.ui.onNetworkClosed('房主已离开房间');
      if (this.game?.state === 'playing') this.game.quitToMenu();
      this.active = false;
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
    if (!this.active) return;
    if (this.isHost) {
      const p = this.players.find((x) => x.netId === 'host');
      if (p && !this.started) { p.charId = charId; this._broadcastLobby(); }
    } else if (this.hostConn?.open) {
      try { this.hostConn.send({ type: 'char', charId }); } catch (e) { /* noop */ }
    }
  }

  startGame() {
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
      name: p.name,
      charId: p.charId,
      defId: p.charId,
      local: p.netId === this.localNetId,
      isBot: false,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    }));
    this.started = true;
    this.ui.hideNet(false);
    this.game.input?.requestLock?.();
    this.game.startHostedMatch(entries, this.ui.selectedMode);
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

  sendSnapshot(snapshot) {
    if (!this.isHost || !this.connections.size) return;
    const msg = { type: 'snap', snap: snapshot };
    for (const conn of this.connections.values()) {
      if (!conn.open) continue;
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
      if (!conn.open) continue;
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
    clearTimeout(this._helloTimeout);
    try {
      if (notify && this.hostConn?.open) this.hostConn.send({ type: 'bye' });
      if (this.isHost) {
        for (const conn of this.connections.values()) {
          try { if (conn.open && this.started) conn.send({ type: 'hostbye' }); } catch (e) { /* noop */ }
          try { conn.close(); } catch (e) { /* noop */ }
        }
      }
      this.hostConn?.close?.();
    } catch (e) { /* noop */ }
    try { this.peer?.destroy?.(); } catch (e) { /* noop */ }
    this.peer = null;
    this.hostConn = null;
    this.connections.clear();
    this.players = [];
    this.started = false;
    this.active = false;
    this.localNetId = null;
    this.isHost = false;
    this._seq = 0;
  }

  disconnect() {
    this.leave();
  }
}
