# 流雲的个人站点

纯静态单页站点，无框架、无构建步骤、无后端。原生 JavaScript 加 hash 路由，全部内容由一份数据文件驱动。

线上地址：<https://liuyun2026.github.io>

## 目录结构

```
index.html              页面外壳：导航、页脚、内容挂载点
assets/css/style.css    全部样式，颜色与间距集中在 :root 变量里
assets/js/data.js       内容数据源：项目、笔记、资料、技能
assets/js/app.js        路由、渲染、筛选与搜索
assets/files/           本地资料文件（datasheet、手册等）
.nojekyll               关闭 Jekyll 处理，按静态文件原样发布
```

## 路由

| 地址 | 页面 |
|---|---|
| `#/` | 首页 |
| `#/projects` | 项目列表 |
| `#/project/<id>` | 项目详情 |
| `#/notes` | 笔记列表 |
| `#/note/<id>` | 笔记正文 |
| `#/files` | 资料 |

## 更新内容

所有内容改 `assets/js/data.js`，保存后刷新页面即可。

新增项目：向 `SITE.projects` 追加对象，`id` 唯一，`specs` 为 `[名称, 值]` 数组，会被渲染成参数表。

新增笔记：向 `SITE.notes` 追加对象。`body` 是字符串数组，逐行拼接；支持 `##` 小节、`-` 列表、`>` 引用和代码围栏，行内支持反引号、`**加粗**`、`[文字](链接)`。带 `draft: true` 的条目不渲染，可用来存格式模板。

新增资料：文件放进 `assets/files/`，在 `SITE.files` 里加一条。本地文件用 `path: "assets/files/文件名"`，外部链接用 `url`。`kind` 取 `datasheet / manual / tool / image / other`。

## 部署

推送到 `main` 分支后，GitHub Pages 自动构建发布，无需额外操作。

## 说明

站点不加载任何第三方脚本、字体或统计工具，页面内容不依赖外部请求。
