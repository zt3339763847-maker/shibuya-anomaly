import './style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import { UI } from './ui/ui.js';
import { CharacterPreview } from './ui/preview.js';
import { AudioEngine } from './core/audio.js';
import { Game } from './game/game.js';
import { P2PNetwork } from './net/p2p.js';

const boot = document.getElementById('boot');
const status = (pct, text) => {
  const bar = document.getElementById('boot-bar');
  if (bar) bar.style.width = `${pct}%`;
  const s = document.getElementById('boot-status');
  if (s && text) s.textContent = text;
};

function fail(message) {
  console.error(message);
  if (boot) {
    boot.innerHTML = `<div class="boot-mark">!</div><div class="boot-title" style="letter-spacing:.08em">无法启动</div><div class="boot-sub" style="text-align:center;max-width:72vw;letter-spacing:.06em;line-height:1.9">${String(message).replace(/[<>&]/g, '')}</div><div class="boot-status">请使用支持 WebGL2 的现代浏览器，并确认网络允许加载 WebAssembly。</div>`;
  }
}

async function main() {
  status(6, '检测 WebGL2 / WebAssembly 支持');
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  if (!gl) { fail('当前浏览器不支持 WebGL2。请升级 Chrome / Edge / Firefox / Safari。'); return; }
  await new Promise((r) => setTimeout(r, 60));

  status(18, '解密 Rapier3D 物理核心');
  await RAPIER.init();
  await new Promise((r) => setTimeout(r, 40));

  status(38, '构建涩谷天台与霓虹都市');
  const audio = new AudioEngine();
  const ui = new UI();
  const preview = new CharacterPreview(document.getElementById('preview-canvas'));
  ui.setPreview(preview);
  await new Promise((r) => setTimeout(r, 30));

  status(64, '编译卡通渲染与后处理管线');
  let game;
  try {
    game = new Game({
      canvas: document.getElementById('game-canvas'),
      ui,
      audio,
      rapier: RAPIER,
    });
  } catch (e) {
    console.error(e);
    fail(`3D 渲染初始化失败：${e?.message || e}`);
    return;
  }
  game.network = null;
  const network = new P2PNetwork(ui, audio);
  network.setGame(game);
  game.network = network;
  ui.network = network;
  ui.setGame(game);
  window.__SHIBUYA__ = { game, ui, preview, network, audio };

  status(88, '同步术师数据与 HUD');
  await new Promise((r) => setTimeout(r, 120));

  status(100, '领域展开完成');
  setTimeout(() => {
    ui.hideBoot();
    preview._resize?.();
    setTimeout(() => {
      try {
        const portraits = preview.generatePortraits();
        ui.applyPortraits(portraits);
      } catch (e) {
        console.warn('Portrait generation skipped:', e);
      }
    }, 650);
  }, 250);
}

main().catch((e) => {
  console.error(e);
  fail(e?.message || String(e));
});
