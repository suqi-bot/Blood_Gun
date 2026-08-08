// game2d.js - 纯 2D 俯视角牌桌（Canvas 2D 渲染，无 WebGL）
// 牌桌中央放一把左轮：谁的回合谁点击拿起枪，拿起后才可开枪 / 使用道具
(function () {
  'use strict';

  const mount = document.getElementById('scene-2d');
  const canvas = document.getElementById('game-canvas');

  const noop = function () {};
  window.Game2D = {
    sync: noop,
    shoot: noop,
    reload: noop,
    item: noop,
    setScreen: noop,
    outcome: noop,
    onPickup: null,
    onShoot: null
  };

  if (!mount || !canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const ME = 0;
  const OPP = 1;

  // ---- 状态（由 game.js 同步）----
  const state = {
    mode: 'single',
    gameActive: false,
    currentPlayer: -1,
    myIndex: 0,
    health: [2, 2],
    powerActive: [false, false],
    canPickup: false,
    canAct: false,
    prevPlayer: -1,
    gameScreenActive: false
  };

  // ---- 枪 ----
  // phase: 'table'(桌面中央) | 'toTable'(滑回桌面) | 'pickup'(拿起中) | 'held'(在手中) | 'toOpponent'(滑向对手)
  const gun = {
    phase: 'table',
    holder: -1,
    x: 0, y: 0,
    from: { x: 0, y: 0 }, to: { x: 0, y: 0 },
    fromAngle: Math.PI, toAngle: Math.PI,
    t: 0, dur: 1,
    angle: Math.PI,
    recoil: 0,
    bob: Math.random() * 10
  };

  const mouse = { x: 0, y: 0 };
  let hover = null; // 'gun' | 'enemy' | 'self' | null
  let missImpact = null; // 打偏子弹落点
  let effects = [];
  let shake = { t: 0, amt: 0 };
  const playerFlash = [0, 0];
  let tableFlash = 0;
  let ambientDust = [];
  let tableMarks = [];

  let W = 0, H = 0, DPR = 1;
  let tableR = 200, cx = 0, cy = 0, s = 1;
  const p0 = { x: 0, y: 0 }; // 我（下方）
  const p1 = { x: 0, y: 0 }; // 对手（上方）
  let lastFrame = 0;

  // ---------- 工具 ----------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function angLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  function angTo(x1, y1, x2, y2) { return Math.atan2(x2 - x1, -(y2 - y1)); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    const c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(str, x, y, size, color, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = (opts.weight || 600) + ' ' + size + 'px ' + (opts.family || '"Segoe UI", "Microsoft YaHei", sans-serif');
    ctx.fillStyle = color;
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = opts.baseline || 'middle';
    if (opts.letterSpacing) ctx.letterSpacing = opts.letterSpacing + 'px';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  // ---------- 布局 ----------
  function layout() {
    const rect = mount.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(W * DPR);
    const ph = Math.round(H * DPR);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;

    cx = W / 2;
    cy = H / 2;
    tableR = clamp(Math.min(W * 0.25, H * 0.24), 118, 310);
    s = tableR / 190;

    p0.x = cx;
    p0.y = Math.min(H - 30, cy + tableR * 1.15 + 24);
    p1.x = cx;
    p1.y = Math.max(30, cy - tableR * 1.15 - 24);

    if (!ambientDust.length) {
      const count = Math.min(100, Math.max(42, Math.floor((W * H) / 15000)));
      ambientDust = Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: rnd(0.35, 1.35),
        a: rnd(0.08, 0.34),
        drift: rnd(0.25, 1.1),
        phase: rnd(0, Math.PI * 2)
      }));
      tableMarks = Array.from({ length: 18 }, () => ({
        angle: rnd(0, Math.PI * 2),
        radius: rnd(0.34, 0.86),
        length: rnd(0.02, 0.12),
        width: rnd(0.5, 1.3),
        alpha: rnd(0.06, 0.16)
      }));
    }
  }

  function tablePos() { return { x: cx, y: cy }; }
  function handPos(i) {
    if (i === ME) return { x: cx - tableR * 0.32, y: p0.y - 52 * s };
    return { x: cx + tableR * 0.32, y: p1.y + 52 * s };
  }
  function muzzlePos() {
    const f = { x: Math.sin(gun.angle), y: -Math.cos(gun.angle) };
    return { x: gun.x + f.x * (68 * s + 8), y: gun.y + f.y * (68 * s + 8) };
  }

  // 座位(0=我下方, 1=对手上方) → 实际玩家索引
  function seatPlayer(seat) { return seat === ME ? state.myIndex : 1 - state.myIndex; }
  function seatPos(seat) { return seat === ME ? p0 : p1; }

  // 当前皮肤配色（由 skins.js 提供）
  function skin() {
    const m = window.SkinManager;
    return (m && m.current) ? m.current : null;
  }

  // ---------- 美术贴图（可选，替换即换肤） ----------
  // 单套默认贴图放 client/assets/ 根目录；
  // 分类贴图皮肤放 client/assets/skins/<分类>/<皮肤名>/ 下，
  // 每种分类（枪/头像/角色/地图/牌桌）可独立选择一套。
  // 图片规格见 client/assets/README.txt
  const ASSETS = {
    floor: 'floor.png',           // 整屏背景，建议 16:9 大图
    table: 'table.png',           // 俯视椭圆赌桌，中心 = 锚点
    gun: 'gun.png',               // 左轮侧面，枪口朝上，转轮中心 = 锚点
    player0: 'player0.png',       // 你的角色（俯视角），中心 = 锚点
    player1: 'player1.png',       // 对手角色（俯视角），中心 = 锚点
    avatarMe: 'avatar-me.png',    // 底部自己的头像（立绘）
    avatarEnemy: 'avatar-enemy.png' // 左上敌人卡片头像（立绘）
  };
  // 贴图分类 → 资源名
  const ASSET_CATS = {
    gun: ['gun'],
    avatar: ['avatarMe', 'avatarEnemy'],
    player: ['player0', 'player1'],
    floor: ['floor'],
    table: ['table']
  };
  const assetImages = {};
  const assetPrefixes = {}; // 每个资源独立的前缀（默认 assets/）
  Object.keys(ASSETS).forEach(function (k) { assetPrefixes[k] = 'assets/'; });

  function loadAssets() {
    Object.keys(ASSETS).forEach(function (name) {
      const img = new Image();
      img.onload = function () {
        assetImages[name] = img;
        if (name === 'avatarMe' || name === 'avatarEnemy') applyAvatar(name);
      };
      img.onerror = function () { assetImages[name] = null; };
      img.src = assetPrefixes[name] + ASSETS[name];
    });
  }

  // 切换某个分类的贴图皮肤：category ∈ gun/avatar/player/floor/table，
  // skinName 为 assets/skins/<category>/ 下的目录名；空/null 回到该分类默认（assets/ 根）
  // 皮肤只作用于玩家自己（avatarMe/player0）；敌人（avatarEnemy/player1）始终用默认贴图，
  // 联机时由 setOpponentSkin 应用对方同步过来的皮肤。
  function setAssetSkin(category, skinName) {
    const resNames = ASSET_CATS[category];
    if (!resNames) return;
    resNames.forEach(function (name) {
      if (name === 'avatarEnemy' || name === 'player1') return;
      assetPrefixes[name] = skinName ? 'assets/skins/' + category + '/' + skinName + '/' : 'assets/';
      assetImages[name] = null;
      const img = new Image();
      img.onload = function () {
        assetImages[name] = img;
        if (name === 'avatarMe' || name === 'avatarEnemy') applyAvatar(name);
      };
      img.onerror = function () { assetImages[name] = null; };
      img.src = assetPrefixes[name] + ASSETS[name];
    });
  }

  // 应用对手的角色皮肤（avatarEnemy/player1 独立于自己的选择）
  function setOpponentSkin(skinName) {
    const map = { avatarEnemy: 'avatar', player1: 'player' };
    Object.keys(map).forEach(function (name) {
      const category = map[name];
      assetPrefixes[name] = skinName ? 'assets/skins/' + category + '/' + skinName + '/' : 'assets/';
      assetImages[name] = null;
      const img = new Image();
      img.onload = function () {
        assetImages[name] = img;
        if (name === 'avatarEnemy') applyAvatar(name);
      };
      img.onerror = function () { assetImages[name] = null; };
      img.src = assetPrefixes[name] + ASSETS[name];
    });
  }

  // 用图片替换卡片上的 CSS 头像（左上敌人卡 / 底部自己的面板）
  function applyAvatar(name) {
    const selector = name === 'avatarMe' ? '.player-panel .player-avatar' : '.player-left .player-avatar';
    document.querySelectorAll(selector).forEach(function (el) {
      el.innerHTML = '';
      el.style.backgroundImage = 'url(' + assetPrefixes[name] + ASSETS[name] + ')';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundRepeat = 'no-repeat';
    });
  }

  // 绘制贴图（自动居中、可选旋转）；无图返回 false，调用方用代码兜底
  function drawAsset(name, x, y, w, h, rot) {
    const img = assetImages[name];
    if (!img) return false;
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    return true;
  }

  // ---------- 枪相位切换 ----------
  // 桌面上的枪平躺：水平横放，微微偏向当前回合玩家一侧
  function tablePoseAngle() {
    return state.currentPlayer === state.myIndex ? Math.PI / 2 + 0.4 : Math.PI / 2 - 0.4;
  }

  function setGunPhase(phase, dur) {
    gun.from.x = gun.x;
    gun.from.y = gun.y;
    gun.fromAngle = gun.angle;
    if (phase === 'toTable') {
      gun.to = tablePos();
      gun.toAngle = tablePoseAngle();
    } else if (phase === 'pickup') {
      gun.to = handPos(ME);
      gun.toAngle = angTo(handPos(ME).x, handPos(ME).y, mouse.x, mouse.y);
    } else {
      gun.to = handPos(OPP);
      gun.toAngle = angTo(handPos(OPP).x, handPos(OPP).y, p0.x, p0.y);
    }
    gun.t = 0;
    gun.dur = dur || 0.55;
    gun.phase = phase;
  }

  function goToTable(dur) { setGunPhase('toTable', dur || 0.55); }
  function goToOpponent() { setGunPhase('toOpponent', 0.6); }
  function beginPickup() {
    state.canPickup = false;
    setGunPhase('pickup', 0.45);
  }

  function updateGun(dt) {
    gun.bob += dt;

    if (gun.phase === 'toTable' || gun.phase === 'pickup' || gun.phase === 'toOpponent') {
      gun.t = Math.min(1, gun.t + dt / gun.dur);
      const k = easeInOut(gun.t);
      const arc = Math.sin(k * Math.PI) * 30 * s;
      gun.x = lerp(gun.from.x, gun.to.x, k);
      gun.y = lerp(gun.from.y, gun.to.y, k) - arc;
      gun.angle = angLerp(gun.fromAngle, gun.toAngle, k);
      if (gun.t >= 1) {
        gun.x = gun.to.x;
        gun.y = gun.to.y;
        gun.angle = gun.toAngle;
        if (gun.phase === 'pickup') {
          gun.phase = 'held';
          gun.holder = ME;
          addRing(gun.x, gun.y, [255, 199, 94], 36 * s, 0.35);
          if (window.Game2D.onPickup) window.Game2D.onPickup();
        } else if (gun.phase === 'toOpponent') {
          gun.phase = 'held';
          gun.holder = OPP;
        } else {
          gun.phase = 'table';
          gun.holder = -1;
        }
      }
    }

    gun.recoil = Math.max(0, gun.recoil - dt * 9);

    if (gun.phase === 'table') {
      gun.angle = angLerp(gun.angle, tablePoseAngle(), Math.min(1, dt * 6));
      gun.angle += Math.sin(gun.bob * 1.7) * 0.02;
    } else if (gun.phase === 'held') {
      if (gun.holder === ME) {
        gun.angle = angLerp(gun.angle, angTo(gun.x, gun.y, mouse.x, mouse.y), Math.min(1, dt * 12));
      } else {
        gun.angle = angLerp(gun.angle, angTo(gun.x, gun.y, p0.x, p0.y), Math.min(1, dt * 4));
      }
    }
  }

  // ---------- 特效 ----------
  function addEffect(type, x, y, dur, extra) {
    const e = Object.assign({ type: type, x: x, y: y, t: 0, dur: dur }, extra || {});
    if (type === 'burst' || type === 'spark') e.particles = makeBurst(x, y, e.color, e.count);
    if (type === 'smoke') e.particles = makeSmoke(x, y, e.count || 7);
    effects.push(e);
  }
  function addRing(x, y, rgb, maxR, dur) { addEffect('ring', x, y, dur, { maxR: maxR, rgb: rgb }); }
  function addBurst(x, y, color, count) { addEffect('burst', x, y, 0.6, { color: color, count: count }); }
  function addSpark(x, y, color, count) { addEffect('spark', x, y, 0.35, { color: color, count: count }); }

  function makeBurst(x, y, color, count) {
    const ps = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(60, 260) * s;
      ps.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(1.6, 3.6) * s, life: rnd(0.3, 0.6) });
    }
    return ps;
  }

  function makeSmoke(x, y, count) {
    const ps = [];
    for (let i = 0; i < count; i++) {
      ps.push({
        x: x + rnd(-5, 5) * s,
        y: y + rnd(-5, 5) * s,
        vx: rnd(-18, 18) * s,
        vy: rnd(-52, -16) * s,
        r: rnd(4, 9) * s,
        life: rnd(0.38, 0.8),
        maxLife: 0.8
      });
    }
    return ps;
  }

  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.t += dt;
      if (e.type === 'burst' || e.type === 'spark') {
        for (const p of e.particles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += (e.type === 'burst' ? 220 : 60) * s * dt;
          p.life -= dt;
        }
      } else if (e.type === 'smoke') {
        for (const p of e.particles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy -= 6 * s * dt;
          p.r += 4 * s * dt;
          p.life -= dt;
        }
      } else if (e.type === 'shell') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vy += 900 * s * dt;
        e.rot += dt * 14;
      }
      if (e.t >= e.dur) effects.splice(i, 1);
    }
    playerFlash[0] = Math.max(0, playerFlash[0] - dt);
    playerFlash[1] = Math.max(0, playerFlash[1] - dt);
    tableFlash = Math.max(0, tableFlash - dt);
    if (shake.t > 0) shake.t -= dt;
  }

  // ---------- 对外接口 ----------
  function sync(next) {
    next = next || {};
    const prev = state.currentPlayer;
    if (next.mode !== undefined) state.mode = next.mode;
    if (next.gameActive !== undefined) state.gameActive = !!next.gameActive;
    if (next.currentPlayer !== undefined) state.currentPlayer = next.currentPlayer;
    if (next.playerIndex !== undefined) state.myIndex = next.playerIndex;
    if (Array.isArray(next.powerActive)) state.powerActive = next.powerActive;
    if (Array.isArray(next.health) && next.health.length === 2) state.health = next.health;
    state.canPickup = !!next.canPickup;
    if (next.canAct !== undefined) state.canAct = !!next.canAct;

    if (prev !== state.currentPlayer && state.gameActive) {
      if (prev >= 0) window.GameAudio?.play('turn');
      if (state.currentPlayer === state.myIndex) {
        goToTable(0.5);
      } else {
        goToOpponent();
      }
    } else if (state.canPickup && gun.phase === 'held' && gun.holder === ME) {
      // 同回合重新装填后：枪回到桌面等待拿起
      goToTable(0.45);
    } else if (state.gameActive && state.currentPlayer !== state.myIndex && (gun.phase === 'table' || gun.phase === 'toTable')) {
      // 装填动画结束后枪回到桌面，但轮到对手：把枪交给对手（否则会显示对手没拿枪却开枪）
      goToOpponent();
    }
    updateHint();
  }

  // target：瞄准的目标（'self'/'enemy'，AI 射来时同理）；aimed=false 表示打偏
  function triggerShot(target, isLive, aimed) {
    gun.recoil = 11 * s;
    const m = muzzlePos();
    addEffect('flash', m.x, m.y, isLive === false ? 0.1 : 0.14, { color: isLive === false ? '#d5e2dc' : '#ffc47a' });
    addEffect('smoke', m.x, m.y, 0.72, { count: isLive === false ? 3 : 6 });
    tableFlash = 0.55;
    if (isLive === false) return; // 空弹：只有枪口焰与硝烟，不射出子弹
    if (aimed === false) {
      // 打偏：子弹沿枪口朝向（= 鼠标方向）飞出并随机偏离
      const fx = Math.sin(gun.angle);
      const fy = -Math.cos(gun.angle);
      const dist = 240 * s + rnd(-20, 40);
      missImpact = { x: m.x + fx * dist + rnd(-70, 70) * s, y: m.y + fy * dist + rnd(-40, 40) * s };
      addEffect('tracer', m.x, m.y, 0.17, { x2: missImpact.x, y2: missImpact.y });
      return;
    }
    const shooterSeat = gun.holder === ME ? ME : OPP;
    const victimSeat = target === 'self' ? shooterSeat : 1 - shooterSeat;
    const v = seatPos(victimSeat);
    const tx = v.x + rnd(-16, 16);
    const ty = v.y + rnd(-16, 16);
    addEffect('tracer', m.x, m.y, 0.17, { x2: tx, y2: ty });
  }

  function triggerReload() {
    window.GameAudio?.play('reload');
    goToTable(0.4);
  }

  function reportOutcome(payload) {
    payload = payload || {};
    const hit = payload.hit;
    const shield = payload.shield;
    const target = payload.target;
    const shooterIsPlayer = payload.shooterIsPlayer;
    const eject = payload.eject;
    const item = payload.item;
    const gameOver = payload.gameOver;
    const aimed = payload.aimed !== false;

    if (item && item !== 'eject') {
      triggerItem(item, payload.playerIndex);
    }

    let victim = ME;
    if (shooterIsPlayer) victim = target === 'enemy' ? OPP : ME;
    else victim = target === 'enemy' ? ME : OPP;
    const v = seatPos(victim);

    if (hit) {
      addBurst(v.x, v.y, '#ff3b28', 16);
      addRing(v.x, v.y, [255, 59, 40], 46 * s, 0.4);
      addEffect('damageText', v.x, v.y - 38 * s, 0.78, { label: payload.damage > 1 ? '-' + payload.damage + ' HP' : '-1 HP', color: '#ff8069' });
      playerFlash[victim] = 0.38;
      shake = { t: 0.35, amt: 6 };
      flashBody('red');
      window.GameAudio?.play('shot');
      window.GameAudio?.play('impact');
    } else if (shield) {
      addRing(v.x, v.y, [98, 217, 202], 44 * s, 0.35);
      addEffect('shield', v.x, v.y, 0.52, { color: '#8de8db' });
      playerFlash[victim] = 0.3;
      shake = { t: 0.2, amt: 3 };
      flashBody('cyan');
      window.GameAudio?.play('shot');
      window.GameAudio?.play('shield');
    } else if (aimed === false && !item) {
      // 打偏：子弹落空
      addSpark(missImpact ? missImpact.x : mouse.x, missImpact ? missImpact.y : mouse.y, '#9aa8a4', 6);
      missImpact = null;
      shake = { t: 0.1, amt: 2 };
      window.GameAudio?.play('dry');
    } else if (!eject && !item) {
      addSpark(v.x, v.y, '#9aa8a4', 8);
      addEffect('damageText', v.x, v.y - 34 * s, 0.65, { label: '空弹', color: '#b3c5bf' });
      shake = { t: 0.12, amt: 2 };
      if (!item) window.GameAudio?.play('dry');
    }

    if (eject) {
      const m = muzzlePos();
      addEffect('shell', m.x, m.y, 0.9, {
        vx: -Math.sin(gun.angle) * 120 + rnd(-30, 30),
        vy: Math.cos(gun.angle) * 120 + rnd(-30, 30),
        rot: rnd(0, 6)
      });
      addSpark(m.x, m.y, '#f2c46e', 9);
      window.GameAudio?.play('eject');
    }
    if (gameOver) {
      shake = { t: 0.7, amt: 9 };
    }
  }

  function triggerItem(item, playerIndex) {
    const actualPlayer = Number.isFinite(playerIndex) ? playerIndex : state.currentPlayer;
    const seat = actualPlayer === state.myIndex ? ME : OPP;
    const p = seatPos(seat);
    if (item === 'power') {
      addRing(gun.x, gun.y, [255, 86, 45], 58 * s, 0.55);
      addBurst(gun.x, gun.y, '#ff673f', 10);
    } else if (item === 'shield') {
      addEffect('shield', p.x, p.y, 0.65, { color: '#8de8db' });
      addRing(p.x, p.y, [98, 217, 202], 56 * s, 0.58);
    } else if (item === 'peek') {
      addRing(cx, cy, [133, 217, 202], tableR * 0.55, 0.72);
      addEffect('scan', cx, cy, 0.72, { color: '#a4f4dc' });
    }
  }

  function flashBody(type) {
    const flash = document.getElementById('hit-flash');
    if (!flash) return;
    flash.classList.remove('red', 'cyan', 'gold');
    void flash.offsetWidth;
    flash.classList.add(type, 'active');
    setTimeout(function () { flash.classList.remove('active'); }, 420);
  }

  // 对决结算效果：胜利金色闪屏 + 震动 + 粒子；失败红色闪屏 + 震动 + 粒子
  function duelResult(type) {
    if (type === 'win') {
      flashBody('gold');
      shake = { t: 0.75, amt: 8 };
      addBurst(p0.x, p0.y, '#ffd700', 20);
      addRing(p0.x, p0.y, [255, 215, 90], 52 * s, 0.55);
      addEffect('damageText', p0.x, p0.y - 42 * s, 0.8, { label: '对决胜利', color: '#ffd700' });
      window.GameAudio?.play('duelWin');
    } else if (type === 'lose') {
      flashBody('red');
      shake = { t: 0.8, amt: 12 };
      addBurst(p0.x, p0.y, '#ff3b28', 18);
      addRing(p0.x, p0.y, [255, 59, 40], 50 * s, 0.5);
      addEffect('damageText', p0.x, p0.y - 42 * s, 0.85, { label: '对决失败', color: '#ff8069' });
      playerFlash[ME] = 0.4;
      window.GameAudio?.play('duelLose');
    } else {
      // 平局 / 提前开火
      flashBody('cyan');
      shake = { t: 0.45, amt: 6 };
      window.GameAudio?.play('dry');
    }
  }

  function setScreen(id) {
    state.gameScreenActive = id === 'game-screen';
    document.body.classList.toggle('game-active', state.gameScreenActive);
    hover = null;
    setCursor(null);
    updateHint();
  }

  // ---------- 交互 ----------
  function localPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function setCursor(type) {
    canvas.style.cursor = type || 'default';
  }

  function updateHint() {
    const el = document.getElementById('aim-hint');
    if (!el) return;
    if (!state.gameScreenActive || !state.gameActive) {
      el.textContent = '';
      return;
    }
    if (gun.phase === 'table' && state.canPickup) {
      el.textContent = hover === 'gun' ? '拿起枪' : '点击桌上的枪，拿起它';
    } else if (gun.phase === 'held' && gun.holder === ME) {
      if (hover === 'enemy') el.textContent = '已瞄准对手，点击开枪';
      else if (hover === 'self') el.textContent = '已瞄准自己，点击开枪（空弹可继续回合）';
      else el.textContent = '对准对手或自己再开枪，未瞄准会打偏！';
    } else if (gun.phase === 'held' && gun.holder !== ME) {
      el.textContent = '对手的回合…';
    } else {
      el.textContent = '';
    }
  }

  function updateHover(p) {
    hover = null;
    if (state.gameScreenActive && state.gameActive) {
      if (gun.phase === 'table' && state.canPickup && dist(p, gun) < Math.max(34 * s, 40)) {
        hover = 'gun';
      } else if (gun.phase === 'held' && gun.holder === ME) {
        if (dist(p, p1) < 46 * s) hover = 'enemy';
        else if (dist(p, p0) < 46 * s) hover = 'self';
      }
    }
    setCursor(hover === 'gun' ? 'pointer' : (hover ? 'crosshair' : null));
    updateHint();
  }

  // 开枪：target 为瞄准的目标（'self'/'enemy'），未瞄准时为 null
  function fire(target, aimed) {
    if (!state.canAct) return;
    if (window.Game2D.onShoot) window.Game2D.onShoot(target, aimed);
  }

  function onPointerMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    updateHover(localPos(e));
  }

  function onPointerDown(e) {
    if (!state.gameScreenActive) return;
    if (e.button === 2) {
      e.preventDefault();
      if (gun.phase === 'held' && gun.holder === ME) fire('self', true);
      return;
    }
    if (e.button !== 0) return;
    const p = localPos(e);
    if (gun.phase === 'table' && state.canPickup && dist(p, gun) < Math.max(34 * s, 40)) {
      beginPickup();
      return;
    }
    if (gun.phase === 'held' && gun.holder === ME) {
      // 以鼠标当前瞄准的目标开枪；没有瞄准则打偏
      fire(hover, hover !== null);
    }
  }

  function onKeyDown(e) {
    if (!state.gameScreenActive) return;
    const k = e.key.toLowerCase();
    if (gun.phase === 'held' && gun.holder === ME) {
      if (k === 'e') fire('enemy', true);
      if (k === 's') fire('self', true);
    }
  }

  // ---------- 绘制 ----------
  function drawFloor() {
    const sk = skin() ? skin().floor : null;
    const floorShown = drawAsset('floor', W / 2, H / 2, W, H);
    if (!floorShown) {
    const floor = ctx.createLinearGradient(0, 0, 0, H);
    floor.addColorStop(0, sk ? sk.bg1 : '#05080b');
    floor.addColorStop(0.48, sk ? sk.bg2 : '#0b1113');
    floor.addColorStop(1, sk ? sk.bg3 : '#030507');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(cx, cy, tableR * 0.25, cx, cy, tableR * 3.1);
    glow.addColorStop(0, sk ? 'rgba(' + sk.glow + ',0.28)' : 'rgba(61, 117, 101, 0.28)');
    glow.addColorStop(0.42, sk ? 'rgba(' + sk.glow + ',0.15)' : 'rgba(28, 61, 56, 0.15)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = sk ? 'rgba(' + sk.grid + ',0.05)' : 'rgba(145, 181, 167, 0.045)';
    ctx.lineWidth = 1;
    const step = Math.max(42, Math.round(52 * s));
    ctx.beginPath();
    for (let x = cx % step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = cy % step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.restore();
    }

    const now = performance.now() / 1000;
    for (const dust of ambientDust) {
      const x = ((dust.x + Math.sin(now * dust.drift + dust.phase) * 0.008 + 1) % 1) * W;
      const y = ((dust.y + Math.cos(now * dust.drift * 0.7 + dust.phase) * 0.006 + 1) % 1) * H;
      ctx.fillStyle = 'rgba(218, 190, 132, ' + dust.a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(x, y, dust.r, 0, Math.PI * 2);
      ctx.fill();
    }

    const v = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.32, cx, cy, Math.max(W, H) * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.66, 'rgba(0,0,0,0.18)');
    v.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    if (!floorShown) {
    ctx.strokeStyle = 'rgba(218, 173, 103, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - tableR * 2.15, cy - tableR * 1.08);
    ctx.lineTo(cx - tableR * 0.98, cy - tableR * 1.08);
    ctx.moveTo(cx + tableR * 0.98, cy - tableR * 1.08);
    ctx.lineTo(cx + tableR * 2.15, cy - tableR * 1.08);
    ctx.moveTo(cx - tableR * 2.15, cy + tableR * 1.08);
    ctx.lineTo(cx - tableR * 0.98, cy + tableR * 1.08);
    ctx.moveTo(cx + tableR * 0.98, cy + tableR * 1.08);
    ctx.lineTo(cx + tableR * 2.15, cy + tableR * 1.08);
    ctx.stroke();
    }
  }

  function drawTable() {
    const rx = tableR * 1.58;
    const ry = tableR * 0.72;
    const sk = skin() ? skin().table : null;

    if (!drawAsset('table', cx, cy + 10 * s, rx * 2.18, ry * 2.4)) {
    const rail = sk ? sk.rail : '#8c5a32';
    const rim = sk ? sk.rim : '#d9ad67';
    const chip1 = sk ? sk.chip1 : '#e2b66b';
    const chip2 = sk ? sk.chip2 : '#293331';
    const felt1 = sk ? sk.felt1 : '#286054';
    const felt2 = sk ? sk.felt2 : '#081b1b';

    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 22 * s, rx * 1.08, ry * 1.16, 0, 0, Math.PI * 2);
    ctx.fill();

    const apron = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry * 1.3);
    apron.addColorStop(0, rail);
    apron.addColorStop(0.42, '#2c1b18');
    apron.addColorStop(1, '#100e10');
    ctx.fillStyle = apron;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 12 * s, rx * 1.05, ry * 1.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rail;
    ctx.lineWidth = 2.2 * s;
    ctx.stroke();

    ctx.fillStyle = rail;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // 立体感：上高光、下暗边
    const shade = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.5, 4, cx, cy, rx);
    shade.addColorStop(0, 'rgba(255,255,255,0.28)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0)');
    shade.addColorStop(0.85, 'rgba(0,0,0,0.22)');
    shade.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    const felt = ctx.createRadialGradient(cx, cy - ry * 0.18, 2, cx, cy, rx);
    felt.addColorStop(0, felt1);
    felt.addColorStop(0.45, felt1);
    felt.addColorStop(0.85, felt2);
    felt.addColorStop(1, felt2);
    ctx.fillStyle = felt;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.91, ry * 0.84, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.89, ry * 0.82, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#8bd5bb';
    ctx.lineWidth = Math.max(0.5, s * 0.7);
    for (let i = -12; i <= 12; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - rx, cy + i * 14 * s);
      ctx.lineTo(cx + rx, cy + i * 14 * s + rx * 0.24);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.2;
    const markRgb = hexToRgb(rim);
    for (const mark of tableMarks) {
      const x = cx + Math.cos(mark.angle) * rx * mark.radius;
      const y = cy + Math.sin(mark.angle) * ry * mark.radius;
      ctx.strokeStyle = 'rgba(' + markRgb[0] + ',' + markRgb[1] + ',' + markRgb[2] + ',' + mark.alpha.toFixed(2) + ')';
      ctx.lineWidth = mark.width * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(mark.angle + 0.7) * rx * mark.length, y + Math.sin(mark.angle + 0.7) * ry * mark.length);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = rgba(rim, 0.55);
    ctx.lineWidth = 1.3 * s;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.91, ry * 0.84, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(rim, 0.2);
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.64, ry * 0.56, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = rgba(rim, 0.4);
    ctx.lineWidth = 1.4 * s;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.28, ry * 0.25, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.2, cy); ctx.lineTo(cx + rx * 0.2, cy);
    ctx.moveTo(cx, cy - ry * 0.18); ctx.lineTo(cx, cy + ry * 0.18);
    ctx.stroke();
    ctx.fillStyle = rgba(rim, 0.72);
    ctx.beginPath();
    ctx.arc(cx, cy, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + 0.08;
      const x = cx + Math.cos(a) * rx * 0.96;
      const y = cy + Math.sin(a) * ry * 0.96;
      ctx.fillStyle = i % 3 === 0 ? chip1 : chip2;
      ctx.beginPath();
      ctx.arc(x, y, (i % 3 === 0 ? 3 : 2.2) * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(7, 10, 10, 0.75)';
      ctx.lineWidth = 1 * s;
      ctx.stroke();
    }

    drawCard(cx - rx * 0.62, cy - ry * 0.25, 30 * s, 42 * s, -0.22, '#c95d4c', '06');
    drawCard(cx + rx * 0.57, cy + ry * 0.21, 28 * s, 39 * s, 0.18, '#d2b36b', 'X');
    drawChip(cx - rx * 0.57, cy + ry * 0.36, chip1, 0.9 * s, -0.16);
    drawChip(cx + rx * 0.62, cy - ry * 0.33, chip2, 0.82 * s, 0.14);
    }

    if (tableFlash > 0) {
      const a = Math.min(1, tableFlash / 0.55);
      const flash = ctx.createRadialGradient(cx, cy, tableR * 0.25, cx, cy, rx * 1.1);
      flash.addColorStop(0, 'rgba(255, 111, 62, ' + (a * 0.16).toFixed(2) + ')');
      flash.addColorStop(0.7, 'rgba(238, 74, 53, ' + (a * 0.08).toFixed(2) + ')');
      flash.addColorStop(1, 'rgba(238, 74, 53, 0)');
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 112, 72,' + (a * 0.86).toFixed(2) + ')';
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + (1 - a) * 16 * s, ry + (1 - a) * 10 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawCard(x, y, w, h, rotation, accent, label) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10 * s;
    ctx.shadowOffsetY = 5 * s;
    ctx.fillStyle = '#d7d0b8';
    rr(-w / 2, -h / 2, w, h, 3 * s);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.3 * s;
    rr(-w / 2 + 3 * s, -h / 2 + 3 * s, w - 6 * s, h - 6 * s, 2 * s);
    ctx.stroke();
    text(label, 0, 1 * s, Math.max(8, 9 * s), accent, { family: 'Georgia, serif', weight: 700 });
    ctx.restore();
  }

  function drawChip(x, y, color, radius, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation || 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(2 * s, 4 * s, 14 * radius, 7 * radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 14 * radius, 7 * radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e5c27a';
    ctx.lineWidth = 1.4 * s;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(11, 18, 17, 0.6)';
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8 * radius, 3.5 * radius, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(i) {
    const isMe = i === ME;
    const p = isMe ? p0 : p1;
    const skA = (isMe && skin()) ? skin().avatar : null;
    const accent = isMe ? (skA ? skA.accent : '#ee6548') : '#6bd5c5';
    const suitC = isMe ? (skA ? skA.suit : '#2d2625') : '#172928';
    const headC = isMe ? (skA ? skA.head : '#d2a27e') : '#7a6255';
    const accentRgb = hexToRgb(accent).join(',');
    const playerIdx = seatPlayer(i);
    const active = state.gameActive && state.currentPlayer === playerIdx;
    const dead = state.health[playerIdx] <= 0;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 24 * s, 39 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    if (active) {
      const pulse = (Math.sin(gun.bob * 3.5) + 1) / 2;
      ctx.strokeStyle = 'rgba(' + accentRgb + ',' + (0.5 + pulse * 0.35).toFixed(2) + ')';
      ctx.lineWidth = 2.2 * s;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 3 * s, (38 + pulse * 5) * s, (27 + pulse * 4) * s, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + accentRgb + ',0.22)';
      ctx.lineWidth = 1 * s;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 3 * s, (47 + pulse * 7) * s, (34 + pulse * 5) * s, 0, 0, Math.PI * 2);
      ctx.stroke();
      text('YOUR TURN', p.x, p.y - (52 + pulse * 2) * s, 10 * s, accent, { weight: 700, letterSpacing: 2.2 });
    }

    ctx.globalAlpha = dead ? 0.45 : 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    // 敌人与玩家同方向绘制（贴图已统一朝向，不再旋转 180°）
    ctx.rotate(0);

    if (!drawAsset(isMe ? 'player0' : 'player1', 0, 0, 86 * s, 86 * s)) {

    // 外套与肩甲
    ctx.fillStyle = '#090f11';
    ctx.beginPath();
    ctx.moveTo(-28 * s, 12 * s);
    ctx.quadraticCurveTo(-25 * s, -1 * s, -14 * s, -4 * s);
    ctx.lineTo(14 * s, -4 * s);
    ctx.quadraticCurveTo(25 * s, -1 * s, 28 * s, 12 * s);
    ctx.lineTo(23 * s, 30 * s);
    ctx.lineTo(-23 * s, 30 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1b2b2a';
    ctx.lineWidth = 1.3 * s;
    ctx.stroke();

    ctx.fillStyle = suitC;
    ctx.beginPath();
    ctx.moveTo(-23 * s, 5 * s);
    ctx.lineTo(-32 * s, 13 * s);
    ctx.lineTo(-28 * s, 23 * s);
    ctx.lineTo(-19 * s, 16 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(23 * s, 5 * s);
    ctx.lineTo(32 * s, 13 * s);
    ctx.lineTo(28 * s, 23 * s);
    ctx.lineTo(19 * s, 16 * s);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = isMe ? rgba(accent, 0.55) : '#23544f';
    rr(-14 * s, 2 * s, 28 * s, 25 * s, 5 * s);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.globalAlpha *= 0.7;
    ctx.lineWidth = 1 * s;
    ctx.stroke();
    ctx.globalAlpha = dead ? 0.45 : 1;

    // 领口和胸前金属标记
    ctx.fillStyle = '#0d1616';
    ctx.beginPath();
    ctx.moveTo(-10 * s, 0);
    ctx.lineTo(0, 11 * s);
    ctx.lineTo(10 * s, 0);
    ctx.lineTo(7 * s, -6 * s);
    ctx.lineTo(-7 * s, -6 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(238, 206, 137, 0.68)';
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.moveTo(-4 * s, 6 * s); ctx.lineTo(4 * s, 6 * s);
    ctx.stroke();

    // 双臂与手套
    ctx.strokeStyle = suitC;
    ctx.lineWidth = 7 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-23 * s, 8 * s); ctx.lineTo(-37 * s, 19 * s);
    ctx.moveTo(23 * s, 8 * s); ctx.lineTo(37 * s, 19 * s);
    ctx.stroke();
    ctx.fillStyle = '#171a1a';
    ctx.beginPath();
    ctx.arc(-38 * s, 20 * s, 5 * s, 0, Math.PI * 2);
    ctx.arc(38 * s, 20 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();

    // 兜帽、面罩和发光视线
    ctx.fillStyle = '#080d0e';
    ctx.beginPath();
    ctx.arc(0, -17 * s, 17 * s, Math.PI, Math.PI * 2);
    ctx.lineTo(17 * s, -11 * s);
    ctx.quadraticCurveTo(0, 4 * s, -17 * s, -11 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4 * s;
    ctx.stroke();

    const face = ctx.createRadialGradient(-4 * s, -23 * s, 1 * s, 0, -17 * s, 15 * s);
    face.addColorStop(0, headC);
    face.addColorStop(1, isMe ? '#3a2620' : '#2c2626');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(0, -17 * s, 11.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isMe ? '#151a1b' : '#091315';
    rr(-13 * s, -19 * s, 26 * s, 7 * s, 2 * s);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8 * s;
    rr(-8 * s, -17.7 * s, 5 * s, 2 * s, 1 * s);
    rr(3 * s, -17.7 * s, 5 * s, 2 * s, 1 * s);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 肩部徽记与下摆缝线
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(-18 * s, 8 * s, 2.2 * s, 0, Math.PI * 2);
    ctx.arc(18 * s, 8 * s, 2.2 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.28);
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.moveTo(-17 * s, 24 * s); ctx.lineTo(17 * s, 24 * s);
    ctx.stroke();
    }

    ctx.restore();

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#101515';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();

    if (dead) {
      ctx.strokeStyle = 'rgba(232,238,234,0.8)';
      ctx.lineWidth = 3.5 * s;
      ctx.beginPath();
      ctx.moveTo(p.x - 18 * s, p.y - 18 * s); ctx.lineTo(p.x + 18 * s, p.y + 18 * s);
      ctx.moveTo(p.x + 18 * s, p.y - 18 * s); ctx.lineTo(p.x - 18 * s, p.y + 18 * s);
      ctx.stroke();
    }

    if (playerFlash[i] > 0) {
      const a = Math.min(1, playerFlash[i] / 0.38) * 0.55;
      const g = ctx.createRadialGradient(p.x, p.y, 4 * s, p.x, p.y, 34 * s);
      g.addColorStop(0, 'rgba(' + accentRgb + ',' + a.toFixed(2) + ')');
      g.addColorStop(1, 'rgba(' + accentRgb + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 34 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    const name = isMe ? '你' : (state.mode === 'single' ? 'AI' : '对手');
    text(name, p.x, p.y - 48 * s, 13 * s, active ? accent : 'rgba(232,238,234,0.86)', { weight: 700, letterSpacing: 2 });

    const hp = clamp(state.health[playerIdx], 0, 5);
    for (let k = 0; k < hp; k++) {
      const hx = p.x + (k - (hp - 1) / 2) * 11 * s;
      ctx.fillStyle = accent;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 7 * s;
      ctx.beginPath();
      ctx.arc(hx, p.y + 43 * s, 3.1 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawGun() {
    const a = gun.angle;
    ctx.save();
    ctx.translate(gun.x, gun.y);
    if (gun.phase === 'table') ctx.translate(0, Math.sin(gun.bob * 2.2) * 3 * s);
    if (gun.phase === 'held') ctx.translate(0, Math.sin(gun.bob * 3.1) * 2.2 * s);
    ctx.translate(-Math.sin(a) * gun.recoil, Math.cos(a) * gun.recoil);
    ctx.rotate(a);

    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.beginPath();
    ctx.ellipse(4 * s, 10 * s, 40 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    if (gun.phase === 'held') {
      // 握枪手套和袖口，让枪从图标变成真正被拿起的武器。
      ctx.fillStyle = gun.holder === ME ? '#252b2c' : '#182324';
      ctx.beginPath();
      ctx.moveTo(-19 * s, 31 * s);
      ctx.quadraticCurveTo(-15 * s, 19 * s, -8 * s, 13 * s);
      ctx.lineTo(8 * s, 13 * s);
      ctx.quadraticCurveTo(16 * s, 20 * s, 19 * s, 31 * s);
      ctx.lineTo(12 * s, 39 * s);
      ctx.lineTo(-12 * s, 39 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = gun.holder === ME ? '#b95343' : '#4aa99c';
      ctx.lineWidth = 1.4 * s;
      ctx.stroke();
      ctx.fillStyle = '#c18c63';
      ctx.beginPath();
      ctx.ellipse(0, 15 * s, 11 * s, 8 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!drawAsset('gun', 0, -5 * s, 56 * s, 124 * s)) {
    const sk = skin() ? skin().gun : null;
    const gBody = sk ? sk.body : '#303837';
    const gDark = sk ? sk.dark : '#101515';
    const gBrass = sk ? sk.brass : '#c08a47';
    const gGrip = sk ? sk.grip : '#6e2827';
    const gBright = sk ? sk.bright : '#f0c978';

    // 木质握把
    const grip = ctx.createLinearGradient(-12 * s, 4 * s, 13 * s, 28 * s);
    grip.addColorStop(0, gGrip);
    grip.addColorStop(0.5, gGrip);
    grip.addColorStop(1, '#1a1010');
    ctx.fillStyle = grip;
    ctx.beginPath();
    ctx.moveTo(-10 * s, 5 * s);
    ctx.lineTo(10 * s, 6 * s);
    ctx.lineTo(13 * s, 25 * s);
    ctx.quadraticCurveTo(8 * s, 33 * s, 0, 34 * s);
    ctx.quadraticCurveTo(-9 * s, 32 * s, -13 * s, 25 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#180e12';
    ctx.lineWidth = 2 * s;
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#f1b58a';
    ctx.lineWidth = 0.8 * s;
    for (let y = 11; y < 31; y += 5) {
      ctx.beginPath();
      ctx.moveTo(-9 * s, y * s);
      ctx.lineTo(8 * s, (y + 4) * s);
      ctx.stroke();
    }
    ctx.restore();

    // 枪身与枪架
    ctx.fillStyle = gDark;
    rr(-12 * s, -18 * s, 24 * s, 28 * s, 4 * s);
    ctx.fill();
    ctx.strokeStyle = '#070a0b';
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();
    ctx.fillStyle = gBody;
    rr(-9 * s, -17 * s, 18 * s, 23 * s, 3 * s);
    ctx.fill();
    ctx.strokeStyle = gBright;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1 * s;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 枪管、顶部瞄具和枪口护圈
    const barrel = ctx.createLinearGradient(-8 * s, 0, 8 * s, 0);
    barrel.addColorStop(0, gDark);
    barrel.addColorStop(0.32, gBody);
    barrel.addColorStop(0.56, gBody);
    barrel.addColorStop(1, gDark);
    ctx.fillStyle = barrel;
    rr(-7 * s, -70 * s, 14 * s, 55 * s, 3 * s);
    ctx.fill();
    ctx.strokeStyle = '#090d0d';
    ctx.lineWidth = 1.8 * s;
    ctx.stroke();
    ctx.fillStyle = gBrass;
    rr(-4.3 * s, -73 * s, 8.6 * s, 7 * s, 2 * s);
    ctx.fill();
    ctx.fillStyle = gBright;
    rr(-2.2 * s, -76 * s, 4.4 * s, 5 * s, 1.5 * s);
    ctx.fill();
    ctx.fillStyle = '#070a0b';
    ctx.beginPath();
    ctx.ellipse(0, -70 * s, 8.5 * s, 4.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = gBrass;
    ctx.lineWidth = 1.2 * s;
    ctx.stroke();
    ctx.fillStyle = '#020304';
    ctx.beginPath();
    ctx.ellipse(0, -70 * s, 4.2 * s, 2.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // 转轮：金属层和中央轴（不显示弹巢）
    const cylinder = ctx.createRadialGradient(-5 * s, -8 * s, 1 * s, 0, -5 * s, 23 * s);
    cylinder.addColorStop(0, gBody);
    cylinder.addColorStop(0.3, gBody);
    cylinder.addColorStop(0.65, gDark);
    cylinder.addColorStop(1, gDark);
    ctx.fillStyle = cylinder;
    ctx.beginPath();
    ctx.arc(0, -5 * s, 22 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = gBrass;
    ctx.lineWidth = 2 * s;
    ctx.stroke();
    ctx.strokeStyle = rgba(gBrass, 0.36);
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.arc(0, -5 * s, 18 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = gDark;
    ctx.beginPath();
    ctx.arc(0, -5 * s, 6.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = gBrass;
    ctx.lineWidth = 1.6 * s;
    ctx.stroke();
    ctx.fillStyle = '#050707';
    ctx.beginPath();
    ctx.arc(0, -5 * s, 2.2 * s, 0, Math.PI * 2);
    ctx.fill();

    // 击锤、扳机护圈与螺钉
    ctx.fillStyle = gBrass;
    rr(-7 * s, 13 * s, 14 * s, 8 * s, 2 * s);
    ctx.fill();
    ctx.fillStyle = gDark;
    rr(-5 * s, 16 * s, 10 * s, 5 * s, 2 * s);
    ctx.fill();
    ctx.strokeStyle = gBody;
    ctx.lineWidth = 1.8 * s;
    ctx.beginPath();
    ctx.arc(0, 10 * s, 8 * s, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = gBright;
    ctx.beginPath();
    ctx.arc(-9 * s, -18 * s, 2 * s, 0, Math.PI * 2);
    ctx.arc(9 * s, -18 * s, 2 * s, 0, Math.PI * 2);
    ctx.fill();
    }

    ctx.restore();

    const holder = gun.phase === 'held' ? gun.holder : (state.currentPlayer === state.myIndex ? ME : OPP);
    if (state.gameActive && holder >= 0 && gun.phase !== 'table' && state.powerActive[seatPlayer(holder)]) {
      const p = 0.75 + Math.sin(gun.bob * 6) * 0.25;
      ctx.strokeStyle = 'rgba(255,68,34,' + p.toFixed(2) + ')';
      ctx.shadowColor = 'rgba(255, 68, 34, 0.8)';
      ctx.shadowBlur = 14 * s;
      ctx.lineWidth = 3.5 * s;
      ctx.beginPath();
      ctx.arc(gun.x, gun.y - 5 * s, (31 + Math.sin(gun.bob * 6) * 3) * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (gun.phase === 'table' && state.canPickup) {
      const p = (Math.sin(gun.bob * 4) + 1) / 2;
      ctx.strokeStyle = 'rgba(255,199,94,' + (0.45 + p * 0.5).toFixed(2) + ')';
      ctx.shadowColor = 'rgba(255, 198, 94, 0.8)';
      ctx.shadowBlur = 16 * s;
      ctx.lineWidth = 2.6 * s;
      ctx.beginPath();
      ctx.arc(gun.x, gun.y, (42 + p * 7) * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      text('点击拿起枪', gun.x, gun.y + (64 + p * 4) * s, 14 * s, 'rgba(255,216,138,0.92)', { weight: 700, letterSpacing: 2 });
    }
  }

  function drawAimLine() {
    if (!state.gameScreenActive) return;
    if (gun.phase !== 'held' || gun.holder !== ME) return;
    const m = muzzlePos();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,215,130,0.22)';
    ctx.lineWidth = 1.6 * s;
    ctx.setLineDash([7 * s, 9 * s]);
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(mouse.x, mouse.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = hover === 'enemy' ? 'rgba(238, 89, 65, 0.85)' : 'rgba(255, 215, 130, 0.45)';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, (hover === 'enemy' ? 12 : 8) * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawEffects() {
    for (const e of effects) {
      const k = e.t / e.dur;
      if (e.type === 'flash') {
        const a = 1 - k;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.globalAlpha = a;
        ctx.strokeStyle = e.color || '#ffc47a';
        ctx.shadowColor = e.color || '#ffc47a';
        ctx.shadowBlur = 10 * s;
        ctx.lineWidth = 2.4 * s;
        const len = (14 + k * 26) * s;
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * 6 * s, Math.sin(ang) * 6 * s);
          ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
          ctx.stroke();
        }
        ctx.fillStyle = '#fff2d8';
        ctx.beginPath();
        ctx.arc(0, 0, 5 * s * (1 - k * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      } else if (e.type === 'tracer') {
        const prog = Math.min(1, (e.t / e.dur) * 2.6);
        const x1 = lerp(e.x, e.x2, prog);
        const y1 = lerp(e.y, e.y2, prog);
        const alpha = (1 - e.t / e.dur) * 0.9;
        ctx.save();
        ctx.globalAlpha = alpha * 0.35;
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 5 * s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ffe9b8';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x1, y1, 2.6 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (e.type === 'burst' || e.type === 'spark') {
        for (const p of e.particles) {
          if (p.life <= 0) continue;
          ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.6)) * 0.9;
          ctx.fillStyle = e.color;
          ctx.shadowColor = e.color;
          ctx.shadowBlur = 8 * s;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      } else if (e.type === 'smoke') {
        for (const p of e.particles) {
          if (p.life <= 0) continue;
          const alpha = Math.max(0, Math.min(1, p.life / p.maxLife)) * 0.22;
          const smoke = ctx.createRadialGradient(p.x - p.r * 0.25, p.y - p.r * 0.3, 1, p.x, p.y, p.r);
          smoke.addColorStop(0, 'rgba(203, 213, 198, ' + alpha.toFixed(2) + ')');
          smoke.addColorStop(1, 'rgba(47, 57, 53, 0)');
          ctx.fillStyle = smoke;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (e.type === 'ring') {
        const r = e.maxR * (0.2 + k * 0.8);
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.strokeStyle = 'rgba(' + e.rgb[0] + ',' + e.rgb[1] + ',' + e.rgb[2] + ',' + (1 - k).toFixed(2) + ')';
        ctx.lineWidth = 2.6 * s;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (e.type === 'shield') {
        const radius = (24 + k * 16) * s;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.globalAlpha = (1 - k) * 0.92;
        ctx.strokeStyle = e.color || '#8de8db';
        ctx.shadowColor = e.color || '#8de8db';
        ctx.shadowBlur = 13 * s;
        ctx.lineWidth = 2.2 * s;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = -Math.PI / 2 + i * Math.PI / 3;
          const px = Math.cos(ang) * radius;
          const py = Math.sin(ang) * radius;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha *= 0.28;
        ctx.fillStyle = e.color || '#8de8db';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      } else if (e.type === 'scan') {
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = e.color || '#a4f4dc';
        ctx.lineWidth = 1.3 * s;
        ctx.setLineDash([5 * s, 7 * s]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, tableR * (0.2 + k * 0.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(e.x - tableR * 0.58, e.y);
        ctx.lineTo(e.x + tableR * 0.58, e.y);
        ctx.moveTo(e.x, e.y - tableR * 0.4);
        ctx.lineTo(e.x, e.y + tableR * 0.4);
        ctx.stroke();
        ctx.restore();
      } else if (e.type === 'damageText') {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - k);
        text(e.label, e.x, e.y - k * 24 * s, 13 * s, e.color || '#ff8069', { weight: 800, letterSpacing: 1.5 });
        ctx.restore();
      } else if (e.type === 'shell') {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.rot);
        ctx.fillStyle = '#e8b45e';
        ctx.shadowColor = 'rgba(232, 180, 94, 0.75)';
        ctx.shadowBlur = 7 * s;
        ctx.beginPath();
        ctx.ellipse(0, 0, 6 * s, 2.6 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fff0a7';
        ctx.lineWidth = 0.8 * s;
        ctx.beginPath();
        ctx.ellipse(-1.5 * s, 0, 2.2 * s, 1 * s, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function draw() {
    if (!W || !H) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (state.gameScreenActive && shake.t > 0) {
      ctx.translate((Math.random() - 0.5) * shake.amt, (Math.random() - 0.5) * shake.amt);
    }
    drawFloor();
    drawTable();
    drawPlayer(0);
    drawPlayer(1);
    drawAimLine();
    drawGun();
    drawEffects();
    ctx.restore();
  }

  // ---------- 主循环 ----------
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 0.016);
    lastFrame = now;
    updateGun(dt);
    updateEffects(dt);
    draw();
  }

  // ---------- 初始化 ----------
  function init() {
    layout();
    gun.x = cx;
    gun.y = cy;
    gun.angle = Math.PI;
    loadAssets();

    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () { layout(); }).observe(mount);
    }
    window.addEventListener('resize', layout, { passive: true });

    requestAnimationFrame(frame);
  }

  window.Game2D = {
    sync: sync,
    shoot: triggerShot,
    reload: triggerReload,
    item: triggerItem,
    setScreen: setScreen,
    outcome: reportOutcome,
    duelResult: duelResult,
    setAssetSkin: setAssetSkin,
    setOpponentSkin: setOpponentSkin,
    onPickup: null,
    onShoot: null
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
