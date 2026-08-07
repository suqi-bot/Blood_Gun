// 游戏状态
const GameState = {
  mode: null, // 'single' or 'multi'
  ws: null,
  roomId: null,
  playerIndex: -1,
  playerName: '',
  currentPlayer: -1,
  playerHealth: [2, 2],
  playerItems: [[], []],
  shieldUsed: [false, false],
  powerActive: [false, false],
  itemCounts: { peek: 1, shield: 1, eject: 1, power: 1 },
  gameMode: 'normal', // 'normal' 普通模式 / 'gamble' 赌局模式（仅联机）
  startHealth: 2,
  bulletsRemaining: 6,
  bullets: [],
  totalBullets: 6,
  currentBulletIndex: 0,
  gameLog: [],
  selectedItems: [],
  isMyTurn: false,
  gameActive: false,
  revealingAmmo: false,
  gunPicked: false, // 2D模式：是否已拿起桌上的枪
  duelActive: false, // 对决进行中
  duelPhase: null, // 'countdown' | 'showdown'
  duelUser: -1,
  personaPending: false, // 人格面具：本回合必须对自己射击

  // 单人模式AI相关
  aiItems: [],
  aiShieldUsed: false,
  roomList: [],
  roomListTimer: null
};

// 单人模式游戏逻辑
const SinglePlayerGame = {
  // 初始化单人游戏
  init() {
    GameState.mode = 'single';
    GameState.gameMode = 'normal';
    GameState.playerIndex = 0;
    GameState.currentPlayer = Math.floor(Math.random() * 2);
    GameState.playerHealth = [GameState.startHealth, GameState.startHealth];
    GameState.shieldUsed = [false, false];
    GameState.powerActive = [false, false];
    GameState.gameLog = [];
    GameState.selectedItems = [];
    GameState.gameActive = true;
    GameState.gunPicked = false;

    // 生成子弹
    this.reloadBullets();

    // 分配道具（按配置生成）
    const items = this.buildItems();
    GameState.playerItems = [[...items], [...items]];
    GameState.aiItems = GameState.playerItems[1];
    GameState.aiShieldUsed = false;

    // 显示游戏界面
    showScreen('game-screen');
    this.addLog('游戏开始！');

    // 展示本局弹药数量并装填
    const counts = this.getAmmoCounts();
    showAmmoReveal(counts.live, counts.empty, () => this.beginNextTurn());
  },

  // 重新装填子弹：随机总数(4~6发)，实弹与空弹数量相差不超过1
  reloadBullets() {
    const total = 4 + Math.floor(Math.random() * 3);
    const liveCount = Math.random() < 0.5 ? Math.floor(total / 2) : Math.ceil(total / 2);
    GameState.bullets = new Array(total).fill(0);
    const indices = Array.from({ length: total }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < liveCount; i++) {
      GameState.bullets[indices[i]] = 1;
    }
    GameState.currentBulletIndex = 0;
    GameState.totalBullets = total;
    GameState.bulletsRemaining = total;
  },

  // 获取本局弹药数量
  getAmmoCounts() {
    const live = GameState.bullets.filter(b => b === 1).length;
    return { live, empty: GameState.totalBullets - live };
  },

  // 装填展示结束后继续回合流程
  continueAfterReload(needReload) {
    if (needReload) {
      const counts = this.getAmmoCounts();
      showAmmoReveal(counts.live, counts.empty, () => this.beginNextTurn());
    } else {
      this.beginNextTurn();
    }
  },

  // 开启下一回合
  beginNextTurn() {
    if (!GameState.gameActive) return;
    if (GameState.currentPlayer === 1) {
      this.addLog('AI的回合');
      setTimeout(() => this.aiTurn(), 1500);
    } else {
      this.addLog('你的回合');
    }
    this.updateUI();
  },

  buildItems() {
    const items = [];
    ITEM_TYPES.forEach(type => {
      const count = Math.max(0, Math.min(3, Number(GameState.itemCounts[type]) || 0));
      for (let i = 0; i < count; i++) {
        items.push(type);
      }
    });
    return items;
  },

  // 开枪（aimed：是否瞄准了目标；未瞄准则打偏）
  shoot(target, aimed) {
    if (!GameState.gameActive || GameState.revealingAmmo || GameState.currentPlayer !== 0) return;

    const bullet = GameState.bullets[GameState.currentBulletIndex];
    GameState.currentBulletIndex++;
    GameState.bulletsRemaining--;

    const atSelf = target === 'self';
    const victim = atSelf ? 0 : 1;
    const double = bullet === 1 && GameState.powerActive[0];
    const hadShield = bullet === 1 && GameState.shieldUsed[victim];

    if (!aimed) {
      // 未瞄准：子弹打偏，不造成伤害，回合轮换
      if (bullet === 1) {
        this.addLog('你没有瞄准，实弹打偏了！没有造成伤害');
        showToast('打偏了！实弹落空');
      } else {
        this.addLog('你没有瞄准，空弹打偏了！');
        showToast('打偏了！');
      }
      GameState.currentPlayer = 1;
    } else if (bullet === 1) {
      // 命中实弹：扣血后轮到对方回合
      if (GameState.shieldUsed[victim]) {
        GameState.shieldUsed[victim] = false;
        if (double) {
          // 双倍威力击穿护盾：护盾失效，仍受1点伤害
          GameState.powerActive[0] = false;
          GameState.playerHealth[victim]--;
          this.addLog(atSelf ? '你对自己开枪，双倍威力击穿了护盾！-1HP' : '你对AI开枪，双倍威力击穿了护盾！-1HP');
          showToast('双倍威力击穿了护盾！-1HP');
        } else {
          this.addLog(atSelf ? '你对自己开枪，护盾抵挡了伤害！' : '你对AI开枪，护盾抵挡了伤害！');
          showToast('护盾抵挡了伤害！');
        }
      } else {
        const damage = double ? 2 : 1;
        if (double) GameState.powerActive[0] = false;
        GameState.playerHealth[victim] -= damage;
        this.addLog(atSelf ? `你对自己开枪，命中实弹！-${damage}HP` : `你对AI开枪，命中实弹！-${damage}HP`);
        showToast(`命中实弹！-${damage}HP`);
      }
      GameState.currentPlayer = 1;
    } else {
      // 空弹：对自己开枪则继续自己回合，对对方开枪则轮到对方
      if (atSelf) {
        this.addLog('你对自己开枪，空弹！继续你的回合');
        showToast('空弹！安全~');
        GameState.currentPlayer = 0;
      } else {
        this.addLog('你对AI开枪，空弹！');
        showToast('空弹！');
        GameState.currentPlayer = 1;
      }
    }

    // 双倍威力仅在自己回合内生效：回合结束未吃到实弹则效果作废
    if (GameState.currentPlayer !== 0) {
      GameState.powerActive[0] = false;
    }

    // 检查游戏结束（优先：子弹刚好打空又有人死亡，直接结算，不再装填过回合）
    if (GameState.playerHealth[0] <= 0 || GameState.playerHealth[1] <= 0) {
      GameState.gameActive = false;
      const winner = GameState.playerHealth[0] <= 0 ? 1 : 0;
      this.addLog(winner === 0 ? '你获胜了！' : 'AI获胜了！');
      setTimeout(() => showResult(winner === 0), 1500);
    } else {
      // 子弹打完进入下一循环：重新装填
      const needReload = GameState.currentBulletIndex >= GameState.totalBullets;
      if (needReload) {
        this.reloadBullets();
        this.addLog('子弹已打完，重新装填！');
      }
      this.continueAfterReload(needReload);
    }

    this.updateUI();
    window.Game2D?.outcome?.({
      shooterIsPlayer: true,
      target,
      aimed: !!aimed,
      hit: bullet === 1 && aimed && (!hadShield || double),
      shield: bullet === 1 && aimed && hadShield && !double,
      damage: bullet === 1 && aimed ? (double ? 2 : 1) : 0,
      gameOver: !GameState.gameActive
    });
    this.animateShoot(target, bullet === 1, aimed !== false);
  },

  // 使用道具
  useItem(itemType) {
    if (!GameState.gameActive || GameState.revealingAmmo || GameState.currentPlayer !== 0) return;

    const itemIndex = GameState.playerItems[0].indexOf(itemType);
    if (itemIndex === -1) return;

    GameState.playerItems[0].splice(itemIndex, 1);

    switch (itemType) {
      case 'peek':
        const nextBullet = GameState.bullets[GameState.currentBulletIndex];
        const isLive = nextBullet === 1;
        this.addLog(`使用看破：下一发是${isLive ? '实弹' : '空弹'}`);
        window.GameAudio?.play('peek');
        window.Game2D?.item?.('peek', 0);
        showPeekResult(isLive);
        break;

      case 'power':
        // 双倍威力：下一发实弹伤害翻倍，仅在自己回合内生效
        GameState.powerActive[0] = true;
        this.addLog('使用双倍威力：下一发实弹伤害翻倍！');
        window.GameAudio?.play('power');
        window.Game2D?.item?.('power', 0);
        showToast('双倍威力已激活！');
        break;

      case 'shield':
        GameState.shieldUsed[0] = true;
        this.addLog('使用护盾：抵挡下一次伤害');
        window.GameAudio?.play('shield');
        window.Game2D?.item?.('shield', 0);
        showToast('护盾已激活！');
        break;

      case 'eject':
        // 退蛋：退出当前一发子弹，不造成伤害，继续自己的回合
        const bullet = GameState.bullets[GameState.currentBulletIndex];
        GameState.currentBulletIndex++;
        GameState.bulletsRemaining--;
        const ejectedLive = bullet === 1;

        this.addLog(`使用退蛋：退出${ejectedLive ? '实弹' : '空弹'}！`);
        showToast(ejectedLive ? '退出一发实弹！' : '退出一发空弹！');
        GameState.currentPlayer = 0;

        // 子弹打完进入下一循环：重新装填
        const needReload = GameState.currentBulletIndex >= GameState.totalBullets;
        if (needReload) {
          this.reloadBullets();
          this.addLog('子弹已打完，重新装填！');
        }

        window.Game2D?.outcome?.({
          shooterIsPlayer: true,
          target: 'self',
          eject: true,
          live: ejectedLive
        });

        this.continueAfterReload(needReload);
        break;
    }

    this.updateUI();
  },

  // AI回合
  aiTurn() {
    if (!GameState.gameActive || GameState.currentPlayer !== 1) return;

    // AI决策逻辑
    const decision = this.aiMakeDecision();

    switch (decision.action) {
      case 'use_item':
        this.aiUseItem(decision.item);
        break;
      case 'shoot_self':
        this.aiShoot('self');
        break;
      case 'shoot_enemy':
        this.aiShoot('enemy');
        break;
    }
  },

  // AI决策
  aiMakeDecision() {
    const health = GameState.playerHealth[1];
    const opponentHealth = GameState.playerHealth[0];
    const items = GameState.aiItems;
    const remaining = GameState.bulletsRemaining;

    // 低血量时保守策略
    if (health <= 1) {
      // 优先使用护盾
      if (items.includes('shield') && !GameState.aiShieldUsed) {
        return { action: 'use_item', item: 'shield' };
      }
      // 使用看破
      if (items.includes('peek')) {
        return { action: 'use_item', item: 'peek' };
      }
      // 使用退蛋：主动退出风险子弹
      if (items.includes('eject')) {
        return { action: 'use_item', item: 'eject' };
      }
    }

    // 有看破道具时使用
    if (items.includes('peek') && Math.random() > 0.3) {
      return { action: 'use_item', item: 'peek' };
    }

    // 概率判断
    const liveProb = 1 / remaining;

    // 退蛋：剩余弹量少且实弹概率高时防御性使用
    if (items.includes('eject') && remaining <= 3 && liveProb > 0.5) {
      return { action: 'use_item', item: 'eject' };
    }

    // 双倍威力：进攻前使用（高血量时更有价值）
    if (items.includes('power') && health >= 2 && Math.random() > 0.35) {
      return { action: 'use_item', item: 'power' };
    }

    // 高血量时主动进攻
    if (health >= 2) {
      if (Math.random() > 0.6) {
        return { action: 'shoot_enemy' };
      } else {
        return { action: 'shoot_self' };
      }
    }

    // 默认策略
    if (Math.random() > 0.5) {
      return { action: 'shoot_self' };
    } else {
      return { action: 'shoot_enemy' };
    }
  },

  // AI使用道具
  aiUseItem(itemType) {
    const itemIndex = GameState.aiItems.indexOf(itemType);
    if (itemIndex === -1) return;

    GameState.aiItems.splice(itemIndex, 1);
    GameState.playerItems[1] = GameState.aiItems;

    switch (itemType) {
      case 'peek':
        const nextBullet = GameState.bullets[GameState.currentBulletIndex];
        this.addLog(`AI使用了看破`);
        window.GameAudio?.play('peek');
        window.Game2D?.item?.('peek', 1);
        // AI会根据结果决策，但不显示给玩家
        setTimeout(() => this.aiTurn(), 1000);
        break;

      case 'power':
        GameState.powerActive[1] = true;
        this.addLog('AI使用了双倍威力');
        window.GameAudio?.play('power');
        window.Game2D?.item?.('power', 1);
        showToast('AI使用了双倍威力');
        setTimeout(() => this.aiTurn(), 1000);
        break;

      case 'shield':
        GameState.aiShieldUsed = true;
        GameState.shieldUsed[1] = true;
        this.addLog('AI使用了护盾');
        window.GameAudio?.play('shield');
        window.Game2D?.item?.('shield', 1);
        showToast('AI使用了护盾');
        setTimeout(() => this.aiTurn(), 1000);
        break;

      case 'eject':
        const bullet = GameState.bullets[GameState.currentBulletIndex];
        GameState.currentBulletIndex++;
        GameState.bulletsRemaining--;
        this.addLog('AI使用了退蛋');
        showToast('AI使用了退蛋');
        GameState.currentPlayer = 1;

        // 子弹打完进入下一循环：重新装填
        const needReload = GameState.currentBulletIndex >= GameState.totalBullets;
        if (needReload) {
          this.reloadBullets();
          this.addLog('子弹已打完，重新装填！');
        }

        window.Game2D?.outcome?.({
          shooterIsPlayer: false,
          target: 'self',
          eject: true,
          live: bullet === 1
        });

        if (needReload) {
          this.continueAfterReload(true);
        } else {
          setTimeout(() => this.aiTurn(), 1000);
        }
        break;
    }

    this.updateUI();
  },

  // AI开枪
  aiShoot(target) {
    const bullet = GameState.bullets[GameState.currentBulletIndex];
    GameState.currentBulletIndex++;
    GameState.bulletsRemaining--;

    const atSelf = target === 'self';
    const victim = atSelf ? 1 : 0;
    const aiDouble = bullet === 1 && GameState.powerActive[1];
    const aiHadShield = bullet === 1 && GameState.shieldUsed[victim];

    if (bullet === 1) {
      // 命中实弹：扣血后轮到对方回合
      if (GameState.shieldUsed[victim]) {
        GameState.shieldUsed[victim] = false;
        if (aiDouble) {
          // 双倍威力击穿护盾：护盾失效，仍受1点伤害
          GameState.powerActive[1] = false;
          GameState.playerHealth[victim]--;
          this.addLog(atSelf ? 'AI对自己开枪，双倍威力击穿了护盾！-1HP' : 'AI对你开枪，双倍威力击穿了护盾！-1HP');
          showToast(atSelf ? 'AI的护盾被双倍威力击穿！' : '你的护盾被双倍威力击穿！-1HP');
        } else {
          this.addLog(atSelf ? 'AI对自己开枪，护盾抵挡了伤害！' : 'AI对你开枪，护盾抵挡了伤害！');
          showToast(atSelf ? 'AI的护盾抵挡了伤害！' : '你的护盾抵挡了伤害！');
        }
      } else {
        const damage = aiDouble ? 2 : 1;
        if (aiDouble) GameState.powerActive[1] = false;
        GameState.playerHealth[victim] -= damage;
        this.addLog(atSelf ? `AI对自己开枪，命中实弹！-${damage}HP` : `AI对你开枪，命中实弹！-${damage}HP`);
        showToast(atSelf ? `AI命中实弹！-${damage}HP` : `AI命中你！-${damage}HP`);
      }
      GameState.currentPlayer = 0;
    } else {
      // 空弹：对自己开枪则继续AI回合，对对方开枪则轮到对方
      if (atSelf) {
        this.addLog('AI对自己开枪，空弹！继续AI的回合');
        showToast('AI开枪，空弹！');
        GameState.currentPlayer = 1;
      } else {
        this.addLog('AI对你开枪，空弹！');
        showToast('AI开枪，空弹！');
        GameState.currentPlayer = 0;
      }
    }

    // 双倍威力仅在自己回合内生效：回合结束未吃到实弹则效果作废
    if (GameState.currentPlayer !== 1) {
      GameState.powerActive[1] = false;
    }

    // 检查游戏结束（优先：子弹刚好打空又有人死亡，直接结算，不再装填过回合）
    if (GameState.playerHealth[0] <= 0 || GameState.playerHealth[1] <= 0) {
      GameState.gameActive = false;
      const winner = GameState.playerHealth[0] <= 0 ? 1 : 0;
      this.addLog(winner === 0 ? '你获胜了！' : 'AI获胜了！');
      setTimeout(() => showResult(winner === 0), 1500);
    } else {
      // 子弹打完进入下一循环：重新装填
      const needReload = GameState.currentBulletIndex >= GameState.totalBullets;
      if (needReload) {
        this.reloadBullets();
        this.addLog('子弹已打完，重新装填！');
      }
      this.continueAfterReload(needReload);
    }

    this.updateUI();
    window.Game2D?.outcome?.({
      shooterIsPlayer: false,
      target,
      aimed: true,
      hit: bullet === 1 && (!aiHadShield || aiDouble),
      shield: aiHadShield && !aiDouble,
      damage: bullet === 1 ? (aiDouble ? 2 : 1) : 0,
      gameOver: !GameState.gameActive
    });
    this.animateShoot(target, bullet === 1, true);
  },

  // 添加日志
  addLog(text) {
    GameState.gameLog.push(text);
    if (GameState.gameLog.length > 20) {
      GameState.gameLog.shift();
    }
    updateGameLog();
  },

  // 更新UI
  updateUI() {
    updateGameUI();
  },

  // 开枪动画
  animateShoot(target, isLive, aimed) {
    const cylinder = document.getElementById('cylinder');
    if (cylinder) {
      cylinder.classList.add('shooting');
      setTimeout(() => cylinder.classList.remove('shooting'), 500);
    }
    window.Game2D?.shoot(target, isLive, aimed);
    const world = document.querySelector('.game-world');
    if (world) {
      world.classList.add('shot-fired');
      setTimeout(() => world.classList.remove('shot-fired'), 500);
    }
  }
};

