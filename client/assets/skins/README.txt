=============================================
  分类贴图皮肤目录（每种类型可独立配置）
=============================================

游戏按【分类】读取皮肤：
  client/assets/skins/
    ├── gun/        枪械皮肤
    ├── avatar/     头像立绘（avatar-me / avatar-enemy）
    ├── player/     角色俯视角立绘（player0 / player1）
    ├── floor/      地图背景（floor）
    └── table/      牌桌（table）

每个分类下，每【建一个子文件夹 = 一套皮肤】，
游戏自动发现，在首页「外观 · 皮肤」弹窗中
按分类独立列出、独立选择（枪用 A 套、地图用 B 套
完全可以）。

【目录结构示例】

  client/assets/skins/
    ├── gun/
    │     ├── 黑金枪/    gun.png
    │     └── 红焰枪/    gun.png
    ├── avatar/
    │     └── 面具人/    avatar-me.png  avatar-enemy.png
    ├── player/
    │     └── 西装客/    player0.png  player1.png
    ├── floor/
    │     ├── 霓虹城/    floor.png
    │     └── 赌场/      floor.png
    └── table/
          └── 红桌/      table.png

【规则】
- 每套皮肤只需放入想替换的图，缺失的文件自动
  回退：该分类默认 assets/ 根目录 → 内置配色 → 代码绘制
- 图片规格与 client/assets/README.txt 完全一致
  （floor 整屏 16:9、table 椭圆约 2:1、gun 枪口朝上
   约 1:2.2、player 俯视角色、avatar 立绘头像）
- 文件夹名 = 弹窗里显示的名字，中文可用
- 每个分类都有一个"默认贴图"选项（用 assets/ 根目录的图）
- 每类的选择分别保存在浏览器 localStorage，自动恢复

【注意】
- 添加 / 删除皮肤文件夹后，刷新页面即可看到变化
  （服务器无需重启，接口实时读取目录）
