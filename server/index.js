const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;

// 获取局域网IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// 创建HTTP服务器用于提供静态文件
const server = http.createServer((req, res) => {
  let requestPath = new URL(req.url, 'http://localhost').pathname;
  try {
    requestPath = decodeURIComponent(requestPath);
  } catch (e) { /* 非法编码，保持原样 */ }

  // 贴图皮肤列表接口：返回 client/assets/skins/<分类>/<皮肤名>/ 的目录结构
  if (requestPath === '/api/skins') {
    const skinsRoot = path.join(__dirname, '..', 'client', 'assets', 'skins');
    fs.readdir(skinsRoot, { withFileTypes: true }, (err, catEntries) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      const cats = catEntries.filter((e) => e.isDirectory()).map((e) => e.name);
      const result = {};
      let pending = cats.length;
      if (!pending) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      cats.forEach((cat) => {
        const catDir = path.join(skinsRoot, cat);
        fs.readdir(catDir, { withFileTypes: true }, (err2, skinEntries) => {
          result[cat] = err2
            ? []
            : skinEntries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
          if (--pending === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          }
        });
      });
    });
    return;
  }

  const clientRoot = path.join(__dirname, '..', 'client');
  const filePath = path.join(clientRoot, requestPath === '/' ? 'index.html' : requestPath);

  const extname = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = contentTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

const wss = new WebSocket.Server({ server });

// 房间管理
const rooms = new Map();

// 游戏逻辑
const ITEM_TYPES = ['peek', 'shield', 'eject', 'power'];
const GAMBLE_ITEM_TYPES = ['peek', 'shield', 'eject', 'power', 'duel', 'persona', 'lifedeath']; // 赌局抽取池（对决/人格面具/生死弹卡片）
const ITEM_NAMES = { peek: '看破', shield: '护盾', eject: '退蛋', power: '双倍威力', duel: '对决', persona: '人格面具', orpheus: '俄耳甫斯', lifedeath: '生死弹' };

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.mode = 'normal'; // normal 普通模式 / gamble 赌局模式
    this.players = [];
    this.duel = null; // 对决状态
    this.duelTimer = null; // 对决超时定时器
    this.lifeDeath = null; // 生死弹：{ user, effect } 效果对对手保密
    this.state = 'waiting'; // waiting, playing, finished
    this.bullets = [];
    this.totalBullets = 6;
    this.currentBulletIndex = 0;
    this.currentPlayer = 0;
    this.playerHealth = [2, 2];
    this.playerItems = [[], []];
    this.shieldUsed = [false, false];
    this.powerActive = [false, false];
    this.itemCounts = { peek: 1, shield: 1, eject: 1, power: 1 };
    this.startHealth = 2;
    this.gameLog = [];
    this.lastActivity = Date.now();
    this.createdAt = Date.now();
  }

  addPlayer(ws, playerName, skin) {
    if (this.players.length >= 2) return false;
    const playerIndex = this.players.length;
    this.players.push({ ws, playerName, index: playerIndex, skin: skin || '' });
    return playerIndex;
  }

  removePlayer(playerIndex) {
    this.players = this.players.filter(p => p.index !== playerIndex);
    if (this.players.length === 0) {
      this.state = 'finished';
    }
  }

  // 初始化游戏
  initGame() {
    // 随机生成子弹：实弹与空弹数量相差不超过1，总数4~6发
    this.currentPlayer = Math.floor(Math.random() * 2);
    this.playerHealth = [this.startHealth, this.startHealth];
    this.shieldUsed = [false, false];
    this.powerActive = [false, false];
    this.gameLog = [];

    // 道具：普通模式按配置生成；赌局模式为空卡槽（换弹时抽取）
    if (this.mode === 'gamble') {
      this.playerItems = [[], []];
    } else {
      this.playerItems = [
        this.buildItems(this.itemCounts),
        this.buildItems(this.itemCounts)
      ];
    }
    this.gambleDrawn = [[], []];

    // 重新装填子弹（赌局模式装填后触发抽道具）
    this.duel = null;
    this.lifeDeath = null;
    if (this.duelTimer) {
      clearTimeout(this.duelTimer);
      this.duelTimer = null;
    }
    this.reloadBullets();

    this.state = 'playing';
    this.lastActivity = Date.now();

    // 通知双方游戏开始
    this.broadcastState('game_start', this.getAmmoCounts());
  }

  // 赌局模式：为某玩家抽取 2 个新道具（可重复；最多持有 4 张，超出不再抽取）
  drawGambleItems(playerIndex) {
    if (this.mode !== 'gamble') return;
    const items = this.playerItems[playerIndex];
    if (!Array.isArray(items)) return;
    const types = GAMBLE_ITEM_TYPES.slice();
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    const name = (this.players[playerIndex] && this.players[playerIndex].playerName) || '玩家';
    let drawn = 0;
    types.forEach((t) => {
      if (drawn >= 2) return;
      if (items.length >= 4) return; // 最多 4 张，超出不再抽取
      items.push(t);
      this.gambleDrawn[playerIndex].push(t);
      drawn++;
      this.gameLog.push(`${name} 抽到了【${ITEM_NAMES[t]}】`);
    });
    if (drawn === 0) {
      this.gameLog.push(`${name} 卡槽已满（4 张），无法抽取道具`);
    }
  }

  // 重新装填子弹：随机总数(4~6发)，实弹与空弹数量相差不超过1
  reloadBullets() {
    const total = 4 + Math.floor(Math.random() * 3);
    const liveCount = Math.random() < 0.5 ? Math.floor(total / 2) : Math.ceil(total / 2);
    this.bullets = new Array(total).fill(0);
    const indices = Array.from({ length: total }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < liveCount; i++) {
      this.bullets[indices[i]] = 1;
    }
    this.currentBulletIndex = 0;
    this.totalBullets = total;
    this.lifeDeath = null; // 换弹清空未结算的生死弹

    // 赌局模式：每次换弹双方各抽取 2 个道具
    if (this.mode === 'gamble' && this.playerItems[0] && this.playerItems[1]) {
    this.gambleDrawn = [[], []];
    this.personaPending = [false, false]; // 人格面具：本回合必须对自己射击
    this.extraTurn = [false, false];      // 俄耳甫斯：连续行动两个回合
      this.drawGambleItems(0);
      this.drawGambleItems(1);
    }
  }

  getAmmoCounts() {
    const live = this.bullets.filter(b => b === 1).length;
    const empty = this.bullets.filter(b => b === 0).length;
    return { ammoLive: live, ammoEmpty: empty };
  }

  buildItems(counts) {
    const items = [];
    for (const type of ['peek', 'shield', 'eject', 'power']) {
      const count = Math.max(0, Math.min(3, Math.round(Number(counts && counts[type]) || 0)));
      for (let i = 0; i < count; i++) {
        items.push(type);
      }
    }
    return items;
  }

  // 开枪（aimed：是否瞄准了目标；未瞄准则打偏，不造成伤害并轮换回合）
  shoot(playerIndex, target, aimed) {
    if (this.state !== 'playing') return;
    if (this.duel && this.duel.active) return;
    if (playerIndex !== this.currentPlayer) return;

    // 生死弹：出牌者压入子弹后枪交给对手，对手必须射击（自行选择目标，不知效果）
    if (this.lifeDeath && this.lifeDeath.user !== playerIndex) {
      const ld = this.lifeDeath;
      this.lifeDeath = null;
      const bullet = this.bullets[this.currentBulletIndex];
      this.currentBulletIndex++;

      const atSelf = target === 'self';
      const victim = atSelf ? playerIndex : 1 - playerIndex;
      const name = this.players[playerIndex].playerName;
      let result;

      if (!aimed) {
        // 未瞄准：生死弹打偏，效果落空
        result = { type: 'miss_aim', shooter: playerIndex, target: target || null, bullet: 'lifedeath' };
        this.gameLog.push(`${name} 没有瞄准，生死弹打偏了！效果落空`);
      } else if (ld.effect === 'life') {
        // 生：被射中者回复 1 点生命（不超过上限）
        const before = this.playerHealth[victim];
        this.playerHealth[victim] = Math.min(this.startHealth, this.playerHealth[victim] + 1);
        const healed = this.playerHealth[victim] - before;
        result = { type: 'lifedeath', shooter: playerIndex, target, victim, effect: 'life', amount: healed, damage: 0 };
        this.gameLog.push(`${name} 射出生死弹【生】！${this.players[victim].playerName} 回复 ${healed} 点生命`);
      } else {
        // 死：被射中者损失 1 点生命
        this.playerHealth[victim] -= 1;
        result = { type: 'lifedeath', shooter: playerIndex, target, victim, effect: 'death', amount: 1, damage: 1 };
        this.gameLog.push(`${name} 射出生死弹【死】！${this.players[victim].playerName} 受到 1 点伤害`);
      }

      this.currentPlayer = ld.user; // 回合回到出牌者
      this.powerActive[playerIndex] = false;

      // 检查游戏是否结束（优先：子弹刚好打空又有人死亡，直接结算，不再装填过回合）
      if (this.playerHealth[0] <= 0 || this.playerHealth[1] <= 0) {
        this.state = 'finished';
        const winner = this.playerHealth[0] <= 0 ? 1 : 0;
        result.gameOver = true;
        result.winner = winner;
        this.gameLog.push(`游戏结束！${this.players[winner].playerName} 获胜！`);
      } else {
        // 子弹打完进入下一循环：重新装填
        if (this.currentBulletIndex >= this.bullets.length) {
          this.reloadBullets();
          result.reloaded = true;
          Object.assign(result, this.getAmmoCounts());
          this.gameLog.push('子弹已打完，重新装填！');
        }
        result.nextPlayer = this.currentPlayer;
      }

      this.lastActivity = Date.now();
      result.detail = result.type;
      this.broadcastState('shoot', result);
      return result;
    }

    // 人格面具：记录本次开枪时是否生效（本回合内必须对自己射击一次）
    const personaShot = this.personaPending[playerIndex];

    const bullet = this.bullets[this.currentBulletIndex];
    this.currentBulletIndex++;

    const atSelf = target === 'self';
    const victim = atSelf ? playerIndex : 1 - playerIndex;
    let result;

    if (!aimed) {
      // 未瞄准：子弹打偏，不造成伤害，回合轮换
      result = { type: 'miss_aim', shooter: playerIndex, target: target || null, bullet: bullet === 1 ? 'live' : 'empty' };
      this.currentPlayer = this.maybeExtraTurn(playerIndex);
      if (bullet === 1) {
        this.gameLog.push(`${this.players[playerIndex].playerName} 没有瞄准，实弹打偏了！没有造成伤害`);
      } else {
        this.gameLog.push(`${this.players[playerIndex].playerName} 没有瞄准，空弹打偏了！`);
      }
    } else if (bullet === 1) {
      // 命中实弹：扣血后轮到对方回合
      const double = this.powerActive[playerIndex];
      if (this.shieldUsed[victim]) {
        this.shieldUsed[victim] = false;
        if (double) {
          // 双倍威力击穿护盾：护盾失效，仍受1点伤害
          this.powerActive[playerIndex] = false;
          this.playerHealth[victim]--;
          result = { type: 'hit', shooter: playerIndex, target, damage: 1, double: true, shieldBroken: true };
          if (atSelf) {
            this.gameLog.push(`${this.players[playerIndex].playerName} 对自己开枪，双倍威力击穿了护盾！-1HP`);
          } else {
            this.gameLog.push(`${this.players[playerIndex].playerName} 对 ${this.players[victim].playerName} 开枪，双倍威力击穿了护盾！-1HP`);
          }
        } else {
          result = { type: 'shield_block', shooter: playerIndex, target };
          if (atSelf) {
            this.gameLog.push(`${this.players[playerIndex].playerName} 对自己开枪，护盾抵挡了伤害！`);
          } else {
            this.gameLog.push(`${this.players[playerIndex].playerName} 对 ${this.players[victim].playerName} 开枪，护盾抵挡了伤害！`);
          }
        }
      } else {
        const damage = double ? 2 : 1;
        if (double) this.powerActive[playerIndex] = false;
        this.playerHealth[victim] -= damage;
        result = { type: 'hit', shooter: playerIndex, target, damage, double };
        if (atSelf) {
          this.gameLog.push(`${this.players[playerIndex].playerName} 对自己开枪，命中实弹！-${damage}HP`);
        } else {
          this.gameLog.push(`${this.players[playerIndex].playerName} 对 ${this.players[victim].playerName} 开枪，命中实弹！-${damage}HP`);
        }
      }
      this.currentPlayer = this.maybeExtraTurn(playerIndex);
    } else {
      // 空弹：对自己开枪则继续自己回合，对对方开枪则轮到对方
      result = { type: 'miss', shooter: playerIndex, target };
      if (atSelf) {
        this.currentPlayer = playerIndex;
        this.gameLog.push(`${this.players[playerIndex].playerName} 对自己开枪，空弹！继续自己的回合`);
        // 人格面具：空弹获得俄耳甫斯（卡槽未满时）
        if (personaShot) {
          this.personaPending[playerIndex] = false;
          if (this.playerItems[playerIndex].length < 4) {
            this.playerItems[playerIndex].push('orpheus');
            result.gotOrpheus = true;
            this.gameLog.push(`${this.players[playerIndex].playerName} 空弹！获得【俄耳甫斯】`);
          } else {
            result.orpheusBlocked = true;
            this.gameLog.push(`${this.players[playerIndex].playerName} 空弹！但卡槽已满，无法获得俄耳甫斯`);
          }
        }
      } else {
        this.currentPlayer = this.maybeExtraTurn(playerIndex);
        this.gameLog.push(`${this.players[playerIndex].playerName} 对 ${this.players[1 - playerIndex].playerName} 开枪，空弹！`);
      }
    }

    // 人格面具：实弹命中自己时解除（已完成自射）；打偏不算自射
    if (personaShot && bullet === 1 && atSelf) {
      this.personaPending[playerIndex] = false;
    }

    // 人格面具：本回合未对自己射击（回合轮换）→ 卡片失效
    if (personaShot && this.personaPending[playerIndex] && this.currentPlayer !== playerIndex) {
      this.personaPending[playerIndex] = false;
      this.gameLog.push(`${this.players[playerIndex].playerName} 人格面具失效：本回合未对自己射击`);
    }

    // 双倍威力仅在自己回合内生效：回合结束未吃到实弹则效果作废
    if (this.currentPlayer !== playerIndex) {
      this.powerActive[playerIndex] = false;
    }

    // 检查游戏是否结束（优先：子弹刚好打空又有人死亡，直接结算，不再装填过回合）
    if (this.playerHealth[0] <= 0 || this.playerHealth[1] <= 0) {
      this.state = 'finished';
      const winner = this.playerHealth[0] <= 0 ? 1 : 0;
      result.gameOver = true;
      result.winner = winner;
      this.gameLog.push(`游戏结束！${this.players[winner].playerName} 获胜！`);
    } else {
      // 子弹打完进入下一循环：重新装填
      if (this.currentBulletIndex >= this.bullets.length) {
        this.reloadBullets();
        result.reloaded = true;
        Object.assign(result, this.getAmmoCounts());
        this.gameLog.push('子弹已打完，重新装填！');
      }
      result.nextPlayer = this.currentPlayer;
    }

    this.lastActivity = Date.now();
    result.detail = result.type;
    this.broadcastState('shoot', result);
    return result;
  }

  // 俄耳甫斯：本应轮换回合时触发，连续行动两个回合（不轮换）
  maybeExtraTurn(playerIndex) {
    if (this.extraTurn[playerIndex]) {
      this.extraTurn[playerIndex] = false;
      this.gameLog.push(`${this.players[playerIndex].playerName} 触发俄耳甫斯，连续行动两个回合！`);
      return playerIndex;
    }
    return 1 - playerIndex;
  }

  // 使用道具
  useItem(playerIndex, itemType, itemEffect) {
    if (this.state !== 'playing') return null;
    if (this.duel && this.duel.active) return null;
    if (this.lifeDeath) return null; // 生死弹已上膛，对手必须射击，不能使用道具
    if (playerIndex !== this.currentPlayer) return null;

    const itemIndex = this.playerItems[playerIndex].indexOf(itemType);
    if (itemIndex === -1) return null;

    this.playerItems[playerIndex].splice(itemIndex, 1);
    let result;

    switch (itemType) {
      case 'peek':
        const nextBullet = this.bullets[this.currentBulletIndex];
        result = { type: 'peek', shooter: playerIndex, bullet: nextBullet === 1 ? 'live' : 'empty' };
        this.gameLog.push(`${this.players[playerIndex].playerName} 使用了看破`);
        break;

      case 'power':
        // 双倍威力：自己下一发实弹伤害翻倍，仅在自己回合内生效
        this.powerActive[playerIndex] = true;
        result = { type: 'power', shooter: playerIndex };
        this.gameLog.push(`${this.players[playerIndex].playerName} 使用了双倍威力，下一发实弹伤害翻倍！`);
        break;

      case 'shield':
        this.shieldUsed[playerIndex] = true;
        result = { type: 'shield', shooter: playerIndex };
        this.gameLog.push(`${this.players[playerIndex].playerName} 使用了护盾`);
        break;

      case 'eject':
        // 退蛋：主动退出当前一发子弹，不造成伤害，继续自己的回合
        const ejectedBullet = this.bullets[this.currentBulletIndex];
        this.currentBulletIndex++;
        result = { type: 'eject', shooter: playerIndex, bullet: ejectedBullet === 1 ? 'live' : 'empty' };
        this.currentPlayer = playerIndex;
        this.gameLog.push(`${this.players[playerIndex].playerName} 使用了退蛋，退出${ejectedBullet === 1 ? '实弹' : '空弹'}！`);

        // 子弹打完进入下一循环：重新装填
        if (this.currentBulletIndex >= this.bullets.length) {
          this.reloadBullets();
          result.reloaded = true;
          Object.assign(result, this.getAmmoCounts());
          this.gameLog.push('子弹已打完，重新装填！');
        }
        break;

      case 'duel':
        // 对决卡片：消耗卡片，广播使用后进入对决流程
        result = { type: 'duel', shooter: playerIndex };
        this.gameLog.push(`${this.players[playerIndex].playerName} 使用了对决卡片，进入对决！`);
        break;

      case 'persona':
        // 人格面具：本回合必须瞄准自己射击，空弹获得俄耳甫斯
        this.personaPending[playerIndex] = true;
        result = { type: 'persona', shooter: playerIndex };
        this.gameLog.push(`${this.players[playerIndex].playerName} 使用人格面具，本回合必须对自己射击一次`);
        break;

      case 'orpheus':
        // 俄耳甫斯：连续行动两个回合
        this.extraTurn[playerIndex] = true;
        result = { type: 'orpheus', shooter: playerIndex };
        this.gameLog.push(`${this.players[playerIndex].playerName} 使用俄耳甫斯，可以连续行动两个回合！`);
        break;

      case 'lifedeath':
        // 生死弹：秘密选择生/死（对手不知），压入一颗生死子弹并把枪交给对手
        const ldEffect = itemEffect === 'death' ? 'death' : 'life';
        this.lifeDeath = { user: playerIndex, effect: ldEffect };
        this.bullets.splice(this.currentBulletIndex, 0, 2); // 压入生死子弹（值 2），下一发必射它
        this.totalBullets = this.bullets.length;
        this.currentPlayer = 1 - playerIndex; // 枪交给对手
        this.powerActive[playerIndex] = false;
        result = { type: 'lifedeath', shooter: playerIndex };
        this.gameLog.push(`${this.players[playerIndex].playerName} 使用了生死弹，压入一颗子弹并把枪交给了对手！`);
        break;
    }

    this.lastActivity = Date.now();
    result.detail = result.type;
    this.broadcastState('use_item', result);
    if (itemType === 'duel') {
      this.startDuel(playerIndex);
    }
    return result;
  }

  // 发起对决：3 秒倒计时 → 随机等待 3~10 秒 → 射击开放（先开枪者胜）
  startDuel(playerIndex) {
    if (this.duel && this.duel.active) return false;
    const readyAt = Date.now() + 3000;                       // 倒计时结束
    const waitLen = 3000 + Math.floor(Math.random() * 7001); // 等待期 3~10 秒
    const fireAt = readyAt + waitLen;                        // 射击开放时刻
    const endAt = fireAt + 8000;                             // 开放后 8 秒无人开枪 → 平局兜底
    this.duel = {
      active: true,
      user: playerIndex,
      readyAt,
      fireAt,
      endAt,
      settled: false
    };
    // 射击开放后长时间无人开枪：平局
    this.duelTimer = setTimeout(() => {
      if (this.duel && this.duel.active && !this.duel.settled) {
        this.duel.settled = true;
        const d = this.duel;
        this.duel = null;
        this.gameLog.push('对决僵持，无人开枪，平局！');
        this.currentPlayer = d.user; // 回合留在发起者
        this.lastActivity = Date.now();
        this.broadcastState('duel_timeout', {});
      }
    }, endAt - Date.now() + 300);
    this.gameLog.push('对决开始：倒计时 3 秒，等待射击信号 3~10 秒！');
    this.lastActivity = Date.now();
    this.broadcastState('duel_start', { duelUser: playerIndex, readyAt, fireAt, endAt: this.duel.endAt, serverTime: Date.now() });
    return true;
  }

  // 对决中开枪：射击开放前开火 = 提前开火自损 1 血；开放后先开枪者胜
  duelShoot(playerIndex) {
    const duel = this.duel;
    if (!duel || !duel.active || duel.settled) return;
    const now = Date.now();
    const name = (this.players[playerIndex] && this.players[playerIndex].playerName) || '玩家';

    if (now < duel.fireAt) {
      // 提前开火（倒计时或等待期）：自己扣血，回合仍留在发起者
      duel.settled = true;
      this.duel = null;
      if (this.duelTimer) {
        clearTimeout(this.duelTimer);
        this.duelTimer = null;
      }
      const damage = 1;
      this.playerHealth[playerIndex] -= damage;
      this.gameLog.push(`${name} 提前开火！自己承受了 ${damage} 点伤害`);
      this.currentPlayer = duel.user;
      const result = { type: 'duel_result', earlyFire: true, loser: playerIndex, winner: 1 - playerIndex, damage, gameOver: false };
      this.finishDuelIfDead(result);
      return;
    }

    // 射击开放阶段：最先扣动扳机者获胜，回合仍留在发起者（子弹不消耗）
    duel.settled = true;
    this.duel = null;
    if (this.duelTimer) {
      clearTimeout(this.duelTimer);
      this.duelTimer = null;
    }
    const winner = playerIndex;
    const victim = 1 - playerIndex;
    let damage = 1;
    if (this.powerActive[winner]) damage *= 2;
    if (this.powerActive[victim]) damage *= 2; // 双方都激活双倍威力：伤害×4（上限 4）
    damage = Math.min(damage, 4);
    this.powerActive[0] = false;
    this.powerActive[1] = false;
    this.playerHealth[victim] -= damage;
    this.gameLog.push(`${name} 在对决中率先开枪，赢得对决！${this.players[victim].playerName} -${damage}HP`);
    this.currentPlayer = duel.user;
    const result = { type: 'duel_result', winner, loser: victim, damage, earlyFire: false, gameOver: false };
    this.finishDuelIfDead(result);
  }

  // 对决伤害结算后检查死亡
  finishDuelIfDead(result) {
    if (this.playerHealth[0] <= 0 || this.playerHealth[1] <= 0) {
      this.state = 'finished';
      result.gameOver = true;
      result.winner = this.playerHealth[0] <= 0 ? 1 : 0;
      this.gameLog.push(`游戏结束！${this.players[result.winner].playerName} 获胜！`);
    }
    this.lastActivity = Date.now();
    this.broadcastState('duel_result', result);
  }

  // 广播游戏状态
  broadcastState(event, extra = {}) {
    const state = {
      type: event,
      event,
      roomId: this.roomId,
      state: this.state,
      gameMode: this.mode,
      currentPlayer: this.currentPlayer,
      playerHealth: this.playerHealth,
      playerItems: this.playerItems,
      shieldUsed: this.shieldUsed,
      powerActive: this.powerActive,
      itemCounts: this.itemCounts,
      startHealth: this.startHealth,
      bulletsRemaining: this.totalBullets - this.currentBulletIndex,
      gambleDrawn: this.mode === 'gamble' && this.gambleDrawn ? this.gambleDrawn : null,
      lifeDeathPending: !!this.lifeDeath,
      gameLog: this.gameLog.slice(-10), // 只发送最近10条
      ...extra,
      type: event
    };

    this.players.forEach((player, index) => {
      if (player.ws.readyState === WebSocket.OPEN) {
        const playerState = {
          ...state,
          playerIndex: index,
          playerName: this.players[index].playerName
        };
        player.ws.send(JSON.stringify(playerState));
      }
    });
  }

  // 发送消息给特定玩家
  sendToPlayer(playerIndex, data) {
    const player = this.players[playerIndex];
    if (player && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(data));
    }
  }
}