// 当前选择的角色皮肤名（'' = 默认贴图）
function getMyCharacterSkin() {
  const sm = window.SkinManager;
  return (sm && sm.currentAssetSkin && typeof sm.currentAssetSkin.character === 'string')
    ? sm.currentAssetSkin.character
    : '';
}

// 多人联机游戏逻辑
const MultiPlayerGame = {
  // 连接服务器
  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      GameState.ws = new WebSocket(wsUrl);
    } catch (error) {
      console.error('WebSocket connect failed:', error);
      showToast(window.location.host ? '连接失败，请确认服务器已启动（npm start）' : '请通过 http://localhost:8080 打开本页');
      return;
    }

    GameState.ws.onopen = () => {
      console.log('WebSocket connected');
    };

    GameState.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    GameState.ws.onclose = () => {
      console.log('WebSocket disconnected');
      if (GameState.mode === 'multi' && GameState.gameActive) {
        showToast('连接断开');
      }
    };

    GameState.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      const host = window.location.host;
      showToast(host ? '连接失败，请确认服务器已启动（npm start）' : '请通过 http://localhost:8080 打开本页');
    };
  },

  // 创建房间
  createRoom(playerName) {
    GameState.mode = 'multi';
    GameState.playerName = playerName || '玩家1';
    this.connect();

    // 等待连接建立
    const checkConnection = setInterval(() => {
      if (GameState.ws && GameState.ws.readyState === WebSocket.OPEN) {
        clearInterval(checkConnection);
        GameState.ws.send(JSON.stringify({
          type: 'create_room',
          playerName: GameState.playerName,
          itemCounts: GameState.itemCounts,
          startHealth: GameState.startHealth,
          mode: GameState.gameMode,
          skin: getMyCharacterSkin()
        }));
      }
    }, 100);
    setTimeout(() => clearInterval(checkConnection), 6000);
  },

  // 加入房间
  joinRoom(roomId, playerName) {
    GameState.mode = 'multi';
    GameState.playerName = playerName || '玩家2';
    this.connect();

    const checkConnection = setInterval(() => {
      if (GameState.ws && GameState.ws.readyState === WebSocket.OPEN) {
        clearInterval(checkConnection);
        GameState.ws.send(JSON.stringify({
          type: 'join_room',
          roomId: roomId.toUpperCase(),
          playerName: GameState.playerName,
          skin: getMyCharacterSkin()
        }));
      }
    }, 100);
    setTimeout(() => clearInterval(checkConnection), 6000);
  },

  // 刷新房间列表（未连接时自动先连接）
  refreshRoomList() {
    if (GameState.ws && GameState.ws.readyState === WebSocket.OPEN) {
      GameState.ws.send(JSON.stringify({ type: 'list_rooms' }));
      return;
    }
    if (!GameState.ws || GameState.ws.readyState === WebSocket.CLOSED) {
      this.connect();
    }
    const trySend = setInterval(() => {
      if (GameState.ws && GameState.ws.readyState === WebSocket.OPEN) {
        clearInterval(trySend);
        GameState.ws.send(JSON.stringify({ type: 'list_rooms' }));
      }
    }, 150);
    setTimeout(() => clearInterval(trySend), 6000);
  },

  // 渲染房间列表
  renderRoomList() {
    const listEl = document.getElementById('room-list');
    if (!listEl) return;
    if (!GameState.ws || GameState.ws.readyState !== WebSocket.OPEN) {
      listEl.innerHTML = '<div class="room-list-empty">未连接服务器</div>';
      return;
    }
    if (!GameState.roomList.length) {
      listEl.innerHTML = '<div class="room-list-empty">暂无房间，等待房主创建…</div>';
      return;
    }
    listEl.innerHTML = GameState.roomList.map(room => `
      <div class="room-row">
        <span class="room-row-id">${room.roomId}</span>
        <div class="room-row-info">
          <strong>${escapeHtml(room.hostName)}</strong>
          <small>${room.mode === 'gamble' ? '赌局模式' : '普通模式'} · 道具 ×${room.totalItems} · 血量 ${room.startHealth}</small>
        </div>
        <button class="btn btn-small room-row-join" data-room-id="${room.roomId}">加入</button>
      </div>
    `).join('');
  },

  // 开启房间列表轮询
  startRoomListPolling() {
    this.refreshRoomList();
    if (GameState.roomListTimer) clearInterval(GameState.roomListTimer);
    GameState.roomListTimer = setInterval(() => {
      const joinForm = document.getElementById('join-form');
      if (!joinForm || joinForm.classList.contains('hidden')) return;
      this.refreshRoomList();
    }, 2500);
  },

  // 停止房间列表轮询
  stopRoomListPolling() {
    if (GameState.roomListTimer) {
      clearInterval(GameState.roomListTimer);
      GameState.roomListTimer = null;
    }
  },

  // 处理服务器消息
  handleMessage(data) {
    switch (data.type) {
      case 'room_created':
        GameState.roomId = data.roomId;
        GameState.playerIndex = data.playerIndex;
        showScreen('waiting-screen');
        document.getElementById('room-id-display').textContent = data.roomId;
        const configLine = document.getElementById('room-config');
        if (configLine) {
          const modeLabel = GameState.gameMode === 'gamble' ? '赌局模式' : '普通模式';
          configLine.textContent = `${modeLabel} · 道具 ×${getTotalItemCount()} · 初始血量 ${GameState.startHealth}`;
        }
        break;

      case 'rooms_list':
        GameState.roomList = Array.isArray(data.rooms) ? data.rooms : [];
        this.renderRoomList();
        break;

      case 'room_joined':
        GameState.roomId = data.roomId;
        GameState.playerIndex = data.playerIndex;
        this.stopRoomListPolling();
        break;

      case 'game_start':
        GameState.gameActive = true;
        this.stopRoomListPolling();
        showScreen('game-screen');
        // 以服务器权威 playerIndex 兜底，避免 room_joined 未设置时双方都显示"对手的回合"
        if (Number.isFinite(data.playerIndex)) {
          GameState.playerIndex = data.playerIndex;
        }
        this.updateFromServer(data);
        // 赌局模式：装完子弹后进入抽取道具环节
        if (GameState.gameMode === 'gamble') {
          showAmmoReveal(data.ammoLive, data.ammoEmpty, () => {
            showGambleDraw(data.gambleDrawn && data.gambleDrawn[GameState.playerIndex], null);
          });
        } else {
          showAmmoReveal(data.ammoLive, data.ammoEmpty);
        }
        break;

      case 'shoot':
      case 'use_item':
        // 游戏结束优先：死亡直接结算，不再触发装填 / 回合切换动画
        if (data.gameOver) GameState.gameActive = false;
        this.updateFromServer(data);

        if (data.type === 'shoot') {
          // 射击结算：解除人格面具强制状态
          GameState.personaPending = false;
          this.animateShoot(data.target, data.detail === 'miss_aim' ? data.bullet === 'live' : data.detail !== 'miss', data.detail !== 'miss_aim');
          if (data.gotOrpheus) {
            showToast('空弹！获得【俄耳甫斯】');
          } else if (data.orpheusBlocked) {
            showToast('空弹！但卡槽已满，无法获得俄耳甫斯');
          }
        } else {
          // 使用道具
          if (data.detail === 'persona') {
            GameState.personaPending = data.shooter === GameState.playerIndex;
            if (data.shooter === GameState.playerIndex) {
              showToast('人格面具：本回合内对自己射击，空弹获得俄耳甫斯');
            } else {
              showToast('对手使用了人格面具');
            }
          } else if (data.detail === 'orpheus') {
            showToast(data.shooter === GameState.playerIndex ? '俄耳甫斯：连续行动两个回合！' : '对手使用了俄耳甫斯');
          } else if (data.detail === 'peek' || data.detail === 'power' || data.detail === 'shield') {
            window.GameAudio?.play(data.detail);
          }
        }

        window.Game2D?.outcome?.({
          shooterIsPlayer: data.shooter === GameState.playerIndex,
          target: data.type === 'shoot' ? data.target : 'self',
          aimed: data.detail !== 'miss_aim',
          hit: data.detail === 'hit' || data.hit === true,
          shield: data.detail === 'shield_block' || data.shield === true,
          damage: Number(data.damage) || 0,
          eject: data.detail === 'eject',
          live: data.bullet === 'live',
          item: data.type === 'use_item' ? data.detail : null,
          playerIndex: Number.isFinite(data.shooter) ? data.shooter : data.currentPlayer,
          gameOver: !!data.gameOver
        });

        // 联机看破：只有使用方弹出结果（使用后回合不变，可据此判断是否自己用的）
        if (data.type === 'use_item' && data.detail === 'peek' && data.currentPlayer === GameState.playerIndex) {
          showPeekResult(data.bullet === 'live');
        }

        if (data.reloaded && !data.gameOver) {
          // 赌局模式：装完子弹后进入抽取道具环节
          if (GameState.gameMode === 'gamble') {
            showAmmoReveal(data.ammoLive, data.ammoEmpty, () => {
              showGambleDraw(data.gambleDrawn && data.gambleDrawn[GameState.playerIndex], null);
            });
          } else {
            showAmmoReveal(data.ammoLive, data.ammoEmpty);
          }
        }

        if (data.gameOver) {
          setTimeout(() => showResult(data.winner === GameState.playerIndex), 1500);
        }
        break;

      case 'duel_start':
        this.updateFromServer(data);
        startDuelUI(data.duelUser, data.readyAt, data.fireAt, data.endAt);
        break;

      case 'duel_result':
        GameState.gameActive = !data.gameOver;
        this.updateFromServer(data);
        endDuelUI(data);
        break;

      case 'duel_timeout':
        this.updateFromServer(data);
        endDuelUI({ timeout: true });
        break;

      case 'player_left':
        GameState.gameActive = false;
        showToast('对手已离开');
        setTimeout(() => {
          showResult(data.winner === GameState.playerIndex);
        }, 1500);
        break;

      case 'player_skin':
        // 应用对手的角色皮肤（自己不受影响）
        if (Number.isFinite(data.skinOwner) && data.skinOwner !== GameState.playerIndex) {
          GameState.opponentSkin = data.skin || '';
          window.Game2D?.setOpponentSkin?.(GameState.opponentSkin);
        }
        break;

      case 'error':
        showToast(data.message);
        break;
    }
  },

  // 从服务器更新状态
  updateFromServer(data) {
    if (Number.isFinite(data.playerIndex)) {
      GameState.playerIndex = data.playerIndex;
    }
    GameState.currentPlayer = data.currentPlayer;
    GameState.playerHealth = data.playerHealth;
    GameState.playerItems = data.playerItems;
    GameState.shieldUsed = data.shieldUsed;
    if (Array.isArray(data.powerActive)) {
      GameState.powerActive = data.powerActive;
    }
    if (Number.isFinite(data.startHealth)) {
      GameState.startHealth = Math.max(1, Math.min(5, data.startHealth));
    }
    if (data.gameMode === 'gamble' || data.gameMode === 'normal') {
      GameState.gameMode = data.gameMode;
    }
    if (data.itemCounts && typeof data.itemCounts === 'object') {
      ITEM_TYPES.forEach(type => {
        GameState.itemCounts[type] = clampInt(data.itemCounts[type], 0, 3);
      });
    }
    GameState.bulletsRemaining = data.bulletsRemaining;
    if (Number.isFinite(data.ammoLive) && Number.isFinite(data.ammoEmpty)) {
      GameState.totalBullets = data.ammoLive + data.ammoEmpty;
      GameState.currentBulletIndex = 0;
    } else {
      GameState.currentBulletIndex = Math.max(0, GameState.totalBullets - data.bulletsRemaining);
    }
    GameState.gameLog = data.gameLog;
    GameState.isMyTurn = data.currentPlayer === GameState.playerIndex;

    updateGameUI();
    updateGameLog();
  },

  // 开枪
  shoot(target, aimed) {
    if (!GameState.gameActive || GameState.revealingAmmo || !GameState.isMyTurn) return;

    GameState.ws.send(JSON.stringify({
      type: 'shoot',
      target: target || null,
      aimed: !!aimed
    }));
  },

  // 使用道具
  useItem(itemType) {
    if (!GameState.gameActive || GameState.revealingAmmo || !GameState.isMyTurn) return;

    GameState.ws.send(JSON.stringify({
      type: 'use_item',
      item: itemType
    }));
  },

  // 重新开始
  restart() {
    if (GameState.ws && GameState.ws.readyState === WebSocket.OPEN) {
      GameState.ws.send(JSON.stringify({ type: 'restart' }));
    }
  },

  // 动画
  animateShoot(target, isLive, aimed) {
    const cylinder = document.getElementById('cylinder');
    if (cylinder) {
      cylinder.classList.add('shooting');
      setTimeout(() => cylinder.classList.remove('shooting'), 500);
    }
    window.Game2D?.shoot(target, isLive, aimed);
    const world = document.querySelector('.game-world');
    if (world) {
      world.classList.add('shot-fired');
      setTimeout(() => world.classList.remove('shot-fired'), 500);
    }
  }
};

