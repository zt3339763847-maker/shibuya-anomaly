# 咒域·涩谷 / SHIBUYA ANOMALY

一款**纯前端、免付费服务**的 3D 二次元异能乱斗游戏。
使用 Three.js 做卡通渲染与后处理，Rapier3D 负责刚体物理与场景破坏，PeerJS 提供无后端 P2P 联机。

> 所有角色、城市、特效、音效均由代码程序化生成，项目不依赖任何商业素材或付费云服务。

## 🌐 在线游玩（已上线）

**游戏地址：<https://zt3339763847-maker.github.io/shibuya-anomaly/>**

- 打开即可游玩，无需安装。
- 联机：点击「联机房间」→ 创建房间（自动生成 6 位房间码）→ 把房间码或「复制邀请」得到的链接发给队友。
- 好友打开邀请链接会自动填写房间码并打开联机面板。
- 支持 **全屏**：菜单右上角 / 战斗 HUD 的全屏按钮，或按 `F`；手机会同时尝试锁定横屏。
- GitHub 仓库：<https://github.com/zt3339763847-maker/shibuya-anomaly>
- 部署由 GitHub Actions → GitHub Pages 自动完成，免费、无需后端。

![menu](docs/screenshot-menu.png)

![gameplay](docs/screenshot-game.jpg)

| 绝对领域·时停 | 移动端 HUD |
| --- | --- |
| ![time stop](docs/screenshot-timestop.jpg) | ![mobile](docs/screenshot-mobile.jpg) |

## 快速开始

```bash
npm install
npm run dev
```

打开终端输出的地址（默认 `http://localhost:5173`）。

生产构建：

```bash
npm run build
npm run preview
```

`dist/` 是完整静态站点，可直接拖到任意静态托管。

## 直接部署

### GitHub Pages

当前仓库已经配置 `main` 分支自动部署，线上地址：

<https://zt3339763847-maker.github.io/shibuya-anomaly/>

每次 push 到 `main`，GitHub Actions 会自动 `npm ci`、构建并发布 `dist/`。工作流见 `.github/workflows/pages.yml`。

项目已将 `vite.config.js` 的 `base` 设为 `'./'`，放在仓库子路径也能正常加载。

### Vercel / Netlify / Cloudflare Pages

- Build Command: `npm run build`
- Output Directory: `dist`
- 无需环境变量、无需服务端函数。

## 操作

### PC

| 输入 | 动作 |
| --- | --- |
| `W A S D` | 移动 |
| 鼠标 | 视角 / 瞄准（开始战斗后自动锁定指针） |
| 鼠标左键 | 普攻，连按组成三段/四段连击 |
| 鼠标右键拖动 | 指针锁定被浏览器拒绝时的备用视角 |
| `Q` / `E` / `R` | 技能一 / 技能二 / 终极技能 |
| `Space` | 跳跃 |
| `Shift` | 闪避（短暂无敌） |
| `V` | 第一人称 / 第三人称越肩视角切换 |
| `Tab` | 积分榜 |
| `F` | 全屏 / 退出全屏 |
| `Esc` / `P` | 暂停（`P` 在鼠标锁定状态下也可用） |

> 指针锁定失败时，画面中央会出现「点击锁定 / 右键拖动」提示；单人模式按 `Esc` 退出锁定会自动暂停。

### 手机 / 平板

- 屏幕左半区按下并拖动：浮空虚拟摇杆。
- 屏幕右半区滑动：转动视角。
- 右侧虚拟按键：普攻、技能、跳跃、闪避、视角；顶部可暂停或全屏。
- 暂停菜单 → **自定义 HUD**：拖拽所有按键与摇杆，调整大小和透明度，自动保存到 `localStorage`。

## 玩法

### 模式

- **生存淘汰**：每人 3 条命，最后存活的术师获胜。掉下天台会损失一条命。
- **狂暴积分**：5 分钟无限复活，击杀、伤害和场景破坏都计分，时间结束按积分排名。
- **训练场**：自由练招，无限生命。

### 战斗系统

