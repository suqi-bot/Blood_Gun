// skins.js - 外观皮肤系统：头像立绘 / 枪械 / 地图 / 牌桌
// 选择保存在 localStorage；assets/ 目录的 PNG 贴图优先级高于配色。
(function () {
  'use strict';

  const SKIN_STORAGE_KEY = 'bloodgun-skins';
  const ASSET_SKIN_KEY = 'bloodgun-asset-skin';

  // 贴图皮肤分类（对应 client/assets/skins/<分类>/ 目录）
  const ASSET_CAT_KEYS = ['gun', 'avatar', 'player', 'floor', 'table'];

  // 贴图皮肤：每类独立选择（'' = 该类用默认 assets/ 根目录）
  let assetSkinNames = {};
  let currentAssetSkin = loadAssetSkin();

  const SKINS = {
    avatar: [
      { id: 'crimson', name: '猩红', accent: '#ee6548', head: '#d2a27e', visor: '#ff8a70', back: '#0d1112', body: '#313d3b', suit: '#2d2625' },
      { id: 'teal', name: '碧青', accent: '#6bd5c5', head: '#7a6255', visor: '#b8fff4', back: '#0d1112', body: '#26413c', suit: '#172928' },
      { id: 'gold', name: '鎏金', accent: '#e0b25e', head: '#c89b6b', visor: '#ffd98a', back: '#14100a', body: '#433a26', suit: '#3a2d1d' },
      { id: 'violet', name: '暗紫', accent: '#9b7de0', head: '#8f6f92', visor: '#c9b4ff', back: '#120e1c', body: '#2c2340', suit: '#241d33' },
      { id: 'ghost', name: '幽灵', accent: '#aab8c4', head: '#b7b7b0', visor: '#dce8f2', back: '#0f1215', body: '#2e3942', suit: '#232a30' }
    ],
    gun: [
      { id: 'brass', name: '黄铜', body: '#303837', dark: '#101515', brass: '#c08a47', grip: '#6e2827', bright: '#f0c978' },
      { id: 'crimson', name: '赤焰', body: '#4a2222', dark: '#1a0a0a', brass: '#b84c3e', grip: '#7a2f22', bright: '#ff8a70' },
      { id: 'ocean', name: '深海', body: '#23414d', dark: '#0b1a20', brass: '#4aa99c', grip: '#1e4a44', bright: '#8de8db' },
      { id: 'emerald', name: '翡翠', body: '#2c4a33', dark: '#0c1a10', brass: '#6bb45e', grip: '#3d5c2e', bright: '#b8e67a' },
      { id: 'royal', name: '黑金', body: '#2a2f38', dark: '#0d1016', brass: '#d9ad67', grip: '#3a2c1c', bright: '#f2d89a' }
    ],
    floor: [
      { id: 'noir', name: '夜店', bg1: '#05080b', bg2: '#0b1113', bg3: '#030507', glow: '61,117,101', grid: '145,181,167' },
      { id: 'crimson', name: '红毯', bg1: '#0c0507', bg2: '#140a0c', bg3: '#070303', glow: '150,60,48', grid: '190,120,105' },
      { id: 'gold', name: '金殿', bg1: '#0d0903', bg2: '#171008', bg3: '#080502', glow: '160,125,55', grid: '200,170,110' },
      { id: 'abyss', name: '深渊', bg1: '#03060c', bg2: '#070d18', bg3: '#02040a', glow: '60,90,160', grid: '120,150,200' },
      { id: 'marsh', name: '幽绿', bg1: '#040a08', bg2: '#0a120e', bg3: '#020503', glow: '80,150,90', grid: '150,200,150' }
    ],
    table: [
      { id: 'classic', name: '经典绿', felt1: '#286054', felt2: '#081b1b', rail: '#8c5a32', rim: '#d9ad67', chip1: '#e2b66b', chip2: '#293331' },
      { id: 'scarlet', name: '猩红', felt1: '#6b2a24', felt2: '#1c0a08', rail: '#7a3b2a', rim: '#e0a06a', chip1: '#e0a06a', chip2: '#33201b' },
      { id: 'royal', name: '蓝金', felt1: '#2a4a6b', felt2: '#0a1620', rail: '#4a5a8c', rim: '#d9ad67', chip1: '#e2b66b', chip2: '#1c2733' },
      { id: 'obsidian', name: '黑曜石', felt1: '#3a3a3a', felt2: '#0e0e0e', rail: '#4c4c4c', rim: '#9a9a9a', chip1: '#c8c8c8', chip2: '#262626' },
      { id: 'emerald', name: '翡翠', felt1: '#1e5a3a', felt2: '#08180e', rail: '#2e6a4a', rim: '#8ec87a', chip1: '#a8d88a', chip2: '#152b1d' }
    ]
  };

  // 合并外部自定义皮肤（custom-skins.js 可选文件，见 custom-skins.example.js 模板）
  (function mergeCustomSkins() {
    const custom = window.CUSTOM_SKINS;
    if (!custom || typeof custom !== 'object') return;
    Object.keys(SKINS).forEach(function (cat) {
      const list = custom[cat];
      if (!Array.isArray(list)) return;
      list.forEach(function (s) {
        if (!s || !s.id || !s.name) return;
        if (SKINS[cat].some(function (x) { return x.id === s.id; })) return;
        SKINS[cat].push(s);
      });
    });
  })();

  const DEFAULT = {
    avatar: SKINS.avatar[0],
    gun: SKINS.gun[0],
    floor: SKINS.floor[0],
    table: SKINS.table[0]
  };

  let current = load();

  function load() {
    const out = {};
    Object.keys(DEFAULT).forEach(function (cat) {
      out[cat] = DEFAULT[cat];
    });
    try {
      const saved = JSON.parse(localStorage.getItem(SKIN_STORAGE_KEY) || '{}');
      Object.keys(DEFAULT).forEach(function (cat) {
        const id = saved[cat];
        if (!id) return;
        const found = SKINS[cat].find(function (s) { return s.id === id; });
        if (found) out[cat] = found;
      });
    } catch (e) { /* 忽略损坏的存档 */ }
    return out;
  }

  function save() {
    try {
      const ids = {};
      Object.keys(current).forEach(function (cat) { ids[cat] = current[cat].id; });
      localStorage.setItem(SKIN_STORAGE_KEY, JSON.stringify(ids));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function loadAssetSkin() {
    const def = {};
    ASSET_CAT_KEYS.forEach(function (k) { def[k] = ''; });
    def.character = ''; // 角色 = 头像 + 角色 二合一选择
    try {
      const saved = JSON.parse(localStorage.getItem(ASSET_SKIN_KEY) || '{}');
      ASSET_CAT_KEYS.forEach(function (k) {
        if (typeof saved[k] === 'string') def[k] = saved[k];
      });
      def.character = (typeof saved.character === 'string' && saved.character)
        ? saved.character
        : (def.avatar || '');
    } catch (e) { /* 忽略 */ }
    return def;
  }

  function saveAssetSkin() {
    try {
      localStorage.setItem(ASSET_SKIN_KEY, JSON.stringify(currentAssetSkin));
    } catch (e) { /* 忽略 */ }
  }

  // 从服务器拉取贴图皮肤目录列表（每类独立），并校验上次选择
  function loadAssetSkins(cb) {
    cb = cb || function () {};
    fetch('/api/skins')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        assetSkinNames = {};
        ASSET_CAT_KEYS.forEach(function (k) {
          assetSkinNames[k] = Array.isArray(data[k]) ? data[k] : [];
          if (currentAssetSkin[k] && assetSkinNames[k].indexOf(currentAssetSkin[k]) === -1) {
            currentAssetSkin[k] = '';
          }
        });
        assetSkinNames.character = assetSkinNames.avatar.slice();
        if (currentAssetSkin.character && assetSkinNames.character.indexOf(currentAssetSkin.character) === -1) {
          currentAssetSkin.character = '';
        }
        saveAssetSkin();
        window.SkinManager.assetSkinNames = assetSkinNames;
        window.SkinManager.currentAssetSkin = currentAssetSkin;
        cb(assetSkinNames);
      })
      .catch(function () {
        assetSkinNames = {};
        window.SkinManager.assetSkinNames = assetSkinNames;
        cb(assetSkinNames);
      });
  }

  // 联机时把当前角色皮肤同步给服务器（由服务器广播给对手）
  function syncSkinToMultiplayer() {
    const ws = window.GameState && window.GameState.ws;
    if (window.GameState && window.GameState.mode === 'multi' && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'set_skin', skin: currentAssetSkin.character || '' }));
    }
  }

  // 切换某个分类的贴图皮肤（'' = 该类回默认 assets/ 根目录）
  function selectAssetSkin(category, name) {
    // 角色 = 头像 + 角色 二合一选择，同步应用两个分类
    if (category === 'character') {
      currentAssetSkin.character = name || '';
      currentAssetSkin.avatar = currentAssetSkin.character;
      currentAssetSkin.player = currentAssetSkin.character;
      saveAssetSkin();
      window.SkinManager.currentAssetSkin = currentAssetSkin;
      ['avatar', 'player'].forEach(function (k) {
        if (window.Game2D && window.Game2D.setAssetSkin) {
          window.Game2D.setAssetSkin(k, currentAssetSkin[k] || null);
        }
      });
      syncSkinToMultiplayer();
      return;
    }
    if (ASSET_CAT_KEYS.indexOf(category) === -1) return;
    currentAssetSkin[category] = name || '';
    saveAssetSkin();
    window.SkinManager.currentAssetSkin = currentAssetSkin;
    if (window.Game2D && window.Game2D.setAssetSkin) {
      window.Game2D.setAssetSkin(category, currentAssetSkin[category] || null);
    }
  }

  window.SkinManager = {
    SKINS: SKINS,
    current: current,
    assetSkinNames: assetSkinNames,
    currentAssetSkin: currentAssetSkin,
    loadAssetSkins: loadAssetSkins,
    selectAssetSkin: selectAssetSkin,
    select: function (category, id) {
      const found = SKINS[category].find(function (s) { return s.id === id; });
      if (!found) return;
      current[category] = found;
      save();
      if (category === 'avatar') applyAvatarSkin(found);
    },
    selectSilent: function (category, id) {
      const found = SKINS[category].find(function (s) { return s.id === id; });
      if (!found) return;
      current[category] = found;
      if (category === 'avatar') applyAvatarSkin(found);
    }
  };

  // 将头像配色应用到 CSS 立绘（底部自己的面板）
  function applyAvatarSkin(skin) {
    const panel = document.querySelector('.player-panel');
    if (!panel) return;
    panel.style.setProperty('--card-accent', skin.accent);
    panel.style.setProperty('--skin-head', skin.head);
    panel.style.setProperty('--skin-back', skin.back);
    panel.style.setProperty('--skin-body', skin.body);
  }

  // DOM 就绪后应用已保存的头像配色，并恢复各类贴图皮肤
  function boot() {
    applyAvatarSkin(current.avatar);
    loadAssetSkins(function () {
      ASSET_CAT_KEYS.forEach(function (cat) {
        if (window.SkinManager.currentAssetSkin[cat]) {
          selectAssetSkin(cat, window.SkinManager.currentAssetSkin[cat]);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