// UI更新函数
function updateGameUI() {
  const isSingle = GameState.mode === 'single';
  const myIndex = isSingle ? 0 : GameState.playerIndex;
  const enemyIndex = 1 - myIndex;

  // 左上方：敌人信息卡片（自己的信息在底部面板显示）
  const enemyCard = document.querySelector('.player-left');
  if (enemyCard) {
    enemyCard.classList.toggle('is-active', GameState.gameActive && GameState.currentPlayer === enemyIndex);
  }

  // 更新敌人名称与血量
  const enemyHealth = GameState.playerHealth[enemyIndex];
  const maxHp = Math.max(1, GameState.startHealth || 2);
  document.getElementById('player1-name').textContent = isSingle ? 'AI' : '对手';
  document.getElementById('player1-health').style.width = `${Math.min(100, (enemyHealth / maxHp) * 100)}%`;
  document.getElementById('player1-health-text').textContent = `HP: ${enemyHealth}/${maxHp}`;
  updateLifePips('player1-lives', enemyHealth);

  // 底部自己的角色面板（头像 / 名称 / 血量）
  const myHealth = GameState.playerHealth[myIndex];
  const panelName = document.getElementById('panel-name');
  if (panelName) panelName.textContent = '你';
  const panelHealthText = document.getElementById('panel-health-text');
  if (panelHealthText) panelHealthText.textContent = `HP: ${myHealth}/${maxHp}`;
  const panelHealth = document.getElementById('panel-health');
  if (panelHealth) panelHealth.style.width = `${Math.min(100, (myHealth / maxHp) * 100)}%`;
  updateLifePips('panel-lives', myHealth);

  // 更新回合指示
  const turnText = document.getElementById('turn-text');
  const isMyTurn = isSingle ? GameState.currentPlayer === 0 : GameState.isMyTurn;
  if (isSingle) {
    turnText.textContent = GameState.currentPlayer === 0 ? (GameState.gunPicked ? '你的回合' : '你的回合 · 拿起枪') : 'AI的回合';
  } else {
    turnText.textContent = GameState.isMyTurn ? (GameState.gunPicked ? '你的回合' : '你的回合 · 拿起枪') : '对手的回合';
  }

  document.getElementById('bullets-remaining').textContent = `剩余: ${GameState.bulletsRemaining}`;

  // 操作权限：先拿起枪，才能开枪 / 用道具（对决期间全部锁定）
  const canAct = isMyTurn && !GameState.revealingAmmo && GameState.gameActive && !GameState.duelActive;
  if (!canAct) GameState.gunPicked = false;
  const canShoot = canAct && GameState.gunPicked;

  // 更新道具栏（动态渲染，按槽位 1-4 依次填充）：
  // 普通模式：4 类固定顺序，显示数量徽章；赌局模式：按获得顺序从左到右填入空槽
  const myItems = isSingle ? GameState.playerItems[0] : GameState.playerItems[myIndex];
  const isGamble = GameState.gameMode === 'gamble';
  const itemsBar = document.getElementById('items-bar');
  if (itemsBar) itemsBar.classList.toggle('gamble', isGamble);
  const dockHint = document.querySelector('.items-panel .dock-heading small');
  if (dockHint) dockHint.textContent = isGamble ? 'DRAW 2 / RELOAD' : 'USE ONE / TURN';
  const myItemsArr = myItems || [];
  if (itemsBar) {
    const slotTypes = isGamble ? myItemsArr.slice(0, 4) : ['peek', 'power', 'shield', 'eject'];
    itemsBar.innerHTML = slotTypes.map((type, i) => {
      const count = isGamble ? 1 : myItemsArr.filter(item => item === type).length;
      const has = count > 0;
      const cls = ['item-slot'];
      if (has && canShoot) cls.push('available');
      if (has && !canShoot) cls.push('locked');
      if (!has) cls.push('empty');
      const meta = ITEM_META[type] || {};
      const inner = has
        ? `<span class="item-index">0${i + 1}</span><div class="item-icon item-icon-${type}">${meta.icon}</div><div class="item-name">${meta.name}</div><small>${meta.en}</small><span class="item-count${count > 1 && !isGamble ? ' show' : ''}">${count > 1 ? `×${count}` : ''}</span>`
        : '';
      return `<div class="${cls.join(' ')}" data-item="${has ? type : ''}" title="${has ? (meta.desc || '') : '空卡槽'}" role="button" tabindex="0">${inner}</div>`;
    }).join('');
  }

  // 更新双倍威力状态（敌人卡片提示 + 2D 枪身红光）
  const myPowerActive = Array.isArray(GameState.powerActive) && GameState.powerActive[myIndex];
  const enemyPowerActive = Array.isArray(GameState.powerActive) && GameState.powerActive[enemyIndex];
  const enemyNote = document.querySelector('.player-left .player-note');
  if (enemyNote) enemyNote.innerHTML = `<span></span>${enemyPowerActive ? 'DOUBLE DAMAGE ARMED' : 'WATCHING YOUR MOVE'}`;
  document.querySelector('.player-left')?.classList.toggle('is-powered', enemyPowerActive);
  document.querySelector('.player-panel')?.classList.toggle('is-powered', myPowerActive);

  // 更新轮盘显示；联机模式只显示当前槽位，不暴露未发射子弹
  updateRevolverVisual();
  window.Game2D?.sync({
    mode: GameState.mode,
    gameActive: GameState.gameActive,
    currentPlayer: GameState.currentPlayer,
    currentBulletIndex: GameState.currentBulletIndex,
    totalBullets: GameState.totalBullets,
    bullets: isSingle ? GameState.bullets : [],
    playerIndex: GameState.playerIndex,
    powerActive: GameState.powerActive,
    health: [...GameState.playerHealth],
    canPickup: canAct && !GameState.gunPicked,
    canAct: canShoot
  });
}

