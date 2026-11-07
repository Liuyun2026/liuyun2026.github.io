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
  var transitioning = false;
  var themeState = { guest: DEFAULT_WALLPAPER, admin: DEFAULT_WALLPAPER };
  var themeHistory = [];      /* 历史壁纸，随 content/theme.json 持久化 */
  var pendingUploads = [];    /* 待发布图片：{ rel, b64, url } */
  var pendingDeletes = [];    /* 待删除的仓库图片路径 */
  var localPreview = { guest: "", admin: "" };  /* 未发布图片的本地 object URL */
  var historyTarget = "guest";/* 历史项「使用」应用到哪一侧 */
  var themeDirty = false;
  var content = null;      /* 内容 JSON */
  var contentDirty = false;

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
    var bg = document.querySelector(".bg");
    if (!bg || !url) return;
    var probe = new Image();
    probe.decoding = "async";
    probe.onload = function () {
      bg.style.backgroundImage = 'url("' + url + '")';
    };
    probe.src = url;
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
    /* 「未连接」用红点，其余状态（管理端 / 已连接）保持绿点 */
    var box = s.closest ? s.closest(".nav-status") : null;
    if (box) box.classList.toggle("is-off", text === "未连接");
  }

  function syncStatusForView(v) {
    if (v === "home") {
      setStatus("管理端", false);
      return;
    }
    if (token()) setStatus("已连接", true);
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
    var input = type === "area"
      ? '<textarea data-k="' + key + '">' + esc(val || "") + "</textarea>"
      : '<input data-k="' + key + '" value="' + esc(val || "") + '">';
    return '<div class="adm-field"><label>' + esc(label) + "</label>" + input +
      (hint ? '<div class="hintline">' + hint + "</div>" : "") + "</div>";
  }

  /* 分类与状态：下拉给常用值，下面的输入框可直接改；最终以输入框为准 */
  function choiceField(label, key, val, options) {
    var v = String(val || "");
    var opts = options.map(function (o) {
      return '<option' + (o === v ? " selected" : "") + '>' + esc(o) + "</option>";
    }).join("");
    if (v && options.indexOf(v) < 0) {
      opts = '<option data-custom="1" selected>' + esc(v) + "</option>" + opts;
    }
    return '<div class="adm-field adm-choice"><label>' + esc(label) + "</label>" +
      '<select data-pick="' + key + '">' + opts + "</select>" +
      '<input data-manual="' + key + '" data-k="' + key + '" value="' + esc(v) + '" placeholder="或手动填写">' +
      "</div>";
  }

  /* 手填值回写下拉：命中预设就选中，否则临时补一个同值选项 */
  function syncPick(el) {
    var k = el.getAttribute("data-k");
    var sel = el.parentNode && el.parentNode.querySelector("[data-pick]");
    if (!sel || sel.getAttribute("data-pick") !== k) return;
    var v = el.value;
    var custom = sel.querySelector("option[data-custom]");
    if (custom) custom.parentNode.removeChild(custom);
    if (!v) return;
    var known = [].some.call(sel.options, function (o) { return o.value === v; });
    if (!known) {
      var opt = document.createElement("option");
      opt.setAttribute("data-custom", "1");
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    sel.value = v;
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
      html += '<div class="adm-row">' + field("标识 id（英文，唯一）", "id", it.id) + field("日期", "date", it.date, "如 2026-11") + "</div>";
      html += field("标签", "tags", (it.tags || []).join("、"), "用顿号或逗号分隔");
      html += field("摘要", "summary", it.summary, "", "area");
      html += bodyField(it, "支持 ## 标题、- 列表、> 引用、表格、图片、链接，以及反引号代码");
      html += attachPanel();
    } else if (curType === "journal") {
      html += '<div class="adm-row">' + field("日期", "date", it.date) + field("心情 / 标记（可选）", "mood", it.mood, "如：好嗨 / 一般 / 累") + "</div>";
      html += field("内容", "text", it.text, "支持换行；点「插入图片」把图片放进正文，也可手写 ![说明](图片地址)", "area");
      html += '<div class="adm-tools"><button type="button" data-jimg>插入图片</button></div>';
    } else {
      html += field("名称", "name", it.name);
      html += '<div class="adm-row">' +
        field("类型", "kind", it.kind, "datasheet / manual / tool / image / other") +
        field("大小", "size", it.size, "可留空") + "</div>";
      html += field("说明", "note", it.note);
      html += field("链接", "url", it.url, "网盘或外部地址，填了以后条目可点击");
    }

    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll("[data-k]"), function (el) {
      el.addEventListener("input", function () { applyField(el); syncPick(el); });
      el.addEventListener("change", function () { applyField(el); syncPick(el); });
    });

    /* 选下拉即写入下面的手动框，后续仍可继续改文字 */
    [].forEach.call(wrap.querySelectorAll("[data-pick]"), function (sel) {
      sel.addEventListener("change", function () {
        var k = sel.getAttribute("data-pick");
        var manual = wrap.querySelector('[data-manual="' + k + '"]');
        if (!manual) return;
        manual.value = sel.value;
        manual.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

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
      blank = { name: "新资料", kind: "other", note: "", url: "", size: "" };
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
      });
    }

    if (token()) {
      if ($("tokenRow")) $("tokenRow").style.display = "none";
    }

    /* 载入内容；失败时给出提示，不阻塞界面 */
    if (content) {
      renderList();
      if (content[curType] && content[curType].length) select(0);
      return;
    }

    var bust = "?t=" + Date.now();
    Promise.all(PARTS.map(function (k) {
      return fetch("/content/" + k + ".json" + bust).then(function (r) {
        if (!r.ok) throw new Error(k);
        return r.json();
      });
    })).then(function (arr) {
      /* 按 PARTS 顺序装入，缺字段或响应异常时补空数组，避免切标签报错 */
      content = {};
      PARTS.forEach(function (k, i) {
        content[k] = Array.isArray(arr[i]) ? arr[i] : [];
      });
      renderList();
      if (content[curType] && content[curType].length) select(0);
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
          '<div class="theme-name">历史记录 <span class="hintline" style="display:inline">点「使用」切换当前壁纸</span></div>' +
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
    applyAdminWallpaper(localPreview.admin || themeState.admin);
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
    themeState[historyTarget] = it.url;
    localPreview[historyTarget] = "";
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
          var inp = document.createElement("input");
          inp.type = "file";
          inp.accept = "image/*";
          inp.onchange = function () {
            if (inp.files.length) uploadWallpaper(side, inp.files[0]);
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
        scanRepoHistory();
      });
    }

    var saveB = $("saveBtn");
    if (saveB) saveB.addEventListener("click", saveTheme);

    if (token() && $("tokenRow")) $("tokenRow").style.display = "none";

    loadTheme().then(function () {
      refreshPreview("guest");
      refreshPreview("admin");
      renderHistory();
      applyThemeLocal();
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

  function render(v) {
    var def = VIEWS[v] || VIEWS.home;
    root.className = "adm-view " + def.cls;
    root.innerHTML = def.html();
    document.title = def.title;
    current = v;
    markNav(v);
    syncStatusForView(v);
    window.scrollTo(0, 0);
    var wasFirst = firstAdmRender;
    if (typeof def.mount === "function") def.mount();
    firstAdmRender = false;
  }

  function dirtyNow() {
    return (current === "manage" && contentDirty) || (current === "theme" && themeDirty);
  }

  function switchTo(v, push) {
    if (v === current) return;
    if (transitioning) return;

    if (dirtyNow() && !confirm("还有未保存的改动，确定离开？")) return;

    var target = pathOfView(v);
    transitioning = true;

    var swap = function () {
      if (push) {
        try { history.pushState({ v: v }, "", target); } catch (e) { location.hash = target; }
      }
      render(v);

      root.style.transition = "none";
      root.style.opacity = "0";
      root.style.transform = "translateX(22px)";
      void root.offsetWidth;
      root.style.transition = "opacity .26s ease, transform .32s cubic-bezier(.2,1,.3,1)";
      root.style.opacity = "1";
      root.style.transform = "none";

      window.setTimeout(function () {
        root.style.transition = "";
        root.style.opacity = "";
        root.style.transform = "";
        transitioning = false;
      }, 340);
    };

    root.style.transition = "opacity .17s ease, transform .17s ease";
    root.style.opacity = "0";
    root.style.transform = "translateX(-22px)";

    if (reduceMotion()) {
      root.style.transition = "";
      root.style.opacity = "";
      root.style.transform = "";
      transitioning = false;
      if (push) { try { history.pushState({ v: v }, "", target); } catch (e) {} }
      render(v);
      return;
    }

    window.setTimeout(swap, 175);
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