- 物理角色控制器 + 胶囊碰撞，可站在屋顶、被击飞撞上水泥柱/玻璃/汽车。
- 高速撞墙触发 **Wall-Splat**，追加伤害并造成眩晕。
- 柱子、玻璃幕墙、汽车、木箱均可被技能和普攻破坏，碎裂为 Rapier 动态刚体。
- 天台边缘没有完整护栏，可被击落；坠入涩谷街道即死/损失生命。
- 每名角色拥有独特普攻、被动、两个主动技能和一个超长 CD 大招。

### 四名术师

| 术师 | 定位 | 核心 |
| --- | --- | --- |
| 周同 | 破坏 / 控场 | 重力锚点、反重力陨石、坍缩黑洞 |
| 郭俊熙 | 机动 / 爆发 | 瞬移、因果置换、15 段空间乱打 |
| 何则佑 | 控制 / 支援 | 量子印记、隐形磁网、壁垒、命运矩阵 |
| 王琛 | 刺客 / 法则 | 时间残片、回溯、加速、全球时停 |

时停会触发全屏黑白灰阶、集中线与倒计时界面；时停期间王琛造成的伤害会在时间恢复时以动能形式再次爆发。

## 联机

- 纯 P2P，无需自建服务器；PeerJS 公共信令 + WebRTC 直连。
- **房主权威**：客户端发送输入和动作，房主负责物理、伤害和场景状态，以 16 Hz 广播快照，客户端平滑插值。
- 本地开房间（自动生成 6 位房间码）→ 分享房间码或邀请链接 → 队友加入 → 房主开始。
- 默认使用多个免费 STUN 服务器，覆盖大多数家庭/移动网络。
- 若双方处于严格 NAT、公司或校园网络，可在联机面板的「高级网络 · 可选 TURN 中继」中填入自建或免费 TURN 地址与账号；配置只保存在本机浏览器，双方可各自填写。
- 支持最多 4 名玩家，空位会用 AI 补齐。
- 服务端只负责信令，不保存账号、房间或战斗数据；房主可以看到并裁定全部战斗状态，请只与信任的队友开房。

## 技术栈

- **Three.js r186**：WebGL2 渲染、卡通阶梯着色、反向外壳描边、Bloom、自定义动漫调色 / 色散 / 时停 / 集中线后处理。
- **@dimforge/rapier3d-compat**：Kinematic Character Controller、刚体碎块、射线检测、镜头避障。
- **PeerJS**：轻量 WebRTC DataChannel 封装。
- 原生 ES Modules + Vite，无 UI 框架。
- WebAudio 程序化合成音效与氛围音乐。

## 目录结构

```
src/
  main.js                 启动流程
  style.css               全部界面与 HUD 样式
  data/characters.js      角色、技能、模式数据
  render/
    toon.js               卡通材质、gradientMap、描边
    postfx.js             Bloom + 自定义动漫后处理
  entities/
    characterModel.js     程序化二次元角色模型
    fighter.js            角色状态机、物理、连击、受击
    bot.js                AI 行为
  game/
    game.js               比赛循环、伤害、模式、网络同步
    abilities.js          四名角色的技能实现
    cameraRig.js          FPP / OTS 相机
  world/arena.js          涩谷天台、都市、可破坏物、灯光
  effects/effects.js      粒子、刀光、黑洞、传送门、矩阵、时停表现
  ui/
    ui.js                 菜单、HUD、HUD 编辑器、联机界面
    preview.js            角色展示舞台与卡面渲染
  net/p2p.js              PeerJS 房主权威联机
```

## 浏览器要求

- Chrome / Edge / Firefox / Safari 新版本。
- 必须支持 **WebGL2**（Three.js r186 的要求）。
- 联机需要 **WebRTC** 与互联网访问 PeerJS 公共信令服务；单机模式不需要联网。

## 备注

- 游戏名、角色名与技能文本均为原创演绎，与任何商业作品无关联。
- 物理与技能数值都在 `src/data/characters.js` 和 `src/game/abilities.js` 中，可直接调整。
- 若需要将 PeerJS 换成完全自托管信令，只需替换 `src/net/p2p.js` 中 `new Peer(...)` 的 `host` / `path` 配置。