function updateRevolverVisual() {
  const slots = document.querySelectorAll('.bullet-slot');
  const total = Math.min(slots.length, GameState.totalBullets || slots.length);
  const current = Math.min(GameState.currentBulletIndex, total);

  slots.forEach((slot, index) => {
    slot.classList.remove('live', 'empty', 'fired', 'current', 'sealed');

    if (index >= total) {
      slot.classList.add('sealed');
    } else if (index < current) {
      slot.classList.add('fired');
      if (GameState.mode === 'single' && GameState.bullets[index] === 1) {
        slot.classList.add('live');
      } else if (GameState.mode === 'single') {
        slot.classList.add('empty');
      }
    } else if (GameState.gameActive && index === current) {
      slot.classList.add('current');
    }
  });
}

function updateLifePips(elementId, health) {
  const container = document.getElementById(elementId);
  if (!container) return;
  const target = Math.max(1, Math.min(6, GameState.startHealth || 2));
  while (container.children.length < target) {
    container.appendChild(document.createElement('i'));
  }
  while (container.children.length > target) {
    container.removeChild(container.lastChild);
  }
  [...container.children].forEach((pip, index) => {
    pip.classList.toggle('active', index < health);
  });
}

function updateGameLog() {
  const logContent = document.getElementById('log-content');
  logContent.innerHTML = GameState.gameLog.map(log =>
    `<div class="log-entry">${log}</div>`
  ).join('');
  logContent.scrollTop = logContent.scrollHeight;
}

