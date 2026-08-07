// ============================================================
//  外部自定义皮肤配置文件（可选）
// ============================================================
//  用法：
//  1. 把本文件【复制一份并改名为 custom-skins.js】放在同目录
//     （client/ 下，与 skins.js 同级）
//  2. 按下方格式填入你自己的皮肤配色（每类至少保留一组）
//  3. 刷新页面，即可在首页「外观 · 皮肤」弹窗里看到并选用
//
//  注意：
//  - 颜色一律使用 #RRGGBB 十六进制
//  - id 不能与内置皮肤重复（内置 id：crimson/teal/gold/violet/ghost、
//    brass/crimson/ocean/emerald/royal、noir/crimson/gold/abyss/marsh、
//    classic/scarlet/royal/obsidian/emerald）
//  - 删除文件后，之前选中的自定义皮肤会自动回退为默认
//
//  字段说明：
//  avatar（头像立绘，同时联动画布里的角色）
//    accent  主色（面罩 / 血条 / 回合光环）
//    head    肤色
//    visor   眼罩发光色
//    back    头像背景
//    body    衣装（CSS 头像）
//    suit    外套（画布角色）
//  gun（枪械皮肤）
//    body    枪管 / 转轮主色
//    dark    枪身暗部
//    brass   黄铜饰件
//    grip    握把
//    bright  高光 / 枪口
//  floor（地图背景）
//    bg1/bg2/bg3  背景三段渐变（上 / 中 / 下）
//    glow    中央光晕 RGB（逗号分隔数字，如 "61,117,101"）
//    grid    网格线 RGB
//  table（牌桌）
//    felt1/felt2  台呢渐变（亮 / 暗）
//    rail    桌沿
//    rim     金边 / 纹章
//    chip1/chip2  筹码双色
// ============================================================

window.CUSTOM_SKINS = {
  avatar: [
    // { id: 'my_hero', name: '我的英雄', accent: '#00ff88', head: '#e8b890', visor: '#88ffd0', back: '#081210', body: '#14403a', suit: '#0e2a26' }
  ],
  gun: [
    // { id: 'my_gun', name: '我的枪', body: '#8a5a2a', dark: '#3a2410', brass: '#ffd27a', grip: '#5a3a1a', bright: '#ffe9b0' }
  ],
  floor: [
    // { id: 'my_floor', name: '我的地图', bg1: '#020608', bg2: '#06121a', bg3: '#010306', glow: '40,120,180', grid: '90,140,190' }
  ],
  table: [
    // { id: 'my_table', name: '我的牌桌', felt1: '#0f5a5a', felt2: '#042020', rail: '#b08040', rim: '#ffd27a', chip1: '#ffd27a', chip2: '#1a3a38' }
  ]
};
