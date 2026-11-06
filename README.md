# 流雲的创客空间

纯静态站点，无框架、无构建步骤、无自建后端。原生 JavaScript 加路径路由，内容集中在单个 JSON 文件里，供访客端与管理端共用。

线上地址：<https://liuyun2026.github.io>
管理端：<https://liuyun2026.github.io/admin/>

## 目录结构

```
index.html              访客端外壳：导航、页脚、内容挂载点
404.html                GitHub Pages 深层路径兜底，发布时由 index.html 复制
admin/index.html        管理端：网页上编辑内容并提交到仓库
assets/css/style.css    全部样式，颜色与间距集中在 :root 变量里
assets/js/app.js        路由、渲染、开场动画、滑动手势
assets/data/content.json  内容数据源：项目、笔记、资料、技能
assets/img/wallpaper.jpg  背景壁纸
.github/workflows/pages.yml  推送后自动部署
.nojekyll               关闭 Jekyll 处理，按静态文件原样发布
```

## 路由

| 地址 | 页面 |
|---|---|
| `/` | 首页 |
| `/projects` | 项目列表 |
| `/project/<id>` | 项目详情 |
| `/notes` | 笔记列表 |
| `/note/<id>` | 笔记详情 |
| `/files` | 资料 |
| `/admin/` | 管理端 |

地址不带 `#`，用 History API 切换；深层路径由 `404.html` 兜底，直接访问或刷新都不会 404。

## 更新内容

日常改内容走管理端：打开 `/admin/`，填一次 GitHub 令牌，之后在网页上增删改，点「保存并发布」即可，约 20 秒生效。

也可以直接改 `assets/data/content.json` 后发布。

## 本地预览

```bash
python -m http.server 8903
# 打开 http://127.0.0.1:8903/
```

资源使用绝对路径，不能直接双击 `index.html` 打开。

## 发布

```bash
./publish.sh "改动说明"
```

脚本会刷新静态资源的版本号、同步 `404.html`、提交并推送。版本号形如 `style.css?v=202611061453`，用于避开浏览器强缓存。

## 说明

站点不加载任何第三方脚本、字体或统计工具，唯一的外部请求是与页面同源的 `content.json`。