// 屏幕切换
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  document.getElementById(screenId).classList.add('active');
  window.Game2D?.setScreen(screenId);
}

// 显示结果
function showResult(isWin) {
  const resultIcon = document.getElementById('result-icon');
  const resultTitle = document.getElementById('result-title');
  const resultDesc = document.getElementById('result-desc');

  if (isWin) {
    resultIcon.textContent = '◆';
    resultTitle.textContent = '胜利！';
    resultTitle.style.color = '#ffd700';
    resultDesc.textContent = '你成功击败了对手！';
    window.GameAudio?.play('win');
  } else {
    resultIcon.textContent = '×';
    resultTitle.textContent = '失败';
    resultTitle.style.color = '#e63946';
    resultDesc.textContent = '你被对手击败了...';
    window.GameAudio?.play('lose');
  }

  showScreen('result-screen');
}

// 装填弹药展示
const AMMO_REVEAL_DURATION = 2000;

function showAmmoReveal(live, empty, callback) {
  GameState.revealingAmmo = true;
  GameState.gunPicked = false; // 重新装填后枪回到桌面
  document.getElementById('ammo-live-count').textContent = live;
  document.getElementById('ammo-empty-count').textContent = empty;
  const world = document.querySelector('.game-world');
  if (world) world.classList.add('reloading');
  window.Game2D?.reload();

  const fill = document.getElementById('loading-fill');
  fill.classList.remove('loading');
  void fill.offsetWidth;
  fill.classList.add('loading');

  document.getElementById('ammo-modal').classList.remove('hidden');
  updateGameUI();

  setTimeout(() => {
    document.getElementById('ammo-modal').classList.add('hidden');
    GameState.revealingAmmo = false;
    if (world) world.classList.remove('reloading');
    updateGameUI();
    if (callback) callback();
  }, AMMO_REVEAL_DURATION);
}

