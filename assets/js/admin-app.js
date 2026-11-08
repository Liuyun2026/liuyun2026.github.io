/* ============================================================================
 * admin-app.js —— 管理端单页应用
 *
 * /admin/、/manage/、/theme/ 三个地址共用同一份 shell，
 * 由 location.pathname 决定渲染哪个视图；视图之间切换只替换 DOM，
 * 与访客端项目/笔记/资料一致的淡出→替换→淡入，不做整页加载。
 *
 * 视图：
 *   home    管理端主页（果冻卡片 + 五个气泡）
 *   manage  内容编辑器（三栏）
 *   theme   壁纸管理
 * ========================================================================== */

(function () {
  "use strict";

  var OWNER = "Liuyun2026", REPO = "liuyun2026.github.io", BRANCH = "main";
  var TOKEN_KEY = "gh_admin_token";
  var DEFAULT_WALLPAPER = "/assets/img/wallpaper.jpg";

  var root = document.getElementById("admView");
  if (!root) return;

  var current = "";        /* 当前渲染的视图名 */
  /* 壁纸和玻璃质感都分访客端 / 管理端两侧，各自独立取值。
     历史版本里 glass 是一个字符串（两端共用），读入时补成两侧同值 */
  var GLASS_VALUES = ["clear", "frosted"];

  function normGlass(g) {
    var guest = (typeof g === "string") ? g : (g && g.guest);
    var admin = (typeof g === "string") ? g : (g && g.admin);
    return {
      guest: GLASS_VALUES.indexOf(guest) > -1 ? guest : "frosted",
      admin: GLASS_VALUES.indexOf(admin) > -1 ? admin : "frosted"
    };
  }

  /* 初始值取本机记忆。未连接时不读 theme.json，若这里写死磨砂，
     applyGlass() 一跑就会把首屏脚本设好的透明档冲掉 */
  var glassMem = null;
  try { glassMem = localStorage.getItem("glass-admin"); } catch (e) {}
  var themeState = { guest: DEFAULT_WALLPAPER, admin: DEFAULT_WALLPAPER,
    glass: { guest: "frosted", admin: glassMem === "clear" ? "clear" : "frosted" } };
  var themeHistory = [];      /* 历史壁纸，随 content/theme.json 持久化 */
  var pendingUploads = [];    /* 待发布图片：{ rel, b64, url } */
  var pendingDeletes = [];    /* 待删除的仓库图片路径 */
  var localPreview = { guest: "", admin: "" };  /* 未发布图片的本地 object URL */
  var historyTarget = "guest";/* 历史项「使用」应用到哪一侧 */
  var themeDirty = false;
  var content = null;      /* 内容 JSON */
  var contentDirty = false;
  var contentStub = false; /* content 是未连接时生成的空基线，连接后要重新从远端载入 */

  /* ---------- 通用工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* ---------- 路由 ---------- */

  function viewOfPath() {
    var p = (location.pathname || "/").replace(/\/+$/, "") || "/";
    if (p === "/manage") return "manage";
    if (p === "/theme") return "theme";
    return "home";
  }

  function pathOfView(v) {
    return v === "manage" ? "/manage/" : v === "theme" ? "/theme/" : "/admin/";
  }

  /* ---------- 壁纸 ---------- */

  /* 壁纸先离屏解码再换背景，避免主线程整图解码撞上开场动画；
     片头期间挂起，动画结束后再换 */
  var pendingWallpaper = "";

  function paintWallpaper(url) {
    if (!url) return;
    /* 同访客端：记住地址，供下次首屏直接使用 */
    try { localStorage.setItem("bg-admin", url); } catch (e) {}
    /* 解码、挂地址、淡入都在 assets/js/bg.js 里，三端共用一个实现 */
    if (typeof window.__bgPaint === "function") window.__bgPaint(url);
  }

  function applyAdminWallpaper(url) {
    if (!url) return;
    if (document.documentElement.classList.contains("intro-on")) {
      pendingWallpaper = url;
      return;
    }
    paintWallpaper(url);
  }

  function flushWallpaper() {
    if (!pendingWallpaper) return;
    var url = pendingWallpaper;
    pendingWallpaper = "";
    paintWallpaper(url);
  }

  function loadTheme() {
    /* 未连接时不读取壁纸状态：.bg 直接用 CSS 里的默认壁纸，
       预览与历史保持默认空态。上传仍走本地暂存，不依赖这次读取 */
    if (!token()) return Promise.resolve();
    return fetch("/content/theme.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("theme");
        return r.json();
      })
      .then(function (t) {
        /* 有未发布的本地改动时不覆盖，避免迟到的响应把刚选好的壁纸冲回旧值 */
        if (themeDirty) return;
        themeState.guest = (t && t.guest) || DEFAULT_WALLPAPER;
        themeState.admin = (t && t.admin) || DEFAULT_WALLPAPER;
        themeState.glass = normGlass(t && t.glass);
        themeHistory = (t && Array.isArray(t.history)) ? t.history.slice() : [];
      })
      .catch(function () {});
  }

  /* ---------- 顶栏 ---------- */

  function setStatus(text, on) {
    var s = $("status");
    if (!s) return;
    s.textContent = text;
    s.classList.toggle("on", !!on);
    /* 连接状态统一由令牌是否存在决定：所有绿点（顶栏 .nav-status + 首页胶囊）
       未连接即红，不再依赖「未连接」文案，避免首页显示「管理端」时绿点不跟状态变红 */
    var connected = !!token();
    var box = s.closest ? s.closest(".nav-status") : null;
    if (box) box.classList.toggle("is-off", !connected);
    [].forEach.call(document.querySelectorAll(".jelly-meta .pill .dot"), function (d) {
      d.classList.toggle("is-off", !connected);
    });
  }

  function syncStatusForView(v) {
    var connected = !!token();
    if (v === "home") {
      /* 主页文案固定为「管理端」，但胶囊与顶栏的点跟随连接状态 */
      setStatus("管理端", connected);
      return;
    }
    if (connected) setStatus("已连接", true);
    else setStatus("未连接", false);
  }

  function markNav(v) {
    [].forEach.call(document.querySelectorAll(".adm-nav [data-adm]"), function (a) {
      a.classList.toggle("on", a.getAttribute("data-adm") === v);
    });
  }

  /* ==========================================================================
   * 视图一：管理端主页
   * ======================================================================== */

  function homeHtml() {
    var bubbles = [
      { view: "manage", t: "内容", e: "Content",
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.2"/><circle cx="9.5" cy="17" r="2.2"/></svg>' },
      { view: "theme", t: "壁纸", e: "Theme",
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M3.5 16.5 9 12l4 3.5 3.5-3 4 4"/></svg>' }
    ];
    var externals = [
      { href: "/projects?from=admin", t: "项目", e: "Projects",
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7z"/><path d="M3.5 7 12 11.4 20.5 7M12 11.4V21.2"/></svg>' },
      { href: "/notes?from=admin", t: "笔记", e: "Notes",
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h9L19 7.5v13H6z"/><path d="M14.5 3.5V8H19"/><path d="M9 12h7M9 15.5h7M9 8.5h2.5"/></svg>' },
      { href: "/files?from=admin", t: "资料", e: "Files",
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>' }
    ];

    var all = externals.concat(bubbles);

    return '<div class="adm-welcome">' +
      '<div class="home">' +
        '<section class="hero-jelly">' +
          '<div class="jelly">' +
            '<span class="jelly-tag">你好</span>' +
            '<h1>欢迎来到<span class="hl">流雲</span>的创客空间<span class="adm-tag">管理端</span></h1>' +
            '<div class="jelly-meta">' +
              '<span class="pill"><i class="dot"></i>管理端</span>' +
              '<a class="pill pill--link" href="/">进入站点 →</a>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<nav class="bubbles">' +
          all.map(function (b) {
            var attrs = b.view ? ' href="' + pathOfView(b.view) + '" data-adm="' + b.view + '"' : ' href="' + b.href + '"';
            return '<a class="bubble"' + attrs + '>' +
              '<span class="bubble-ico">' + b.ico + '</span>' +
              '<span class="bubble-t">' + b.t + '</span>' +
              '<span class="bubble-e">' + b.e + '</span></a>';
          }).join("") +
        '</nav>' +
      '</div>' +
    '</div>';
  }

  /* ---------- 开场动画 ---------- */

  var introTimers = [];
  var introRunning = false;

  function introLater(fn, ms) { introTimers.push(window.setTimeout(fn, ms)); }
  function clearIntroTimers() {
    for (var i = 0; i < introTimers.length; i++) window.clearTimeout(introTimers[i]);
    introTimers = [];
  }

  function introOff() {
    document.documentElement.classList.remove("intro-on", "intro-pending");
    /* 片头结束，补上等待中的壁纸 */
    flushWallpaper();
  }

  function skipIntro() {
    if (!introRunning) return;
    introRunning = false;
    clearIntroTimers();

    var card = document.querySelector(".jelly");
    var layer = document.getElementById("introLayer");

    if (card) {
      card.style.transition = "transform .32s cubic-bezier(.3,1,.4,1), border-radius .28s ease";
      card.style.transform = "";
      card.style.borderRadius = "";
      card.classList.remove("is-intro");
      window.setTimeout(function () { card.style.transition = ""; }, 340);
    }
    if (layer) {
      layer.classList.remove("on");
      layer.style.transition = "none";
      layer.style.transform = "";
    }
    introOff();
  }

  /* 版本自检未结束前不启动时间轴：旧 HTML 会被 vercheck 重载，
     若中途启动就会出现片头播一半后整段重播。请求异常时 2 秒兜底放行。 */
  function afterVerCheck(fn) {
    var vc = window.__VERCHECK__;
    if (!vc || typeof vc.then !== "function") { fn(); return; }
    var fired = false;
    var go = function () { if (fired) return; fired = true; fn(); };
    vc.then(go);
    window.setTimeout(go, 2000);
  }

  /* short = SPA 内切回主页的短版：只弹气泡，不受版本自检阻塞。
     整页进入 /admin/ 时播完整版，沿用原时间轴。 */
  function playIntro(short) {
    var bubbles = document.querySelector(".bubbles");
    var done = function () { if (bubbles) bubbles.classList.add("play"); };

    if (short) { introOff(); done(); return; }
    afterVerCheck(function () { playIntroNow(done); });
  }

  function playIntroNow(done) {
    var card = document.querySelector(".jelly");
    /* 静态首屏层由 admin/index.html 提供，不在视图 HTML 里重建 */
    var layer = document.getElementById("introLayer");
    var boot = document.getElementById("introBoot");

    if (!card || !layer) { introOff(); done(); return; }
    if (reduceMotion()) { introOff(); done(); return; }

    /* 撤掉待播状态：卡片此刻由 is-intro 接管显示 */
    document.documentElement.classList.remove("intro-pending");

    var hello = layer.querySelector(".intro-hello");
    var welcome = layer.querySelector(".intro-welcome");
    if (!hello || !welcome) { introOff(); done(); return; }

    /* 静态层首帧已显示「你好」；清掉上一轮留下的状态再接管时间轴 */
    hello.classList.remove("out");
    welcome.classList.remove("in");
    hello.classList.add("show");

    var r = card.getBoundingClientRect();
    if (!r.width || !r.height) { introOff(); done(); return; }

    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.max(vw / r.width, vh / r.height) * 1.02;
    var dx = vw / 2 - (r.left + r.width / 2);
    var dy = vh / 2 - (r.top + r.height / 2);
    var move = "translate3d(" + dx + "px," + dy + "px,0)";

    introRunning = true;
    document.documentElement.classList.add("intro-on");
    card.classList.add("is-intro");

    card.style.transformOrigin = "50% 50%";
    card.style.transform = move + " scale(" + s + ")";

    /* 卡片已铺满且与静态底同色，此时淡出静态底，画面不出现空档 */
    if (boot) boot.classList.add("fade");

    layer.style.transform = "translate3d(0,0,0)";
    layer.classList.add("on");

    introLater(function () { hello.classList.add("show"); }, 120);
    introLater(function () { hello.classList.add("out"); }, 1250);
    introLater(function () { welcome.classList.add("in"); }, 1700);

    introLater(function () {
      var ease = "cubic-bezier(.32,.9,.3,1)";
      card.style.transition = "transform 1.35s " + ease;
      card.style.transform = "translate3d(0,0,0) scale(1)";
      layer.style.transition = "transform 1.35s " + ease + ", opacity .55s ease";
      layer.style.transform = "translate3d(" + (-dx) + "px," + (-dy) + "px,0)";
      layer.classList.remove("on");
    }, 2500);

    introLater(function () { card.classList.remove("is-intro"); }, 3750);

    introLater(function () {
      card.style.transition = "none";
      card.style.transform = "";
      layer.style.transition = "none";
      layer.style.transform = "";
      window.setTimeout(function () {
        card.style.transition = "";
        layer.style.transition = "";
      }, 60);
      introOff();
      done();
      introRunning = false;
    }, 3900);
  }

  var firstAdmRender = true;

  function mountHome() {
    /* 整页进入播完整版；SPA 内切回主页播短版（只弹气泡） */
    playIntro(!firstAdmRender);
  }

  /* ==========================================================================
   * 视图二：内容编辑器
   * ======================================================================== */

  var curType = "projects";
  var curIndex = -1;

  /* 编辑器只负责四个列表文件。meta.json 由访客端读取、单独维护，
     编辑器没有对应表单，保存时不得重写，否则会被数组兜底写成 [] */
  var PARTS = ["projects", "notes", "files", "journal"];

  function manageHtml() {
    return '<div class="adm-main">' +
      '<aside class="adm-panel adm-left">' +
        '<div class="adm-col-scroll">' +
          '<div class="adm-token" id="tokenRow">' +
            '<input id="tokenInput" type="password" placeholder="粘贴令牌" autocomplete="off">' +
            '<button id="tokenSave">连接</button>' +
          '</div>' +
          '<div class="adm-tabs" id="tabs">' +
            '<button data-type="projects" class="on">项目</button>' +
            '<button data-type="notes">笔记</button>' +
            '<button data-type="files">资料</button>' +
            '<button data-type="journal">日志与碎碎念</button>' +
          '</div>' +
          '<div id="list"></div>' +
          '<button class="adm-add" id="addBtn">+ 新建一条</button>' +
        '</div>' +
        '<div class="adm-leftlinks">' +
          '<a class="adm-manual" href="/manual/" target="_blank" rel="noopener">操作手册 ↗</a>' +
        '</div>' +
      '</aside>' +
      '<section class="adm-panel" id="edit"></section>' +
      '<aside class="adm-panel adm-preview">' +
        '<div class="adm-col-scroll">' +
          '<div class="adm-preview-head">预览 · 正文</div>' +
          '<div class="prose adm-preview-body" id="previewBody">' +
            '<div class="hintline">选中一条内容后，这里显示正文效果</div>' +
          '</div>' +
        '</div>' +
        '<div class="adm-preview-foot">' +
          '<div class="adm-msg" id="msg"></div>' +
          '<div class="adm-foot-btns">' +
            '<button class="adm-del" id="delBtn">删除这一条</button>' +
            '<button class="adm-save" id="saveBtn">保存并发布</button>' +
          '</div>' +
        '</div>' +
      '</aside>' +
    '</div>';
  }

  function msg(text, kind) {
    var m = $("msg");
    if (!m) return;
    m.textContent = text || "";
    m.className = "adm-msg" + (kind ? " " + kind : "");
  }

  function items() { return (content && content[curType]) || []; }

  function titleOf(item) {
    if (curType === "journal") {
      var t = String(item.text || "").replace(/\s+/g, " ").trim();
      return t ? (t.length > 24 ? t.slice(0, 24) + "…" : t) : (item.date || "（空）");
    }
    return item.title || item.name || item.id || "（未命名）";
  }
  function subOf(item) {
    if (curType === "journal") return item.date || "";
    if (curType === "files") return item.kind || "";
    return item.category || item.date || "";
  }

  function renderList() {
    var box = $("list");
    if (!box) return;
    box.innerHTML = items().map(function (it, i) {
      return '<div class="adm-item' + (i === curIndex ? " on" : "") + '" data-i="' + i + '">' +
        '<span class="t">' + esc(titleOf(it)) + "</span>" +
        '<span class="d">' + esc(subOf(it)) + "</span></div>";
    }).join("") || '<div class="adm-empty">还没有内容</div>';
  }

  function select(i) {
    curIndex = i;
    renderList();
    renderEdit();
  }

  function field(label, key, val, hint, type) {
    var input;
    if (type === "area") {
      input = '<textarea data-k="' + key + '">' + esc(val || "") + "</textarea>";
    } else if (type === "month" || type === "date") {
      /* 原生日期控件：深色由 color-scheme: dark 接管 */
      input = '<input type="' + type + '" data-k="' + key + '" value="' + esc(val || "") + '">';
    } else {
      input = '<input data-k="' + key + '" value="' + esc(val || "") + '">';
    }
    return '<div class="adm-field"><label>' + esc(label) + "</label>" + input +
      (hint ? '<div class="hintline">' + hint + "</div>" : "") + "</div>";
  }

  /* 分类与状态：下拉给常用值，下面的输入框可直接改；最终以输入框为准 */
  /* 分类 / 状态：自绘下拉。
     原生 select 的弹出层由系统绘制，深色主题下选项发灰、字号也改不了，
     所以整块自己画；最后一项「其他…」切到手动输入，值仍然写进 [data-k] */
  function choiceField(label, key, val, options) {
    var v = String(val || "");
    /* options 可以是纯字符串，也可以是 [存储值, 显示文字]：
       资料类型要存 datasheet 这类 key，界面上显示中文 */
    var pairs = options.map(function (o) {
      return Array.isArray(o) ? [String(o[0]), String(o[1])] : [String(o), String(o)];
    });
    var labelOf = function (x) {
      var hit = "";
      pairs.forEach(function (p) { if (p[0] === x) hit = p[1]; });
      return hit || x;
    };
    var known = pairs.some(function (p) { return p[0] === v; });
    var map = {};
    pairs.forEach(function (p) { map[p[0]] = p[1]; });
    var items = pairs.map(function (p) {
      return '<button type="button" data-v="' + esc(p[0]) + '"' +
        (p[0] === v ? ' class="on"' : "") + ">" + esc(p[1]) + "</button>";
    }).join("");
    /* 当前是自定义值：排在最前并选中，免得用户以为丢了 */
    if (v && !known) {
      items = '<button type="button" data-v="' + esc(v) + '" class="on">' + esc(v) + "</button>" + items;
    }
    return '<div class="adm-field">' +
      "<label>" + esc(label) + "</label>" +
      '<div class="adm-pick" data-pick2="' + key + '" data-labels="' + esc(JSON.stringify(map)) + '">' +
        '<button type="button" class="adm-pick-btn">' +
          '<span class="adm-pick-val' + (v ? "" : " is-empty") + '">' + esc(v ? labelOf(v) : "请选择") + "</span>" +
          '<svg class="adm-pick-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
        "</button>" +
        '<div class="adm-pick-menu">' + items +
          '<button type="button" class="adm-pick-other" data-v="__custom__">其他…</button>' +
        "</div>" +
        '<input class="adm-pick-input" data-k="' + key + '" value="' + esc(v) + '" hidden>' +
      "</div>" +
    "</div>";
  }

  /* 自绘日期选择器。原生日历弹层由系统绘制，圆角、配色、字体都跟站点不一致，
     这里整块自己画，视觉与下拉、输入框保持一套。
     mode = "month" 只选年月（笔记），"date" 选到日（碎碎念） */
  /* 存储值仍然是 2026-11 / 2026-11-07，界面上显示成「2026 年 11 月」
     和「2026 年 11 月 7 日」，跟日历标题同一套写法 */
  function dateText(v) {
    var m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(String(v || ""));
    if (!m) return String(v || "");
    if (m[3]) return m[1] + " 年 " + Number(m[2]) + " 月 " + Number(m[3]) + " 日";
    return m[1] + " 年 " + Number(m[2]) + " 月";
  }

  function dateField(label, key, val, mode) {
    var v = String(val || "");
    return '<div class="adm-field">' +
      "<label>" + esc(label) + "</label>" +
      '<div class="adm-date" data-date="' + key + '" data-mode="' + (mode === "month" ? "month" : "date") + '">' +
        '<button type="button" class="adm-pick-btn adm-date-btn">' +
          '<span class="adm-pick-val' + (v ? "" : " is-empty") + '">' + esc(v ? dateText(v) : "请选择") + "</span>" +
          '<svg class="adm-pick-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
        "</button>" +
        '<div class="adm-date-pop">' +
          '<div class="adm-date-head">' +
            '<button type="button" data-nav="-1" aria-label="上个月">‹</button>' +
            '<span class="adm-date-title"></span>' +
            '<button type="button" data-nav="1" aria-label="下个月">›</button>' +
          "</div>" +
          '<div class="adm-date-grid"></div>' +
          '<div class="adm-date-foot">' +
            '<button type="button" data-clear>清除</button>' +
            '<button type="button" data-today>今天</button>' +
          "</div>" +
        "</div>" +
        '<input class="adm-pick-input" data-k="' + key + '" value="' + esc(v) + '" hidden>' +
      "</div>" +
    "</div>";
  }

  function bodyField(it, hint) {
    return '<div class="adm-field"><label>正文</label>' +
      '<div class="adm-tools" data-tools>' +
        '<button data-ins="h2">标题</button>' +
        '<button data-ins="ul">列表</button>' +
        '<button data-ins="quote">引用</button>' +
        '<button data-ins="code">代码块</button>' +
        '<button data-ins="table">表格</button>' +
        '<button data-ins="link">链接</button>' +
        '<button data-ins="image">图片</button>' +
      '</div>' +
      '<textarea data-k="body">' + esc((it.body || []).join("\n")) + '</textarea>' +
      (hint ? '<div class="hintline">' + hint + '</div>' : "") +
    '</div>';
  }

  function insertAt(ta, text) {
    var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
    ta.value = v.slice(0, a) + text + v.slice(b);
    var pos = a + text.length;
    ta.selectionStart = ta.selectionEnd = pos;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
  }

  /* ---------- 预览渲染 ---------- */

  function inlineMd(t) {
    var codes = [];
    var s = String(t).replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return "\u0001" + (codes.length - 1) + "\u0001";
    });
    s = esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s.replace(/\u0001(\d+)\u0001/g, function (_, n) {
      return "<code>" + esc(codes[+n]) + "</code>";
    });
  }

  function tableCells(line) {
    var str = String(line).trim().replace(/^\|/, "").replace(/\|$/, "");
    var cells = [], cur = "";
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === "\\" && str[i + 1] === "|") { cur += "|"; i++; continue; }
      if (ch === "|") { cells.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function renderMd(text) {
    var lines = String(text).replace(/\r\n/g, "\n").split("\n");
    var out = [], i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*```/.test(line)) {
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
        continue;
      }

      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?[\s:|-]*$/.test(lines[i + 1])) {
        var head = tableCells(line);
        i += 2;
        var body = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { body.push(tableCells(lines[i])); i++; }
        out.push('<div class="tablewrap"><table><thead><tr>' +
          head.map(function (c) { return "<th>" + inlineMd(c) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          body.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + inlineMd(c) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>");
        continue;
      }

      var m = line.match(/^(#{1,4})\s+(.*)$/);
      if (m) {
        var lv = Math.min(m[1].length + 2, 4);
        out.push("<h" + lv + ">" + inlineMd(m[2]) + "</h" + lv + ">");
        i++;
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        var ul = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          ul.push(lines[i].replace(/^\s*[-*]\s+/, ""));
          i++;
        }
        out.push("<ul>" + ul.map(function (x) { return "<li>" + inlineMd(x) + "</li>"; }).join("") + "</ul>");
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        out.push("<blockquote><p>" + inlineMd(q.join(" ")) + "</p></blockquote>");
        continue;
      }

      if (!line.trim()) { i++; continue; }

      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(#{1,4}\s|\s*\||\s*[-*]\s|\s*>|\s*```)/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) out.push("<p>" + inlineMd(para.join(" ")) + "</p>");
    }
    return out.join("");
  }

  function updatePreview(it) {
    var box = $("previewBody");
    if (!box) return;
    /* 日志没有 body 字段，预览直接渲染 text，图片语法在这里也可所见即所得 */
    var text = curType === "journal"
      ? String((it && it.text) || "").trim()
      : ((it && it.body) || []).join("\n").trim();
    if (!text) {
      box.innerHTML = '<div class="hintline">这条还没有正文</div>';
      return;
    }
    box.innerHTML = renderMd(text);
  }

  /* ---------- 上传 ---------- */

  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function b64FromBuf(buf) {
    var bytes = new Uint8Array(buf), bin = "";
    var CHUNK = 8192;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  /* ---------- 图片压缩 ----------
   * 手机直出的照片常有 3~8MB，直接传会明显卡：上传慢、预览慢、
   * base64 体积膨胀三分之一、提交也慢。这里统一缩到长边 2400px、
   * JPEG 质量 0.82，肉眼几乎无差，体积通常降到 200~400KB。
   */
  var IMG_MAX_EDGE = 2400;
  var IMG_QUALITY = 0.82;

  function compressImage(file) {
    /* 动图与矢量图不处理，避免丢帧或栅格化 */
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) return Promise.resolve(file);
    if (file.size < 350 * 1024) return Promise.resolve(file);

    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);

        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, IMG_MAX_EDGE / Math.max(w, h));
        var tw = Math.round(w * scale), th = Math.round(h * scale);

        var cv = document.createElement("canvas");
        cv.width = tw;
        cv.height = th;
        var ctx = cv.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, tw, th);

        cv.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
        }, "image/jpeg", IMG_QUALITY);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  function safeName(n) {
    return String(n).replace(/[\\/:*?"<>|#%]/g, "_").replace(/\s+/g, "-");
  }

  function uploadOne(file, folder, sub) {
    var tk = token();
    if (!tk) return Promise.reject(new Error("请先填入令牌并连接"));
    if (file.size > 20 * 1024 * 1024) {
      return Promise.reject(new Error(file.name + " 超过 20MB，建议放网盘"));
    }

    var rel = "assets/uploads/" + folder + "/" + (sub ? sub + "/" : "") + Date.now() + "-" + safeName(file.name);
    var api = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + encodeURI(rel);

    return file.arrayBuffer().then(function (buf) {
      return fetch(api, {
        method: "PUT",
        headers: {
          "Authorization": "Bearer " + tk,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "上传：" + file.name,
          content: b64FromBuf(buf),
          branch: BRANCH
        })
      });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function () { throw new Error("上传失败 " + r.status); });
      return "/" + rel;
    });
  }

  function pickImage(ta) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = function () {
      if (!inp.files.length) return;
      var f = inp.files[0];
      msg("压缩并上传中…");
      compressImage(f).then(function (out) {
        return uploadOne(out, "images", "").then(function (url) {
          insertAt(ta, "![" + out.name.replace(/\.[^.]+$/, "") + "](" + url + ")");
          msg("图片已插入（" + Math.round(out.size / 1024) + " KB），记得保存", "ok");
        });
      }).catch(function (e) { msg(e.message, "err"); });
    };
    inp.click();
  }

  /* ---------- 附件 ---------- */

  function attachPanel() {
    return '<div class="adm-attach">' +
      '<div class="adm-attach-head">附件 · 会显示在正文末尾供下载</div>' +
      '<div id="attachBox"></div>' +
      '<div class="adm-attach-actions">' +
        '<button data-addfile>添加文件</button>' +
        '<button data-adddir>添加文件夹</button>' +
      '</div></div>';
  }

  function renderAttach(it) {
    var box = $("attachBox");
    if (!box) return;
    var list = it.attachments || [];
    box.innerHTML = list.length
      ? list.map(function (a, i) {
          return '<div class="adm-attach-item">' +
            '<span class="n">' + esc(a.name) + "</span>" +
            '<span class="s">' + esc(a.size || "") + "</span>" +
            '<span class="x" data-del="' + i + '">移除</span></div>';
        }).join("")
      : '<div class="hintline">还没有附件</div>';
  }

  function addAttachments(it, useDir) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    if (useDir) inp.setAttribute("webkitdirectory", "");
    inp.onchange = function () {
      var files = Array.prototype.slice.call(inp.files);
      if (!files.length) return;
      msg("上传中，共 " + files.length + " 个文件…");
      var done = 0, folder = (curType === "notes" ? "notes/" : "projects/") + safeName(it.id || "misc");

      files.reduce(function (chain, f) {
        return chain.then(function () {
          var rel = f.webkitRelativePath || f.name;
          var sub = rel.indexOf("/") >= 0 ? rel.split("/").slice(0, -1).join("/") : "";
          return uploadOne(f, folder, sub).then(function (url) {
            it.attachments = it.attachments || [];
            it.attachments.push({ name: rel, path: url, size: fmtSize(f.size) });
            done++;
            contentDirty = true;
            renderAttach(it);
            msg("已上传 " + done + "/" + files.length + "，记得点保存");
          });
        });
      }, Promise.resolve()).then(function () {
        msg("上传完成，共 " + done + " 个，记得点保存", "ok");
      }).catch(function (e) { msg(e.message, "err"); });
    };
    inp.click();
  }

  /* ---------- 表单 ---------- */

  function renderEdit() {
    var wrap = $("edit");
    if (!wrap) return;
    var it = items()[curIndex];
    var delB = $("delBtn");
    if (delB) delB.disabled = !it;
    if (!it) {
      wrap.innerHTML = '<div class="adm-empty">从左侧选一条，或点「新建一条」</div>';
      updatePreview(null);
      return;
    }

    var html = "";
    if (curType === "projects") {
      html += '<div class="adm-row">' + field("标题", "title", it.title) + field("标识 id（英文，唯一）", "id", it.id) + "</div>";
      html += field("副标题", "subtitle", it.subtitle);
      html += '<div class="adm-row">' +
        choiceField("分类", "category", it.category, ["硬件", "软件", "文档"]) +
        choiceField("状态", "status", it.status, ["进行中", "已完成", "计划中", "开源", "搁置"]) +
      "</div>";
      html += field("摘要", "summary", it.summary, "显示在列表页和详情页开头", "area");
      html += field("标签", "tags", (it.tags || []).join("、"), "用顿号或逗号分隔");
      html += field("参数表", "specs", (it.specs || []).map(function (r) { return r[0] + " | " + r[1]; }).join("\n"),
        "每行一条，格式：名称 | 值", "area");
      html += bodyField(it, "支持 ## 标题、- 列表、> 引用、表格、图片、链接，以及反引号代码");
      html += field("链接", "links", (it.links || []).map(function (l) { return l.label + " | " + l.url; }).join("\n"),
        "每行一条，格式：文字 | 链接，显示在正文下方", "area");
      html += attachPanel();
    } else if (curType === "notes") {
      html += field("标题", "title", it.title);
      html += '<div class="adm-row">' + field("标识 id（英文，唯一）", "id", it.id) + dateField("日期", "date", it.date, "date") + "</div>";
      html += field("标签", "tags", (it.tags || []).join("、"), "用顿号或逗号分隔");
      html += field("摘要", "summary", it.summary, "", "area");
      html += bodyField(it, "支持 ## 标题、- 列表、> 引用、表格、图片、链接，以及反引号代码");
      html += attachPanel();
    } else if (curType === "journal") {
      html += '<div class="adm-row">' + dateField("日期", "date", it.date, "date") +
        choiceField("心情 / 标记（可选）", "mood", it.mood, ["好嗨", "普通", "一般", "有点累", "很累"]) + "</div>";
      html += field("内容", "text", it.text, "支持换行；点「插入图片」把图片放进正文，也可手写 ![说明](图片地址)", "area");
      html += '<div class="adm-tools"><button type="button" data-jimg>插入图片</button></div>';
    } else {
      html += field("名称", "name", it.name);
      html += '<div class="adm-row">' +
        choiceField("类型", "kind", it.kind, [["datasheet", "数据手册"], ["manual", "手册"], ["tool", "工具"], ["image", "图片"], ["other", "其他"]]) +
        field("大小", "size", it.size, "可留空") + "</div>";
      html += field("说明", "note", it.note);
      html += field("链接", "url", it.url, "网盘或外部地址，填了以后条目可点击");
      html += bodyField(it, "可选。支持 ## 标题、- 列表、> 引用、表格、图片、链接；有正文时资料页可以展开查看");
    }

    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll("[data-k]"), function (el) {
      el.addEventListener("input", function () { applyField(el); });
      el.addEventListener("change", function () { applyField(el); });
    });

    /* 自绘下拉的交互：点按钮展开，点预设值写入并收起，
       点「其他…」切到输入态。值统一落在 hidden 的 [data-k] 上，
       表单收集逻辑不用改 */
    [].forEach.call(wrap.querySelectorAll("[data-pick2]"), function (box) {
      var btn = box.querySelector(".adm-pick-btn");
      var menu = box.querySelector(".adm-pick-menu");
      var input = box.querySelector(".adm-pick-input");
      var valEl = box.querySelector(".adm-pick-val");
      if (!btn || !menu || !input || !valEl) return;

      function setOpen(on) {
        menu.classList.toggle("open", on);
        box.classList.toggle("open", on);
      }

      /* 显示文字走映射表：kind 这类字段存的是 datasheet / other，界面上要显示中文 */
      function labelFor(v) {
        if (!v) return "请选择";
        var m = null;
        try { m = JSON.parse(box.getAttribute("data-labels") || "{}"); } catch (e) { m = null; }
        return (m && m[v]) || v;
      }

      function showValue(v) {
        valEl.textContent = labelFor(v);
        valEl.classList.toggle("is-empty", !v);
        valEl.hidden = false;
        input.hidden = true;
      }

      function markOn(v) {
        [].forEach.call(menu.querySelectorAll("button[data-v]"), function (b) {
          if (b.getAttribute("data-v") === "__custom__") return;
          b.classList.toggle("on", b.getAttribute("data-v") === v);
        });
      }

      function commit(v) {
        input.value = v;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        showValue(v);
        markOn(v);
      }

      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        setOpen(!menu.classList.contains("open"));
      });

      menu.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("button[data-v]") : null;
        if (!b) return;
        e.stopPropagation();
        var v = b.getAttribute("data-v");
        setOpen(false);
        if (v === "__custom__") {
          valEl.hidden = true;
          input.hidden = false;
          input.focus();
          input.select();
          return;
        }
        commit(v);
      });

      input.addEventListener("input", function () {
        valEl.textContent = labelFor(input.value);
        valEl.classList.toggle("is-empty", !input.value);
      });

      input.addEventListener("blur", function () {
        var v = input.value.trim();
        input.value = v;
        markOn(v);
        showValue(v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          input.blur();
        }
      });

      showValue(input.value);
    });

    /* 自绘日历：点按钮展开，点上/下月翻页，点日或月写值 */
    [].forEach.call(wrap.querySelectorAll("[data-date]"), function (box) {
      var mode = box.getAttribute("data-mode");
      var btn = box.querySelector(".adm-date-btn");
      var pop = box.querySelector(".adm-date-pop");
      var title = box.querySelector(".adm-date-title");
      var grid = box.querySelector(".adm-date-grid");
      var valEl = box.querySelector(".adm-pick-val");
      var input = box.querySelector(".adm-pick-input");
      if (!btn || !pop || !grid || !input) return;

      function pad(n) { return n < 10 ? "0" + n : "" + n; }

      function toDate(s) {
        var m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(String(s || ""));
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
      }

      var cursor = toDate(input.value) || new Date();
      var todayKey = (function () {
        var d = new Date();
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      })();

      function commit(v) {
        input.value = v;
        valEl.textContent = v ? dateText(v) : "请选择";
        valEl.classList.toggle("is-empty", !v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        box.classList.remove("open");
      }

      function render() {
        var y = cursor.getFullYear(), mo = cursor.getMonth();
        title.textContent = y + " 年 " + (mo + 1) + " 月";
        var html = "";
        if (mode === "month") {
          grid.className = "adm-date-grid is-month";
          for (var m = 0; m < 12; m++) {
            var mk = y + "-" + pad(m + 1);
            var mcls = "";
            if (input.value === mk) mcls = "on";
            else if (todayKey.slice(0, 7) === mk) mcls = "today";
            html += '<button type="button" data-m="' + m + '"' +
              (mcls ? ' class="' + mcls + '"' : "") + ">" + (m + 1) + " 月</button>";
          }
        } else {
          grid.className = "adm-date-grid";
          ["一", "二", "三", "四", "五", "六", "日"].forEach(function (w) {
            html += '<span class="adm-date-w">' + w + "</span>";
          });
          /* 老数据只有年月（2026-03）。补成当月 1 日再比，
             否则打开日视图时一格都不亮，看着像没选中 */
          var curKey = /^\d{4}-\d{1,2}$/.test(input.value) ? input.value + "-01" : input.value;
          var first = new Date(y, mo, 1);
          var lead = (first.getDay() + 6) % 7;
          var days = new Date(y, mo + 1, 0).getDate();
          for (var i = 0; i < lead; i++) html += '<span class="adm-date-pad"></span>';
          for (var d = 1; d <= days; d++) {
            var dk = y + "-" + pad(mo + 1) + "-" + pad(d);
            var cls = "adm-date-d";
            if (curKey === dk) cls += " on";
            else if (todayKey === dk) cls += " today";
            html += '<button type="button" class="' + cls + '" data-d="' + d + '">' + d + "</button>";
          }
        }
        grid.innerHTML = html;
      }

      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        render();
        box.classList.toggle("open");
      });

      pop.addEventListener("click", function (e) {
        e.stopPropagation();
        var t = e.target.closest ? e.target.closest("button") : null;
        if (!t) return;

        if (t.hasAttribute("data-nav")) {
          cursor = new Date(cursor.getFullYear(), cursor.getMonth() + Number(t.getAttribute("data-nav")), 1);
          render();
          return;
        }
        if (t.hasAttribute("data-m")) {
          commit(cursor.getFullYear() + "-" + pad(Number(t.getAttribute("data-m")) + 1));
          return;
        }
        if (t.hasAttribute("data-d")) {
          commit(cursor.getFullYear() + "-" + pad(cursor.getMonth() + 1) + "-" + pad(Number(t.getAttribute("data-d"))));
          return;
        }
        if (t.hasAttribute("data-clear")) { commit(""); return; }
        if (t.hasAttribute("data-today")) {
          if (mode === "month") commit(todayKey.slice(0, 7));
          else commit(todayKey);
          return;
        }
      });
    });

    /* 点空白收起所有下拉，只注册一次 */
    if (!document.documentElement.hasAttribute("data-pick-bound")) {
      document.documentElement.setAttribute("data-pick-bound", "1");
      document.addEventListener("click", function () {
        [].forEach.call(document.querySelectorAll("[data-pick2].open"), function (b) {
          var m = b.querySelector(".adm-pick-menu");
          b.classList.remove("open");
          if (m) m.classList.remove("open");
        });
        [].forEach.call(document.querySelectorAll(".adm-date.open"), function (b) {
          b.classList.remove("open");
        });
      });
    }

    /* 正文工具栏 */
    var tools = wrap.querySelector("[data-tools]");
    if (tools) {
      tools.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-ins]");
        if (!b) return;
        var ta = wrap.querySelector('textarea[data-k="body"]');
        if (!ta) return;
        var kind = b.getAttribute("data-ins");
        if (kind === "image") { pickImage(ta); return; }
        var snip = {
          h2: "\n## 小标题\n",
          ul: "\n- 列表项\n- 列表项\n",
          quote: "\n> 引用内容\n",
          code: "\n```\n代码\n```\n",
          table: "\n| 名称 | 值 |\n|---|---|\n|  |  |\n",
          link: "[文字](https://example.com)"
        };
        insertAt(ta, snip[kind] || "");
      });
    }

    /* 日志正文：复用图片上传，把 ![说明](地址) 插到光标处 */
    var jimg = wrap.querySelector("[data-jimg]");
    if (jimg) {
      jimg.addEventListener("click", function () {
        var ta = wrap.querySelector('textarea[data-k="text"]');
        if (ta) pickImage(ta);
      });
    }

    /* 附件 */
    if (it.attachments !== undefined || curType !== "files") {
      renderAttach(it);
      var box = $("attachBox");
      if (box) {
        box.addEventListener("click", function (e) {
          var x = e.target.closest("[data-del]");
          if (!x) return;
          it.attachments.splice(parseInt(x.getAttribute("data-del"), 10), 1);
          contentDirty = true;
          renderAttach(it);
        });
      }
      var af = wrap.querySelector("[data-addfile]");
      var ad = wrap.querySelector("[data-adddir]");
      if (af) af.addEventListener("click", function () { addAttachments(it, false); });
      if (ad) ad.addEventListener("click", function () { addAttachments(it, true); });
    }

    updatePreview(it);
  }

  function applyField(el) {
    var it = items()[curIndex];
    if (!it) return;
    var k = el.getAttribute("data-k");
    var v = el.value;

    if (k === "specs") {
      it.specs = v.split("\n").filter(function (l) { return l.trim(); }).map(function (l) {
        var p = l.split("|");
        return [p[0].trim(), (p[1] || "").trim()];
      });
    } else if (k === "links") {
      it.links = v.split("\n").filter(function (l) { return l.trim(); }).map(function (l) {
        var p = l.split("|");
        return { label: p[0].trim(), url: (p[1] || "").trim() };
      });
    } else if (k === "tags") {
      it.tags = v.split(/[、,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
    } else if (k === "body") {
      it.body = v.split("\n");
      updatePreview(it);
    } else {
      it[k] = v;
      if (k === "text") updatePreview(it);
    }
    contentDirty = true;
    renderList();
  }

  /* ---------- 增删 ---------- */

  function addNew() {
    var blank;
    if (curType === "projects") {
      blank = { id: "new-" + Date.now(), title: "新项目", subtitle: "", category: "硬件", status: "进行中", year: "2026", summary: "", specs: [], tags: [], links: [] };
    } else if (curType === "notes") {
      blank = { id: "note-" + Date.now(), title: "新笔记", date: "", tags: [], summary: "", body: [""] };
    } else if (curType === "journal") {
      blank = { id: "j-" + Date.now(), date: new Date().toISOString().slice(0, 10), mood: "", text: "" };
    } else {
      blank = { name: "新资料", kind: "other", note: "", url: "", size: "", body: [] };
    }
    content[curType].push(blank);
    contentDirty = true;
    select(content[curType].length - 1);
  }

  function delCurrent() {
    if (curIndex < 0) return;
    if (!confirm("确定删除「" + titleOf(items()[curIndex]) + "」？")) return;
    content[curType].splice(curIndex, 1);
    contentDirty = true;
    curIndex = Math.min(curIndex, items().length - 1);
    renderList();
    renderEdit();
  }

  /* ---------- 保存到 GitHub ----------
   * 用 Git 树接口一次提交四个文件，四个改动落在同一个提交里
   */
  async function saveContent() {
    var tk = token();
    if (!tk) { msg("请先在上面填入令牌并连接", "err"); return; }
    if (!content) { msg("内容还没加载完成", "err"); return; }

    var btn = $("saveBtn");
    if (btn) btn.disabled = true;
    msg("提交中…");

    var api = "https://api.github.com/repos/" + OWNER + "/" + REPO;
    var H = { "Authorization": "Bearer " + tk, "Accept": "application/vnd.github+json" };
    var HJ = { "Authorization": "Bearer " + tk, "Accept": "application/vnd.github+json", "Content-Type": "application/json" };

    try {
      var head = await fetch(api + "/git/ref/heads/" + BRANCH, { headers: H }).then(function (r) {
        if (r.status === 401) throw new Error("令牌无效或已过期");
        if (r.status === 404) throw new Error("找不到仓库或分支");
        return r.json();
      });
      var headSha = head.object.sha;

      var commit = await fetch(api + "/git/commits/" + headSha, { headers: H }).then(function (r) { return r.json(); });

      var tree = [];
      for (var i = 0; i < PARTS.length; i++) {
        var k = PARTS[i];
        var blob = await fetch(api + "/git/blobs", {
          method: "POST", headers: HJ,
          body: JSON.stringify({ content: JSON.stringify(content[k], null, 2) + "\n", encoding: "utf-8" })
        }).then(function (r) {
          if (!r.ok) throw new Error("写入文件失败");
          return r.json();
        });
        tree.push({ path: "content/" + k + ".json", mode: "100644", type: "blob", sha: blob.sha });
      }

      var newTree = await fetch(api + "/git/trees", {
        method: "POST", headers: HJ,
        body: JSON.stringify({ base_tree: commit.tree.sha, tree: tree })
      }).then(function (r) { return r.json(); });

      var newCommit = await fetch(api + "/git/commits", {
        method: "POST", headers: HJ,
        body: JSON.stringify({
          message: "内容更新：" + new Date().toISOString().slice(0, 16).replace("T", " "),
          tree: newTree.sha,
          parents: [headSha]
        })
      }).then(function (r) { return r.json(); });

      await fetch(api + "/git/refs/heads/" + BRANCH, {
        method: "PATCH", headers: HJ,
        body: JSON.stringify({ sha: newCommit.sha })
      }).then(function (r) {
        if (!r.ok) throw new Error("更新分支失败");
        return r.json();
      });

      contentDirty = false;
      msg("已提交，站点下次打开即为最新", "ok");
    } catch (e) {
      msg(e.message, "err");
    }

    if (btn) btn.disabled = false;
  }

  /* ---------- 内容视图挂载 ---------- */

  function mountManage() {
    var tabs = $("tabs");
    var list = $("list");

    if (tabs) {
      tabs.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-type]");
        if (!b) return;
        Array.prototype.forEach.call(tabs.querySelectorAll("button"), function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        curType = b.getAttribute("data-type");
        curIndex = -1;
        renderList();
        renderEdit();
        if (items().length) select(0);
      });
    }

    if (list) {
      list.addEventListener("click", function (e) {
        var row = e.target.closest(".adm-item");
        if (row) select(parseInt(row.getAttribute("data-i"), 10));
      });
    }

    var addB = $("addBtn");
    if (addB) addB.addEventListener("click", addNew);

    var saveB = $("saveBtn");
    if (saveB) saveB.addEventListener("click", saveContent);

    var delB = $("delBtn");
    if (delB) delB.addEventListener("click", delCurrent);

    var tokenSave = $("tokenSave");
    if (tokenSave) {
      tokenSave.addEventListener("click", function () {
        var v = $("tokenInput").value.trim();
        if (!v) return;
        localStorage.setItem(TOKEN_KEY, v);
        $("tokenInput").value = "";
        $("tokenRow").style.display = "none";
        setStatus("已连接", true);
        msg("已保存令牌到本机浏览器", "ok");
        loadContent();
      });
    }

    if (token()) {
      if ($("tokenRow")) $("tokenRow").style.display = "none";
    }

    loadContent();
  }

  /* 内容读取只在已连接时发生。未连接时给一份空基线：列表与编辑区都是空的，
     新建与插图控件照常可用，只是不发起任何请求。
     连接后 contentStub 仍为真，会重新从远端载入并覆盖这份空基线。 */
  function loadContent() {
    if (!token()) {
      if (!content) {
        content = {};
        PARTS.forEach(function (k) { content[k] = []; });
        contentStub = true;
      }
      renderList();
      renderEdit();
      return;
    }

    /* 已从远端载入过就不再重复请求 */
    if (content && !contentStub) {
      renderList();
      if (content[curType] && content[curType].length) select(0);
      return;
    }

    /* 有未保存的改动时不覆盖 */
    if (contentDirty) return;

    var bust = "?t=" + Date.now();
    Promise.all(PARTS.map(function (k) {
      return fetch("/content/" + k + ".json" + bust).then(function (r) {
        if (!r.ok) throw new Error(k);
        return r.json();
      });
    })).then(function (arr) {
      if (contentDirty) return;
      /* 按 PARTS 顺序装入，缺字段或响应异常时补空数组，避免切标签报错 */
      content = {};
      PARTS.forEach(function (k, i) {
        content[k] = Array.isArray(arr[i]) ? arr[i] : [];
      });
      contentStub = false;
      renderList();
      if (content[curType] && content[curType].length) select(0);
      else renderEdit();
    }).catch(function () {
      msg("内容加载失败", "err");
    });
  }

  /* ==========================================================================
   * 视图三：壁纸管理
   *
   * 图片与配置在同一次 Git Trees 提交里写入：
   * 上传只做本地暂存，「保存并发布」一次性提交新增图片、删除记录、theme.json。
   * 原先「先 PUT 图片、再另起提交写配置」会因 GET ref 命中缓存拿到旧 head，
   * 导致配置提交失败或被回滚，表现为换壁纸不生效。
   * ======================================================================== */

  function stamp(ts) {
    var d = new Date(ts || Date.now());
    var p = function (n) { return n < 10 ? "0" + n : String(n); };
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function histLabel(it) {
    return (it.side === "admin" ? "管理端" : "访客端") + " · " + (it.at || "已上传");
  }

  function histHtml() {
    if (!themeHistory.length) {
      return '<div class="hist-empty">还没有历史壁纸，上传一张后会出现在这里</div>';
    }
    return themeHistory.map(function (it, i) {
      return '<div class="hist-item" data-i="' + i + '">' +
        '<div class="hist-thumb"><img src="' + esc(it.thumb || it.url) + '" alt="' + esc(it.name || "") + '" loading="lazy"></div>' +
        '<div class="hist-meta">' +
          '<span class="hist-name">' + esc(it.name || it.url) + '</span>' +
          '<span class="hist-sub">' + esc(histLabel(it)) + '</span>' +
        '</div>' +
        '<div class="hist-actions">' +
          '<button class="hist-use" data-hist="use" data-i="' + i + '">使用</button>' +
          '<button class="hist-del" data-hist="del" data-i="' + i + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function renderHistory() {
    var box = $("histGrid");
    if (box) box.innerHTML = histHtml();
    [].forEach.call(document.querySelectorAll("#histTarget button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-target") === historyTarget);
    });
  }

  function serializeTheme() {
    return JSON.stringify({
      guest: themeState.guest,
      admin: themeState.admin,
      glass: { guest: themeState.glass.guest, admin: themeState.glass.admin },
      history: themeHistory.map(function (it) {
        return { url: it.url, name: it.name, side: it.side, at: it.at, ts: it.ts || 0 };
      })
    }, null, 2) + "\n";
  }

  function themeHtml() {
    return '<div class="theme-main">' +
      '<div class="adm-token" id="tokenRow">' +
        '<input id="tokenInput" type="password" placeholder="粘贴令牌" autocomplete="off">' +
        '<button id="tokenSave">连接</button>' +
      '</div>' +
      '<section class="adm-panel theme-glass">' +
        '<div class="theme-name">玻璃质感</div>' +
        '<div class="glass-rows">' +
          '<div class="glass-row" data-side="guest">' +
            '<span class="glass-side">访客端</span>' +
            '<div class="glass-switch">' +
              '<button data-glass="clear">透明</button>' +
              '<button data-glass="frosted">磨砂</button>' +
            '</div>' +
          '</div>' +
          '<div class="glass-row" data-side="admin">' +
            '<span class="glass-side">管理端</span>' +
            '<div class="glass-switch">' +
              '<button data-glass="clear">透明</button>' +
              '<button data-glass="frosted">磨砂</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<div class="theme-grid">' +
        '<section class="adm-panel theme-card">' +
          '<div class="theme-name">访客端壁纸 <span class="hintline" style="display:inline">显示在站点首页与各页面</span></div>' +
          '<div class="theme-preview"><img id="prev-guest" alt="访客端壁纸预览"></div>' +
          '<div class="theme-actions">' +
            '<button data-side="guest" data-act="upload">上传新壁纸</button>' +
            '<button data-side="guest" data-act="reset">恢复默认</button>' +
          '</div>' +
        '</section>' +
        '<section class="adm-panel theme-card">' +
          '<div class="theme-name">管理端壁纸 <span class="hintline" style="display:inline">显示在管理端主页、内容与本页</span></div>' +
          '<div class="theme-preview"><img id="prev-admin" alt="管理端壁纸预览"></div>' +
          '<div class="theme-actions">' +
            '<button data-side="admin" data-act="upload">上传新壁纸</button>' +
            '<button data-side="admin" data-act="reset">恢复默认</button>' +
          '</div>' +
        '</section>' +
      '</div>' +
      '<section class="adm-panel theme-history">' +
        '<div class="theme-history-head">' +
          '<div class="theme-name">历史记录</div>' +
          '<div class="hist-target" id="histTarget">' +
            '<span>应用到</span>' +
            '<button data-target="guest">访客端</button>' +
            '<button data-target="admin">管理端</button>' +
          '</div>' +
        '</div>' +
        '<div class="hist-grid" id="histGrid">' + histHtml() + '</div>' +
      '</section>' +
      '<div class="theme-foot">' +
        '<div class="adm-msg" id="msg"></div>' +
        '<button class="adm-save" id="saveBtn">保存并发布</button>' +
      '</div>' +
    '</div>';
  }

  function refreshPreview(side) {
    var el = $("prev-" + side);
    if (el) el.src = localPreview[side] || themeState[side];
  }

  function applyThemeLocal() {
    /* 本地上传的预览不依赖连接，照常显示 */
    if (localPreview.admin) { applyAdminWallpaper(localPreview.admin); applyGlass(); return; }
    if (!token()) {
      /* 未连接时不读线上配置，但页面不能没有背景：
         .bg 默认 opacity: 0，必须有人点亮它——用本机记住的那张，没有就用默认图 */
      paintWallpaper(localStorage.getItem("bg-admin") || DEFAULT_WALLPAPER);
      applyGlass();
      return;
    }
    applyAdminWallpaper(themeState.admin);
    applyGlass();
  }

  /* 玻璃质感：透明 / 磨砂，两端分开存。类挂在 <html> 上，
     访客端页面读 guest，管理端页面读 admin——各自只应用自己那一侧，
     所以点访客端那一行不会改变当前管理端页面的观感 */
  function applyGlass() {
    var cur = themeState.glass.admin;
    document.documentElement.classList.toggle("glass-clear", cur === "clear");
    /* 三个管理端页面各自独立加载，靠本机记忆保持档位一致：
       在壁纸页改完切到内容页，不会又变回磨砂 */
    try { localStorage.setItem("glass-admin", cur); } catch (e) {}
  }

  function renderGlassSwitch() {
    [].forEach.call(document.querySelectorAll(".glass-row[data-side]"), function (row) {
      var side = row.getAttribute("data-side");
      var cur = themeState.glass[side];
      [].forEach.call(row.querySelectorAll("button[data-glass]"), function (b) {
        b.classList.toggle("on", b.getAttribute("data-glass") === cur);
      });
    });
  }

  function setGlass(side, v) {
    if (side !== "guest" && side !== "admin") return;
    if (v !== "clear" && v !== "frosted") return;
    if (themeState.glass[side] === v) return;
    themeState.glass[side] = v;
    themeDirty = true;
    /* 只重绘当前页能看见的那一侧；另一侧等发布后由对应页面读取 */
    if (side === "admin") applyGlass();
    renderGlassSwitch();
    msg("已把" + (side === "guest" ? "访客端" : "管理端") + "切为" +
      (v === "clear" ? "透明" : "磨砂") + "，点「保存并发布」后生效", "ok");
  }

  /* 上传只压缩并暂存在内存，不发网络请求；发布由 saveTheme 一次完成 */
  function uploadWallpaper(side, file) {
    if (file.size > 20 * 1024 * 1024) { msg("图片超过 20MB，请压缩后再传", "err"); return; }

    msg("处理图片中…");

    compressImage(file).then(function (out) {
      return out.arrayBuffer().then(function (buf) {
        var isJpg = /jpeg|jpg/i.test(out.type);
        var ext = isJpg ? "jpg"
          : (String(out.name).toLowerCase().match(/\.(png|jpe?g|webp|gif|avif)$/) || [0, "jpg"])[1].replace("jpeg", "jpg");

        var ts = Date.now();
        var rel = "assets/img/wallpaper-" + side + "-" + ts + "." + ext;
        var url = "/" + rel;
        var thumb = URL.createObjectURL(out);

        pendingUploads.push({ rel: rel, b64: b64FromBuf(buf), url: url });
        themeHistory.unshift({
          url: url, name: out.name, side: side, at: stamp(ts), ts: ts, thumb: thumb
        });

        themeState[side] = url;
        localPreview[side] = thumb;
        themeDirty = true;
        refreshPreview(side);
        renderHistory();
        applyThemeLocal();
        msg("已加入待发布（" + Math.round(buf.byteLength / 1024) + " KB），点「保存并发布」后生效", "ok");
      });
    }).catch(function (e) { msg(e.message || "图片处理失败", "err"); });
  }

  /* GitHub API 统一入口：GET 用时间戳 + cache:no-store 绕开缓存，错误带出服务端 message。
     不要加自定义请求头：GitHub API 的 CORS 白名单不含它们，会触发预检失败 */
  function ghApi(path, options) {
    var o = options || {};
    var headers = {
      "Authorization": "Bearer " + token(),
      "Accept": "application/vnd.github+json"
    };
    if (o.bodyHeaders) {
      for (var k in o.bodyHeaders) if (Object.prototype.hasOwnProperty.call(o.bodyHeaders, k)) headers[k] = o.bodyHeaders[k];
    }
    return fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + path, {
      method: o.method || "GET",
      headers: headers,
      body: o.body,
      cache: "no-store"
    }).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) {}
        if (!r.ok) {
          var why = (data && data.message) ? data.message : ("HTTP " + r.status);
          throw new Error(why + "（" + r.status + "）");
        }
        return data;
      });
    });
  }

  function ghJson(path, method, payload) {
    return ghApi(path, {
      method: method,
      bodyHeaders: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  /* Pages 构建期间先用本地图，正式地址可访问后自动切回 */
  function switchToRemoteUrls() {
    ["guest", "admin"].forEach(function (side) {
      if (!localPreview[side]) return;
      var url = themeState[side];
      var tries = 0;
      var probe = function () {
        var im = new Image();
        im.onload = function () {
          localPreview[side] = "";
          themeHistory.forEach(function (it) { if (it.url === url) it.thumb = ""; });
          var src = url + "?v=" + Date.now();
          var prev = $("prev-" + side);
          if (prev && themeState[side] === url) prev.src = src;
          if (side === "admin") paintWallpaper(src);
          renderHistory();
        };
        im.onerror = function () {
          if (++tries < 8) window.setTimeout(probe, 3000);
        };
        im.src = url + "?v=" + Date.now();
      };
      window.setTimeout(probe, 1500);
    });
  }

  /* 一次提交同时写入新增图片、删除记录与 theme.json，避免多次提交之间的竞态 */
  async function saveTheme() {
    if (!token()) { msg("请先填入令牌并连接", "err"); return; }
    if (!themeDirty && !pendingUploads.length && !pendingDeletes.length) {
      msg("没有待发布的改动", "ok");
      return;
    }

    var btn = $("saveBtn");
    if (btn) btn.disabled = true;
    msg("提交中…");

    try {
      var head = await ghApi("/git/ref/heads/" + BRANCH + "?t=" + Date.now());
      var headSha = head.object.sha;
      var base = await ghApi("/git/commits/" + headSha + "?t=" + Date.now());

      var entries = [];

      /* 新增图片：先建 blob，再挂进同一棵树 */
      for (var i = 0; i < pendingUploads.length; i++) {
        var up = pendingUploads[i];
        var b = await ghJson("/git/blobs", "POST", { content: up.b64, encoding: "base64" });
        entries.push({ path: up.rel, mode: "100644", type: "blob", sha: b.sha });
      }

      /* sha 为 null 的 tree entry 表示从新树里删掉该路径 */
      for (var j = 0; j < pendingDeletes.length; j++) {
        entries.push({ path: pendingDeletes[j], mode: "100644", type: "blob", sha: null });
      }

      var cfg = await ghJson("/git/blobs", "POST", { content: serializeTheme(), encoding: "utf-8" });
      entries.push({ path: "content/theme.json", mode: "100644", type: "blob", sha: cfg.sha });

      var tree = await ghJson("/git/trees", "POST", { base_tree: base.tree.sha, tree: entries });

      /* 新树与基准树相同，说明既没传新图、配置也和远端一致。
         这种情况不能报「已发布」：仓库里其实什么都没写，用户会以为换上了 */
      if (tree.sha === base.tree.sha) {
        msg("没有实际改动：选中的就是当前这张壁纸，换一张再保存", "ok");
        if (btn) btn.disabled = false;
        return;
      }

      var commit = await ghJson("/git/commits", "POST", {
        message: "壁纸更新：" + new Date().toISOString().slice(0, 16).replace("T", " "),
        tree: tree.sha,
        parents: [headSha]
      });
      await ghJson("/git/refs/heads/" + BRANCH, "PATCH", { sha: commit.sha });

      pendingUploads = [];
      pendingDeletes = [];
      themeDirty = false;
      msg("已发布，稍等片刻刷新即可看到新壁纸", "ok");
      switchToRemoteUrls();
    } catch (e) {
      msg(e.message || "提交失败", "err");
    }

    if (btn) btn.disabled = false;
  }

  function useHistory(i) {
    var it = themeHistory[i];
    if (!it) return;
    /* 点到的就是当前这张：不置脏，避免保存时写出一棵与原树相同的空提交。
       带 thumb 的是尚未发布的本地图，仍需走一次提交 */
    if (it.url === themeState[historyTarget] && !it.thumb) {
      msg("这张已经是当前壁纸，换一张再保存", "ok");
      return;
    }
    themeState[historyTarget] = it.url;
    /* 未发布的图只有本地 object URL，正式地址要等发布后才可访问 */
    localPreview[historyTarget] = it.thumb || "";
    themeDirty = true;
    refreshPreview(historyTarget);
    applyThemeLocal();
    renderHistory();
    msg("已设为" + (historyTarget === "guest" ? "访客端" : "管理端") + "壁纸，点「保存并发布」后生效", "ok");
  }

  function deleteHistory(i) {
    var it = themeHistory[i];
    if (!it) return;
    if (!window.confirm("删除这张历史壁纸？仓库里的图片文件也会一并删除。")) return;

    var rel = String(it.url || "").replace(/^\//, "");
    var staged = pendingUploads.some(function (u) { return u.rel === rel; });
    if (staged) {
      pendingUploads = pendingUploads.filter(function (u) { return u.rel !== rel; });
    } else if (/^assets\/img\/wallpaper-(guest|admin)-\d+\./.test(rel)) {
      if (pendingDeletes.indexOf(rel) < 0) pendingDeletes.push(rel);
    }

    themeHistory.splice(i, 1);
    ["guest", "admin"].forEach(function (side) {
      if (themeState[side] === it.url) {
        themeState[side] = DEFAULT_WALLPAPER;
        localPreview[side] = "";
        refreshPreview(side);
      }
    });
    themeDirty = true;
    applyThemeLocal();
    renderHistory();
    msg("已从列表移除，点「保存并发布」后生效", "ok");
  }

  /* 历史记录以 theme.json 为准；有令牌时再扫一次仓库，补回散落的旧壁纸 */
  function scanRepoHistory() {
    if (!token()) return;
    ghApi("/contents/assets/img?ref=" + BRANCH + "&t=" + Date.now()).then(function (list) {
      if (!Array.isArray(list)) return;
      var known = {};
      themeHistory.forEach(function (it) { known[it.url] = 1; });
      var added = 0;
      list.forEach(function (f) {
        if (f.type !== "file" || !/^wallpaper-(guest|admin)-\d+\./.test(f.name)) return;
        var url = "/" + f.path;
        if (known[url]) return;
        var m = f.name.match(/-(\d{10,})\./);
        var ts = m ? Number(m[1]) : 0;
        themeHistory.push({
          url: url, name: f.name,
          side: /^wallpaper-admin-/.test(f.name) ? "admin" : "guest",
          at: ts ? stamp(ts) : "", ts: ts
        });
        known[url] = 1;
        added++;
      });
      if (added) {
        themeHistory.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
        renderHistory();
      }
    }).catch(function () {});
  }

  function mountTheme() {
    var grid = document.querySelector(".theme-grid");

    if (grid) {
      grid.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-side]");
        if (!btn) return;
        var side = btn.getAttribute("data-side");
        var act = btn.getAttribute("data-act");

        if (act === "reset") {
          themeState[side] = DEFAULT_WALLPAPER;
          localPreview[side] = "";
          refreshPreview(side);
          themeDirty = true;
          applyThemeLocal();
          msg("已切回默认壁纸，点「保存并发布」后生效", "ok");
          return;
        }

        if (act === "upload") {
          /* input 先挂进文档再点：脱离文档的 input 在部分浏览器上不弹选择框 */
          var inp = document.createElement("input");
          inp.type = "file";
          inp.accept = "image/*";
          inp.style.display = "none";
          document.body.appendChild(inp);
          inp.onchange = function () {
            if (inp.files.length) uploadWallpaper(side, inp.files[0]);
            if (inp.parentNode) inp.parentNode.removeChild(inp);
          };
          inp.click();
        }
      });
    }

    var target = $("histTarget");
    if (target) {
      target.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("button[data-target]") : null;
        if (!b) return;
        historyTarget = b.getAttribute("data-target");
        renderHistory();
      });
    }

    var hist = $("histGrid");
    if (hist) {
      hist.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("button[data-hist]") : null;
        if (!b) return;
        var i = Number(b.getAttribute("data-i"));
        if (b.getAttribute("data-hist") === "use") useHistory(i);
        else deleteHistory(i);
      });
    }

    var tokenSave = $("tokenSave");
    if (tokenSave) {
      tokenSave.addEventListener("click", function () {
        var v = $("tokenInput").value.trim();
        if (!v) return;
        localStorage.setItem(TOKEN_KEY, v);
        $("tokenInput").value = "";
        $("tokenRow").style.display = "none";
        setStatus("已连接", true);
        msg("已保存令牌到本机浏览器", "ok");
        refreshThemeView();
      });
    }

    var saveB = $("saveBtn");
    if (saveB) saveB.addEventListener("click", saveTheme);

    /* 玻璃质感：两行（访客端 / 管理端），事件挂在容器上做委托 */
    var glassBox = document.querySelector(".glass-rows");
    if (glassBox) {
      glassBox.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("button[data-glass]") : null;
        if (!b) return;
        var row = b.closest(".glass-row");
        if (!row) return;
        setGlass(row.getAttribute("data-side"), b.getAttribute("data-glass"));
      });
    }
    renderGlassSwitch();

    if (token() && $("tokenRow")) $("tokenRow").style.display = "none";

    refreshThemeView();
  }

  /* 壁纸页刷新：未连接时 loadTheme 直接短路，预览与历史停在默认值，
     .bg 不动，仍显示 CSS 里的默认壁纸 */
  function refreshThemeView() {
    loadTheme().then(function () {
      refreshPreview("guest");
      refreshPreview("admin");
      renderHistory();
      applyThemeLocal();
      renderGlassSwitch();
      scanRepoHistory();
    });
  }

  /* ==========================================================================
   * 视图渲染与切换
   * ======================================================================== */

  var VIEWS = {
    home: { html: homeHtml, mount: mountHome, cls: "adm-view--home", title: "管理端 · 流雲的创客空间" },
    manage: { html: manageHtml, mount: mountManage, cls: "adm-view--editor", title: "内容管理 · 流雲的创客空间" },
    theme: { html: themeHtml, mount: mountTheme, cls: "adm-view--theme", title: "壁纸管理 · 流雲的创客空间" }
  };

  /* 视图的横向顺序：往右是后面的视图，滑动方向据此决定 */
  var ADM_ORDER = ["home", "manage", "theme"];
  /* 待播的切页方向类。render() 换完 DOM 再挂上去，
     位移只落在 .adm-panel 与 .jelly 自己身上（见 style.css 的切页滑动） */
  var admSlide = "";

  function render(v) {
    var def = VIEWS[v] || VIEWS.home;
    root.className = "adm-view " + def.cls;
    root.innerHTML = def.html();
    document.title = def.title;
    current = v;
    markNav(v);
    syncStatusForView(v);
    /* 滚动发生在 .page 内部，视口本身不滚动，归零要打在滚动容器上 */
    var pg = document.querySelector(".page");
    if (pg) pg.scrollTop = 0;
    else window.scrollTo(0, 0);
    if (typeof def.mount === "function") def.mount();
    firstAdmRender = false;

    /* 内容已进 DOM、尚未绘制，此时挂方向类，首帧就是滑动起点 */
    if (admSlide) {
      root.classList.remove("slide-next", "slide-prev");
      void root.offsetWidth;
      root.classList.add(admSlide);
      (function (cls) {
        window.setTimeout(function () { root.classList.remove(cls); }, 460);
      })(admSlide);
      admSlide = "";
    }
  }

  function dirtyNow() {
    return (current === "manage" && contentDirty) || (current === "theme" && themeDirty);
  }

  /* 视图切换：方向按 ADM_ORDER 的先后决定，位移交给 render() 挂的类。
     容器本身不加 transform——它会成为 backdrop root，面板就模糊不到壁纸 */
  function switchTo(v, push) {
    if (v === current) return;

    if (dirtyNow() && !confirm("还有未保存的改动，确定离开？")) return;

    var from = ADM_ORDER.indexOf(current), to = ADM_ORDER.indexOf(v);
    admSlide = (from > -1 && to > -1 && to !== from) ? (to > from ? "slide-next" : "slide-prev") : "";

    var target = pathOfView(v);
    if (push) {
      try { history.pushState({ v: v }, "", target); } catch (e) { location.hash = target; }
    }
    render(v);
  }

  /* ---------- 事件 ---------- */

  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("[data-adm]") : null;
    if (!a) return;
    e.preventDefault();
    switchTo(a.getAttribute("data-adm"), true);
  });

  window.addEventListener("popstate", function () {
    var v = viewOfPath();
    if (v === current) return;
    var from = ADM_ORDER.indexOf(current), to = ADM_ORDER.indexOf(v);
    admSlide = (from > -1 && to > -1 && to !== from) ? (to > from ? "slide-next" : "slide-prev") : "";
    render(v);
  });

  window.addEventListener("beforeunload", function (e) {
    if (dirtyNow()) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- 启动 ---------- */

  /* 片头期间任意处按下即跳过；监听只注册一次，避免每次切回主页重复叠加 */
  function introGuard(e) {
    if (!document.documentElement.classList.contains("intro-on")) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    skipIntro();
  }
  document.addEventListener("touchstart", introGuard, { capture: true, passive: false });
  document.addEventListener("mousedown", introGuard, true);

  loadTheme().then(function () { applyThemeLocal(); });
  render(viewOfPath());
})();
