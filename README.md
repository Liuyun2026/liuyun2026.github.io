# 流雲的创客空间

纯静态站点，无框架、无构建步骤、无自建后端。原生 JavaScript 加路径路由，内容按类别拆在 `content/` 下的几个 JSON 里，供访客端与管理端共用。

线上地址：<https://liuyun2026.github.io>
管理端：<https://liuyun2026.github.io/admin/>

## 目录结构

```
index.html                访客端外壳：导航、页脚、内容挂载点
404.html                  GitHub Pages 深层路径兜底，发布时由 index.html 复制
admin/ manage/ theme/     管理端：欢迎页 / 内容编辑器 / 壁纸与玻璃
manual/                   操作手册（运行时把 manual.md 渲染成页面）
assets/css/style.css      设计变量 + 访客端样式
assets/css/admin.css      管理端样式
assets/js/app.js          路由、渲染、开场动画、滑动手势
assets/js/admin-app.js    管理端三个视图 + 写入 GitHub
assets/js/pageflow.js     独立页面之间的跳转过渡
assets/js/vercheck.js     构建号自检，绕开 HTML 的十分钟缓存
assets/img/               壁纸
assets/uploads/           正文插图与附件
content/                  meta / projects / notes / files / journal / theme / build
.github/workflows/pages.yml  推送后自动部署
.nojekyll                 关闭 Jekyll 处理，按静态文件原样发布
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
| `/journal` | 日志与碎碎念 |
| `/admin/` | 管理端 |
| `/manage/` | 内容编辑器 |
| `/theme/` | 壁纸与玻璃 |
| `/manual/` | 操作手册 |

地址不带 `#`，用 History API 切换；深层路径由 `404.html` 兜底，直接访问或刷新都不会 404。

## 更新内容

日常改内容走管理端：打开 `/admin/`，填一次 GitHub 令牌，之后在网页上增删改，点「保存并发布」即可，约 20 秒生效。

也可以直接改 `content/*.json` 后发布。四个列表（projects / notes / files / journal）由管理端写入，`meta.json` 手工维护，管理端不会重写。

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

站点不加载任何第三方脚本、字体或统计工具，访客端的外部请求只有同源的 `content/*.json`。管理端另外调用 GitHub API 提交内容。