// 道具信息（用于抽取环节展示）
const ITEM_META = {
  peek: { name: '看破', icon: '◉', en: 'PEEK', desc: '看破：查看下一发子弹' },
  power: { name: '双倍威力', icon: '×2', en: 'DOUBLE', desc: '双倍威力：下一发实弹伤害翻倍（本回合内有效）' },
  shield: { name: '护盾', icon: '◇', en: 'SHIELD', desc: '护盾：抵挡一次伤害' },
  eject: { name: '退蛋', icon: '⏏', en: 'EJECT', desc: '退蛋：退出一发子弹' },
  duel: { name: '对决', icon: '⚔', en: 'DUEL', desc: '对决：进入 3~10 秒对峙，先开枪者胜' },
  persona: { name: '人格面具', icon: '◐', en: 'PERSONA', desc: '人格面具：本回合内对自己射击，空弹获得俄耳甫斯（否则失效）' },
  orpheus: { name: '俄耳甫斯', icon: '♪', en: 'ORPHEUS', desc: '俄耳甫斯：连续行动两个回合' }
};

// 赌局模式：抽取道具环节（装完子弹后展示，按槽位 1-4 依次放入）
function showGambleDraw(drawnItems, callback) {
  callback = callback || function () {};
  const modal = document.getElementById('draw-modal');
  const cardsEl = document.getElementById('draw-cards');
  const msgEl = document.getElementById('draw-message');
  if (!modal || !cardsEl) {
    callback();
    return;
  }
  GameState.revealingAmmo = true;
  const drawn = Array.isArray(drawnItems) ? drawnItems : [];
  const current = Array.isArray(GameState.playerItems[GameState.playerIndex])
    ? GameState.playerItems[GameState.playerIndex]
    : [];
  // 已有道具（抽卡前）保持原顺序，本轮新抽的依次排到后面 → 与卡槽 1-4 顺序一致
  const order = current.filter(t => drawn.indexOf(t) === -1).concat(drawn);
  cardsEl.innerHTML = '';
  if (msgEl) msgEl.textContent = '';

  order.forEach((type) => {
    const meta = ITEM_META[type] || {};
    const isNew = drawn.indexOf(type) !== -1;
    const div = document.createElement('div');
    div.className = 'draw-card' + (isNew ? '' : ' existing');
    div.innerHTML = `
      <div class="card-inner">
        <div class="card-face card-back">◆</div>
        <div class="card-face card-front">
          <div class="item-icon">${meta.icon}</div>
          <div class="draw-card-name">${meta.name}</div>
          <small>${meta.en}</small>
        </div>
      </div>`;
    cardsEl.appendChild(div);
  });
  // 剩余空槽位（虚线占位）
  for (let i = order.length; i < 4; i++) {
    const div = document.createElement('div');
    div.className = 'draw-card empty';
    div.innerHTML = '<div class="card-inner"><div class="card-face card-back">◆</div></div>';
    cardsEl.appendChild(div);
  }

  modal.classList.remove('hidden');
  if (drawn.length === 0 && msgEl) {
    msgEl.textContent = '卡槽已满，无法抽取道具';
  }

  // 已有卡片立即显示正面；新卡依次翻入下一个空槽
  cardsEl.querySelectorAll('.draw-card.existing').forEach(c => c.classList.add('flipped', 'instant'));
  const newCards = cardsEl.querySelectorAll('.draw-card:not(.existing):not(.empty)');
  newCards.forEach((card, i) => {
    setTimeout(() => card.classList.add('flipped'), 450 + i * 320);
  });
  const closeAt = 500 + newCards.length * 320 + 1200;
  setTimeout(() => {
    modal.classList.add('hidden');
    GameState.revealingAmmo = false;
    updateGameUI();
    callback();
  }, closeAt);
}

// 对决界面：3 秒倒计时（不可操作）→ 随机等待 3~10 秒（显示等待）→ 射击开放（先开枪者胜）
let duelAnimFrame = null;

function startDuelUI(duelUser, readyAt, fireAt, endAt) {
  GameState.duelActive = true;
  GameState.duelPhase = 'countdown';
  GameState.duelUser = duelUser;
  const overlay = document.getElementById('duel-overlay');
  const stage = document.getElementById('duel-stage-label');
  const countdown = document.getElementById('duel-countdown');
  const prompt = document.getElementById('duel-prompt');
  const result = document.getElementById('duel-result');
  if (result) result.textContent = '';
  overlay.classList.remove('hidden');
  overlay.classList.add('countdown');
  overlay.classList.remove('showdown', 'waiting', 'result');
  if (duelAnimFrame) cancelAnimationFrame(duelAnimFrame);

  const tick = () => {
    const now = Date.now();
    if (now < readyAt) {
      GameState.duelPhase = 'countdown';
      const sec = Math.max(1, Math.ceil((readyAt - now) / 1000));
      if (stage) stage.textContent = '准备对决';
      if (countdown) countdown.textContent = String(sec);
      if (prompt) prompt.textContent = '倒计时中 · 无法操作';
      overlay.classList.add('countdown');
      overlay.classList.remove('showdown', 'waiting');
      duelAnimFrame = requestAnimationFrame(tick);
    } else if (now < fireAt) {
      // 等待射击信号（随机 3~10 秒）
      GameState.duelPhase = 'waiting';
      if (stage) stage.textContent = '对峙状态';
      if (countdown) countdown.textContent = '…';
      if (prompt) prompt.textContent = '等待射击信号 · 请勿开火';
      overlay.classList.add('waiting');
      overlay.classList.remove('countdown', 'showdown');
      duelAnimFrame = requestAnimationFrame(tick);
    } else if (now <= endAt) {
      // 射击开放
      GameState.duelPhase = 'fire';
      if (stage) stage.textContent = '对峙状态';
      if (countdown) countdown.textContent = '⚔';
      if (prompt) prompt.textContent = '射击！最先扣动扳机者获胜';
      overlay.classList.add('showdown');
      overlay.classList.remove('countdown', 'waiting');
      duelAnimFrame = requestAnimationFrame(tick);
    } else {
      // 射击窗口已过，等待服务器结算
      duelAnimFrame = requestAnimationFrame(tick);
    }
  };
  tick();
}