// WebSocket连接处理
wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerIndex = -1;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'create_room':
          const roomId = generateRoomId();
          const room = new GameRoom(roomId);
          room.mode = data.mode === 'gamble' ? 'gamble' : 'normal';
          room.itemCounts = {};
          for (const type of ['peek', 'shield', 'eject', 'power']) {
            room.itemCounts[type] = Math.max(0, Math.min(3, Math.round(Number(data.itemCounts && data.itemCounts[type]) || 0)));
          }
          room.startHealth = Math.max(1, Math.min(5, Number(data.startHealth) || 2));
          rooms.set(roomId, room);

          playerIndex = room.addPlayer(ws, data.playerName || '玩家1', data.skin);
          currentRoom = room;

          ws.send(JSON.stringify({
            type: 'room_created',
            roomId,
            playerIndex,
            playerName: data.playerName || '玩家1'
          }));
          break;

        case 'join_room':
          const joinRoom = rooms.get(data.roomId);
          if (!joinRoom) {
            ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
            return;
          }
          if (joinRoom.players.length >= 2) {
            ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
            return;
          }

          playerIndex = joinRoom.addPlayer(ws, data.playerName || '玩家2', data.skin);
          currentRoom = joinRoom;

          ws.send(JSON.stringify({
            type: 'room_joined',
            roomId: data.roomId,
            playerIndex,
            playerName: data.playerName || '玩家2'
          }));

          // 两人到齐，自动开始游戏，并同步双方角色皮肤
          if (joinRoom.players.length === 2) {
            joinRoom.players.forEach((p) => {
              joinRoom.broadcastState('player_skin', { skinOwner: p.index, skin: p.skin || '' });
            });
            joinRoom.initGame();
          }
          break;

        case 'list_rooms':
          // 返回所有等待中的房间
          const openRooms = [];
          rooms.forEach((room) => {
            if (room.players.length < 2 && room.state === 'waiting') {
              let totalItems = 0;
              for (const type of ['peek', 'shield', 'eject', 'power']) {
                totalItems += Math.max(0, Math.min(3, Math.round(Number(room.itemCounts[type]) || 0)));
              }
          openRooms.push({
            roomId: room.roomId,
            hostName: room.players[0] ? room.players[0].playerName : '房主',
            mode: room.mode,
            itemCounts: room.itemCounts,
            totalItems,
            startHealth: room.startHealth,
            createdAt: room.createdAt
          });
            }
          });
          openRooms.sort((a, b) => a.createdAt - b.createdAt);
          ws.send(JSON.stringify({ type: 'rooms_list', rooms: openRooms }));
          break;

        case 'shoot':
          if (currentRoom && playerIndex >= 0) {
            currentRoom.shoot(playerIndex, data.target, data.aimed !== false);
          }
          break;

        case 'use_item':
          if (currentRoom && playerIndex >= 0) {
            currentRoom.useItem(playerIndex, data.item, data.effect);
          }
          break;

        case 'duel_shoot':
          if (currentRoom && playerIndex >= 0) {
            currentRoom.duelShoot(playerIndex);
          }
          break;

        case 'set_skin':
          if (currentRoom && playerIndex >= 0) {
            currentRoom.players[playerIndex].skin = typeof data.skin === 'string' ? data.skin : '';
            currentRoom.broadcastState('player_skin', { skinOwner: playerIndex, skin: currentRoom.players[playerIndex].skin });
          }
          break;

        case 'restart':
          if (currentRoom && currentRoom.players.length === 2) {
            currentRoom.initGame();
          }
          break;
      }
    } catch (e) {
      console.error('Message parse error:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.removePlayer(playerIndex);
      if (currentRoom.state === 'playing') {
        currentRoom.state = 'finished';
        const winner = 1 - playerIndex;
        currentRoom.broadcastState('player_left', { winner });
      }
    }
  });
});

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 清理空房间
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.players.length === 0 && now - room.lastActivity > 300000) {
      rooms.delete(id);
    }
  }
}, 60000);

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`==========================================`);
  console.log(`  恶魔轮盘 游戏服务器已启动`);
  console.log(`==========================================`);
  console.log(`  本地访问: http://localhost:${PORT}`);
  console.log(`  局域网访问: http://${localIP}:${PORT}`);
  console.log(`==========================================`);
});