// 扣动扳机（仅射击开放阶段有效；倒计时/等待期点击无效）
function sendDuelShoot() {
  if (!GameState.duelActive || GameState.duelPhase !== 'fire') return;
  if (GameState.ws && GameState.ws.readyState === 1) {
    GameState.ws.send(JSON.stringify({ type: 'duel_shoot' }));
  }
}

// 结束对决界面并展示结果
function endDuelUI(data) {
  GameState.duelActive = false;
  GameState.duelPhase = null;
  if (duelAnimFrame) cancelAnimationFrame(duelAnimFrame);
  const overlay = document.getElementById('duel-overlay');
  const stage = document.getElementById('duel-stage-label');
  const countdown = document.getElementById('duel-countdown');
  const result = document.getElementById('duel-result');
  const prompt = document.getElementById('duel-prompt');
  if (prompt) prompt.textContent = '';
  if (countdown) countdown.textContent = '◆';
  if (stage) stage.textContent = '对决结束';
  overlay.classList.remove('countdown', 'showdown');
  overlay.classList.add('result');

  if (data && data.timeout) {
    if (result) result.textContent = '僵持不下 · 平局';
  } else if (data && data.earlyFire) {
    const self = data.loser === GameState.playerIndex;
    if (result) result.textContent = self ? `提前开火！自己 -${data.damage} HP` : '对手提前开火！';
  } else if (data) {
    const win = data.winner === GameState.playerIndex;
    if (result) result.textContent = win ? `对决胜利！-${data.damage} HP` : `对决失败 · -${data.damage} HP`;
  }

  const delay = data && data.gameOver ? 2400 : 1600;
  setTimeout(() => {
    overlay.classList.add('hidden');
    // 强制恢复对局状态：枪回桌面、UI 解锁
    GameState.gunPicked = false;
    updateGameUI();
    if (data && data.gameOver) {
      setTimeout(() => showResult(data.winner === GameState.playerIndex), 300);
    }
  }, delay);
}

// 显示Toast
function showToast(message) {  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');

  // 重新触发动画
  toast.style.animation = 'none';
  toast.offsetHeight; // 触发重绘
  toast.style.animation = 'fadeInOut 2s ease forwards';

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2000);
}

// 显示看破结果
function showPeekResult(isLive) {
  const peekResult = document.getElementById('peek-result');
  peekResult.textContent = isLive ? '实弹' : '空弹';
  peekResult.className = `peek-result ${isLive ? 'live' : 'empty'}`;
  document.getElementById('peek-modal').classList.remove('hidden');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 对战配置（每种道具数量 / 初始血量）
const SETTINGS_STORAGE_KEY = 'bloodgun-settings';
const ITEM_TYPES = ['peek', 'shield', 'eject', 'power'];

let configMode = null; // 'single' | 'create'

function clampInt(value, min, max) {
  const num = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(num) ? Math.round(num) : min));
}

function defaultItemCounts() {
  return { peek: 1, shield: 1, eject: 1, power: 1 };
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    GameState.itemCounts = defaultItemCounts();
    const counts = saved.itemCounts || {};
    ITEM_TYPES.forEach(type => {
      const value = Number(counts[type]);
      if (Number.isFinite(value)) {
        GameState.itemCounts[type] = clampInt(value, 0, 3);
      }
    });
    const health = Number(saved.startHealth);
    if (Number.isFinite(health)) {
      GameState.startHealth = clampInt(health, 1, 5);
    }
  } catch (error) {
    GameState.itemCounts = defaultItemCounts();
    GameState.startHealth = 2;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      itemCounts: GameState.itemCounts,
      startHealth: GameState.startHealth
    }));
  } catch (error) {
    // 隐私模式下可能被拒绝，忽略
  }
}

function getTotalItemCount() {
  return ITEM_TYPES.reduce((sum, type) => sum + (GameState.itemCounts[type] || 0), 0);
}

function refreshConfigUI() {
  const isGamble = GameState.gameMode === 'gamble';
  // 游戏模式按钮高亮
  document.querySelectorAll('.cfg-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === GameState.gameMode);
  });
  // 赌局模式：道具由换弹抽取获得，禁用道具数量配置
  const itemsSection = document.getElementById('cfg-items-section');
  if (itemsSection) itemsSection.classList.toggle('disabled', isGamble);
  ITEM_TYPES.forEach(type => {
    const valueEl = document.getElementById(`cfg-${type}-value`);
    const minusEl = document.getElementById(`cfg-${type}-minus`);
    const plusEl = document.getElementById(`cfg-${type}-plus`);
    if (valueEl) valueEl.textContent = GameState.itemCounts[type];
    if (minusEl) minusEl.disabled = isGamble || GameState.itemCounts[type] <= 0;
    if (plusEl) plusEl.disabled = isGamble || GameState.itemCounts[type] >= 3;
  });
  const hpValue = document.getElementById('cfg-hp-value');
  const hpMinus = document.getElementById('cfg-hp-minus');
  const hpPlus = document.getElementById('cfg-hp-plus');
  if (hpValue) hpValue.textContent = GameState.startHealth;
  if (hpMinus) hpMinus.disabled = GameState.startHealth <= 1;
  if (hpPlus) hpPlus.disabled = GameState.startHealth >= 5;

  const itemTotal = document.getElementById('cfg-item-total');
  if (itemTotal) itemTotal.textContent = isGamble ? '抽取获得' : getTotalItemCount();
  const hpTotal = document.getElementById('cfg-hp-total');
  if (hpTotal) hpTotal.textContent = GameState.startHealth;
}

function openConfigModal(mode) {
  configMode = mode;
  const title = document.getElementById('config-title');
  const confirmBtn = document.getElementById('btn-config-confirm');
  const nameRow = document.getElementById('cfg-name-row');
  const modeRow = document.getElementById('cfg-mode-row');
  if (title) title.textContent = mode === 'create' ? '创建房间配置' : '对战配置';
  if (confirmBtn) {
    confirmBtn.textContent = mode === 'create' ? '创建牌桌 ↗' : '开始游戏 ↗';
  }
  if (nameRow) nameRow.classList.toggle('hidden', mode !== 'create');
  if (modeRow) modeRow.classList.toggle('hidden', mode !== 'create');
  if (mode === 'single') {
    // 单人模式固定普通玩法
    GameState.gameMode = 'normal';
  }
  refreshConfigUI();
  document.getElementById('config-modal').classList.remove('hidden');
  if (mode === 'create') {
    const nameInput = document.getElementById('cfg-name');
    if (nameInput) {
      nameInput.value = GameState.playerName && GameState.playerName !== '玩家1' ? GameState.playerName : '';
      nameInput.focus();
    }
  }
}

function closeConfigModal() {
  document.getElementById('config-modal').classList.add('hidden');
  configMode = null;
}

function confirmConfig() {
  const mode = configMode;
  saveSettings();
  closeConfigModal();
  if (mode === 'single') {
    SinglePlayerGame.init();
  } else if (mode === 'create') {
    const name = document.getElementById('cfg-name').value.trim();
    MultiPlayerGame.createRoom(name);
  }
}

function bindSettings() {
  const adjustItem = (type, delta) => {
    GameState.itemCounts[type] = clampInt(GameState.itemCounts[type] + delta, 0, 3);
    refreshConfigUI();
  };
  const adjustHp = (delta) => {
    GameState.startHealth = clampInt(GameState.startHealth + delta, 1, 5);
    refreshConfigUI();
  };

  ITEM_TYPES.forEach(type => {
    document.getElementById(`cfg-${type}-minus`).addEventListener('click', () => adjustItem(type, -1));
    document.getElementById(`cfg-${type}-plus`).addEventListener('click', () => adjustItem(type, 1));
  });
  document.getElementById('cfg-hp-minus').addEventListener('click', () => adjustHp(-1));
  document.getElementById('cfg-hp-plus').addEventListener('click', () => adjustHp(1));

  // 游戏模式选择（普通 / 赌局）
  document.querySelectorAll('.cfg-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      GameState.gameMode = btn.dataset.mode === 'gamble' ? 'gamble' : 'normal';
      refreshConfigUI();
    });
  });

  document.getElementById('btn-config-confirm').addEventListener('click', confirmConfig);
  document.getElementById('btn-config-cancel').addEventListener('click', closeConfigModal);

  refreshConfigUI();
}

// 对局详情面板：可拖动、可最小化
function initLogPanel() {
  const panel = document.getElementById('game-log');
  const handle = document.getElementById('log-drag-handle');
  const toggle = document.getElementById('btn-log-toggle');
  if (!panel || !handle || !toggle) return;

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.classList.toggle('minimized');
    toggle.textContent = panel.classList.contains('minimized') ? '＋' : '−';
  });

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.log-toggle')) return;
    dragging = true;
    panel.classList.add('dragging');
    const rect = panel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(event.clientX - offsetX, window.innerWidth - panel.offsetWidth));
    const y = Math.max(0, Math.min(event.clientY - offsetY, window.innerHeight - 32));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });

  const stopDrag = () => {
    dragging = false;
    panel.classList.remove('dragging');
  };
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
}

// 皮肤选择面板渲染
function renderSkinsPanel() {
  const panel = document.getElementById('skins-panel');
  if (!panel || !window.SkinManager) return;

  // 贴图皮肤（assets/skins/<分类>/<皮肤名>/，每类独立选择；角色=头像+角色二合一）
  const ASSET_CAT_LABELS = [
    { key: 'character', label: '选择角色' },
    { key: 'gun', label: '贴图 · 枪械' },
    { key: 'floor', label: '贴图 · 地图' },
    { key: 'table', label: '贴图 · 牌桌' }
  ];
  const hasAssetSkins = ASSET_CAT_LABELS.some(cat => {
    const names = window.SkinManager.assetSkinNames || {};
    return Array.isArray(names[cat.key]) && names[cat.key].length > 0;
  });
  let html = '';
  if (hasAssetSkins) {
    html += ASSET_CAT_LABELS.map(cat => {
      const names = window.SkinManager.assetSkinNames[cat.key] || [];
      const cur = window.SkinManager.currentAssetSkin[cat.key] || '';
      const opts = ['', ...names].map(name => {
        const label = name || '默认贴图';
        const sel = name === cur ? ' selected' : '';
        const swatch = name
          ? '<i class="preview preview-asset" title="贴图皮肤"></i>'
          : '<i class="preview preview-asset preview-asset-default"></i>';
        return `<button class="skin-opt${sel}" data-kind="asset" data-cat="${cat.key}" data-id="${name}" data-name="${label}" title="${label}">${swatch}<span>${label}</span></button>`;
      }).join('');
      return `<div class="skin-cat"><div class="skin-cat-head">${cat.label}</div><div class="skin-row">${opts}</div></div>`;
    }).join('');
  }

  panel.innerHTML = html;
}

// 事件绑定
function bindEvents() {
  // 首页按钮
  document.getElementById('btn-single').addEventListener('click', () => {
    openConfigModal('single');
  });

  document.getElementById('btn-multi').addEventListener('click', () => {
    showScreen('lobby-screen');
  });

  document.getElementById('btn-rules').addEventListener('click', () => {
    document.getElementById('rules-modal').classList.remove('hidden');
  });

  // 联机大厅
  document.getElementById('btn-create').addEventListener('click', () => {
    openConfigModal('create');
  });

  document.getElementById('btn-join').addEventListener('click', () => {
    document.getElementById('join-form').classList.remove('hidden');
    MultiPlayerGame.startRoomListPolling();
  });

  document.getElementById('btn-refresh-rooms').addEventListener('click', () => {
    MultiPlayerGame.refreshRoomList();
  });

  document.getElementById('room-list').addEventListener('click', (event) => {
    const joinBtn = event.target.closest('.room-row-join');
    if (!joinBtn) return;
    const roomId = joinBtn.dataset.roomId;
    const playerName = document.getElementById('input-player-name').value.trim();
    MultiPlayerGame.joinRoom(roomId, playerName);
  });

  document.getElementById('btn-back-home').addEventListener('click', () => {
    MultiPlayerGame.stopRoomListPolling();
    showScreen('home-screen');
  });

  // 等待房间
  document.getElementById('btn-leave-room').addEventListener('click', () => {
    if (GameState.ws) {
      GameState.ws.close();
    }
    showScreen('home-screen');
  });

  // 游戏操作（2D 瞄准射击：由 Game2D 判定瞄准后回调，不再使用开火按钮）
  window.Game2D.onShoot = (target, aimed) => {
    if (GameState.mode === 'single') {
      SinglePlayerGame.shoot(target, aimed);
    } else {
      MultiPlayerGame.shoot(target, aimed);
    }
  };

  document.getElementById('sound-toggle').addEventListener('click', () => {
    window.GameAudio?.toggle();
  });

  // 对决界面：点击开火（倒计时期间由 sendDuelShoot 内部拦截）
  const duelOverlay = document.getElementById('duel-overlay');
  if (duelOverlay) {
    duelOverlay.addEventListener('click', sendDuelShoot);
  }

  // 外观 / 皮肤
  document.getElementById('btn-skins').addEventListener('click', () => {
    renderSkinsPanel();
    document.getElementById('skins-modal').classList.remove('hidden');
  });

  document.getElementById('btn-close-skins').addEventListener('click', () => {
    document.getElementById('skins-modal').classList.add('hidden');
  });

  const skinsPanel = document.getElementById('skins-panel');
  if (skinsPanel) {
    skinsPanel.addEventListener('click', (event) => {
      const btn = event.target.closest('.skin-opt');
      if (!btn || !window.SkinManager) return;
      if (btn.dataset.kind === 'asset') {
        window.SkinManager.selectAssetSkin(btn.dataset.cat, btn.dataset.id);
        showToast(`已切换贴图皮肤：${btn.dataset.name}`);
      } else {
        window.SkinManager.select(btn.dataset.cat, btn.dataset.id);
        showToast(`已切换：${btn.dataset.name}`);
      }
      renderSkinsPanel();
    });
  }

  // 道具使用（事件委托：道具栏动态重建，直接绑定会失效）
  const itemsBarEl = document.getElementById('items-bar');
  if (itemsBarEl) {
    itemsBarEl.addEventListener('click', (event) => {
      const slot = event.target.closest('.item-slot');
      if (!slot || !slot.classList.contains('available')) return;
      const itemType = slot.dataset.item;
      if (!itemType) return;
      if (!GameState.gunPicked) {
        showToast('先拿起桌上的枪！');
        return;
      }
      if (GameState.mode === 'single') {
        SinglePlayerGame.useItem(itemType);
      } else {
        MultiPlayerGame.useItem(itemType);
      }
    });
  }

  // 结算界面
  document.getElementById('btn-restart').addEventListener('click', () => {
    if (GameState.mode === 'single') {
      SinglePlayerGame.init();
    } else {
      MultiPlayerGame.restart();
    }
  });

  document.getElementById('btn-back-result').addEventListener('click', () => {
    if (GameState.ws) {
      GameState.ws.close();
    }
    GameState.mode = null;
    GameState.gameActive = false;
    showScreen('home-screen');
  });

  // 弹窗关闭
  document.getElementById('btn-close-rules').addEventListener('click', () => {
    document.getElementById('rules-modal').classList.add('hidden');
  });

  document.getElementById('btn-close-peek').addEventListener('click', () => {
    document.getElementById('peek-modal').classList.add('hidden');
  });

  // 点击弹窗背景关闭
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal && modal.id !== 'ammo-modal' && modal.id !== 'draw-modal') {
        modal.classList.add('hidden');
      }
    });
  });
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  bindSettings();
  bindEvents();
  initLogPanel();
  showScreen('home-screen');

  // 2D模式：点击桌上的枪拿起后解锁操作
  window.Game2D.onPickup = () => {
    GameState.gunPicked = true;
    window.GameAudio?.play('pickup');
    updateGameUI();
  };
});
