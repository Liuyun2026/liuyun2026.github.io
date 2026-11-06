/* ============================================================================
 * app.js —— 极简 hash 路由 + 渲染
 *
 * 路由表：
 *   #/                首页
 *   #/projects        项目列表
 *   #/project/:id     项目详情
 *   #/notes           笔记列表
 *   #/note/:id        笔记正文
 *   #/files           资料
 * ========================================================================== */

(function () {
  "use strict";

  var view = document.getElementById("view");
  var S = SITE;
  var introPending = true;   /* 首页开场动画是否还需要播放 */
  var lastPath = null;       /* 已渲染过的路径，避免同一地址重复渲染 */
  var introTimers = [];      /* 开场动画的全部定时器，点击打断时统一清除 */
  var introRunning = false;
  var pillReady = false;     /* 导航气泡是否已完成首次定位 */

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 行内标记：`code` / **粗** / [文字](链接) */
  function inline(t) {
    return esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  /* 行级解析：## 标题 / - 列表 / > 引用 / ``` 代码块 / 空行分段 */
  function md(lines) {
    var html = "", para = [], inList = false, inQuote = false;

    function flushPara() {
      if (para.length) { html += "<p>" + inline(para.join(" ")) + "</p>"; para = []; }
    }
    function closeList() { if (inList) { html += "</ul>"; inList = false; } }
    function closeQuote() { if (inQuote) { html += "</blockquote>"; inQuote = false; } }

    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i]).trim();

      if (line.indexOf("```") === 0) {
        flushPara(); closeList(); closeQuote();
        var code = [];
        i++;
        while (i < lines.length && String(lines[i]).trim().indexOf("```") !== 0) {
          code.push(lines[i]); i++;
        }
        html += "<pre><code>" + esc(code.join("\n")) + "</code></pre>";
        continue;
      }
      if (!line) { flushPara(); closeList(); closeQuote(); continue; }

      if (line.indexOf("## ") === 0) {
        flushPara(); closeList(); closeQuote();
        html += "<h2>" + inline(line.slice(3)) + "</h2>";
        continue;
      }
      if (line.indexOf("### ") === 0) {
        flushPara(); closeList(); closeQuote();
        html += "<h3>" + inline(line.slice(4)) + "</h3>";
        continue;
      }
      if (line.indexOf("- ") === 0) {
        flushPara(); closeQuote();
        if (!inList) { html += "<ul>"; inList = true; }
        html += "<li>" + inline(line.slice(2)) + "</li>";
        continue;
      }
      if (line.indexOf("> ") === 0) {
        flushPara(); closeList();
        if (!inQuote) { html += "<blockquote>"; inQuote = true; }
        html += "<p>" + inline(line.slice(2)) + "</p>";
        continue;
      }

      closeList(); closeQuote();
      para.push(line);
    }
    flushPara(); closeList(); closeQuote();
    return html;
  }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  /* 状态色：进行中 → 黄，锁定/在用 → 绿，开源/发布 → 蓝 */
  function badgeClass(status) {
    var s = status || "";
    if (/进行中|设计中|草稿|待补/.test(s)) return "warn";
    if (/开源|发布/.test(s)) return "info";
    if (/固化|在用|完成/.test(s)) return "ok";
    return "mute";
  }

  function badge(status) {
    return '<span class="badge badge--' + badgeClass(status) + '">' + esc(status) + "</span>";
  }

  function tags(list) {
    if (!list || !list.length) return "";
    return '<div class="tags">' + list.map(function (t) {
      return '<span class="tag">' + esc(t) + "</span>";
    }).join("") + "</div>";
  }

  function secHead(kicker, title, count) {
    return '<div class="sec-head"><span class="kicker">' + esc(kicker) + "</span><h2>" +
      esc(title) + "</h2>" + (count != null ? '<span class="count">' + esc(count) + "</span>" : "") + "</div>";
  }

  /* ---------- 组件 ---------- */

  function specCard() {
    return '<aside class="spec-card">' +
      '<div class="card-title"><span>DEVICE PROFILE</span><span>REV.A</span></div>' +
      "<dl>" + S.spec.map(function (row) {
        return '<div class="spec-row"><dt>' + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd></div>";
      }).join("") + "</dl></aside>";
  }

  function projectCard(p, i) {
    return '<a class="pcard" href="/project/' + esc(p.id) + '">' +
      '<div class="pcard-top">' +
        '<span class="pcard-idx">P-' + pad2(i + 1) + "</span>" +
        badge(p.status) +
        '<span class="pcard-cat">' + esc(p.category || "") + "</span>" +
      "</div>" +
      "<h3>" + esc(p.title) + "</h3>" +
      '<div class="sub">' + esc(p.subtitle) + "</div>" +
      '<p class="sum">' + esc(p.summary) + "</p>" +
      tags(p.tags) + "</a>";
  }

  function specTable(specs) {
    return '<table class="spectable"><caption>SPECIFICATIONS</caption><tbody>' +
      specs.map(function (r) {
        return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  /* ---------- 视图 ---------- */

  function viewHome() {
    var recent = S.notes.filter(function (n) { return !n.draft; }).slice(0, 3);

    var bubbles = [
      { href: "/projects", t: "项目", e: "Projects",
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7z"/><path d="M3.5 7 12 11.4 20.5 7M12 11.4V21.2"/></svg>' },
      { href: "/notes", t: "笔记", e: "Notes",
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h9L19 7.5v13H6z"/><path d="M14.5 3.5V8H19"/><path d="M9 12h7M9 15.5h7M9 8.5h2.5"/></svg>' },
      { href: "/files", t: "资料", e: "Files",
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>' }
    ];

    return {
      title: S.meta.name + "的创客空间",
      html:
        '<div class="home">' +
          '<section class="hero-jelly">' +
            '<div class="jelly">' +
              '<span class="jelly-tag">你好</span>' +
              '<h1>欢迎来到<span class="hl">流雲</span>的创客空间</h1>' +
              '<div class="jelly-meta">' +
                '<span class="pill"><i class="dot"></i>' + esc(S.meta.status) + '</span>' +
                '<a class="pill pill--link" href="' + esc(S.meta.github) + '" target="_blank" rel="noopener">GitHub ↗</a>' +
              '</div>' +
            '</div>' +
          '</section>' +
          '<nav class="bubbles">' +
            bubbles.map(function (b) {
              return '<a class="bubble" href="' + b.href + '">' +
                '<span class="bubble-ico">' + b.ico + '</span>' +
                '<span class="bubble-t">' + b.t + '</span>' +
                '<span class="bubble-e">' + b.e + '</span></a>';
            }).join("") +
          '</nav>' +
        '</div>' +

        /* 开场文字层：独立于卡片，只跟随位移不参与缩放，字号恒定 */
        '<div class="intro-layer">' +
          '<div class="intro-hello"><span>你</span><span>好</span></div>' +
          '<div class="intro-welcome">欢迎来到<span class="hl">流雲</span>的创客空间</div>' +
        '</div>' +

        '<div class="wrap home-more">' +
          '<section class="block">' +
            secHead("NOTES", "最近笔记", recent.length + " 篇") +
            '<div class="nlist">' + recent.map(noteRow).join("") + '</div>' +
          '</section>' +
        '</div>'
    };
  }

  function viewProjects() {
    return {
      title: S.meta.name + "的项目",
      html: '<div class="wrap">' +
        '<section class="block">' +
          secHead("PROJECTS", "项目", S.projects.length + " 个") +
          '<div class="filterbar" id="pfilter">' +
            '<button class="chip on" data-cat="">全部</button>' +
            ["硬件", "软件", "文档"].map(function (c) {
              return '<button class="chip" data-cat="' + c + '">' + c + "</button>";
            }).join("") +
          "</div>" +
          '<div class="cards" id="plist">' +
            S.projects.map(function (p, i) { return projectCard(p, i); }).join("") +
          "</div>" +
        "</section>" +
      "</div>",
      mount: function () {
        var list = document.getElementById("plist");
        document.getElementById("pfilter").addEventListener("click", function (e) {
          var btn = e.target.closest(".chip");
          if (!btn) return;
          [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.remove("on"); });
          btn.classList.add("on");
          var cat = btn.getAttribute("data-cat");
          list.innerHTML = S.projects
            .map(function (p, i) { return { p: p, i: i }; })
            .filter(function (o) { return !cat || o.p.category === cat; })
            .map(function (o) { return projectCard(o.p, o.i); })
            .join("") || '<div class="empty">该分类下暂无项目</div>';
        });
      }
    };
  }

  function viewProject(id) {
    var p = null, idx = 0;
    S.projects.forEach(function (x, i) { if (x.id === id) { p = x; idx = i; } });
    if (!p) return viewNotFound();

    var links = (p.links || []).map(function (l) {
      return '<a class="btn" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
        esc(l.label) + " ↗</a>";
    }).join("");

    return {
      title: p.title,
      html: '<div class="wrap">' +
        '<div class="detail-head">' +
          '<a class="back" href="/projects">← 项目</a>' +
          '<div class="pcard-top"><span class="pcard-idx">P-' + pad2(idx + 1) + "</span>" +
            badge(p.status) +
            '<span class="pcard-cat">' + esc(p.category) + (p.year ? " · " + esc(p.year) : "") + "</span></div>" +
          "<h1>" + esc(p.title) + "</h1>" +
          '<div class="sub">' + esc(p.subtitle) + "</div>" +
        "</div>" +
        '<div class="detail-body">' +
          "<div>" +
            '<p class="lead">' + esc(p.summary) + "</p>" +
            tags(p.tags) +
            (links ? '<div class="link-row">' + links + "</div>" : "") +
          "</div>" +
          specTable(p.specs) +
        "</div>" +
      "</div>"
    };
  }

  function noteRow(n) {
    return '<a class="nitem" href="/note/' + esc(n.id) + '">' +
      '<span class="date">' + esc(n.date || "—") + "</span>" +
      "<div><h3>" + esc(n.title) + "</h3><p>" + esc(n.summary) + "</p></div>" +
      '<span class="arrow">→</span></a>';
  }

  function viewNotes() {
    var items = S.notes.filter(function (n) { return !n.draft; });
    return {
      title: S.meta.name + "的笔记",
      html: '<div class="wrap">' +
        '<section class="block">' +
          secHead("NOTES", "技术笔记", items.length + " 篇") +
          '<div class="filterbar">' +
            '<label class="search">' +
              '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>' +
              '<input id="nq" type="search" placeholder="搜索标题 / 标签" autocomplete="off">' +
            "</label>" +
          "</div>" +
          '<div class="nlist" id="nlist">' + items.map(noteRow).join("") + "</div>" +
        "</section>" +
      "</div>",
      mount: function () {
        var list = document.getElementById("nlist");
        var q = document.getElementById("nq");
        q.addEventListener("input", function () {
          var k = q.value.trim().toLowerCase();
          var hit = items.filter(function (n) {
            if (!k) return true;
            return (n.title + " " + n.summary + " " + (n.tags || []).join(" ") + " " + (n.body || []).join(" "))
              .toLowerCase().indexOf(k) >= 0;
          });
          list.innerHTML = hit.length ? hit.map(noteRow).join("") : '<div class="empty">没有匹配的笔记</div>';
        });
      }
    };
  }

  function viewNote(id) {
    var n = null;
    S.notes.forEach(function (x) { if (x.id === id) n = x; });
    if (!n) return viewNotFound();

    return {
      title: n.title,
      html: '<div class="wrap">' +
        '<div class="detail-head">' +
          '<a class="back" href="/notes">← 笔记</a>' +
          "<h1>" + esc(n.title) + "</h1>" +
          '<div class="sub">' + (n.date ? esc(n.date) + " · " : "") +
            (n.tags || []).map(esc).join(" · ") + "</div>" +
        "</div>" +
        '<article class="prose">' + md(n.body || []) + "</article>" +
      "</div>"
    };
  }

  var KIND_LABEL = { datasheet: "DS", manual: "DOC", tool: "TOOL", image: "IMG", other: "FILE" };
  var KIND_CLASS = { manual: " fkind--manual", tool: " fkind--tool", image: " fkind--other", other: " fkind--other" };

  function fileRow(f) {
    var isLocal = !!f.path;
    var href = f.url || f.path || "#";
    var attrs = isLocal
      ? ' href="' + esc(href) + '" download'
      : ' href="' + esc(href) + '" target="_blank" rel="noopener"';
    var kind = f.kind || "other";
    return '<a class="frow"' + attrs + ">" +
      '<span class="fkind' + (KIND_CLASS[kind] || "") + '">' + (KIND_LABEL[kind] || "FILE") + "</span>" +
      '<div class="fname">' + esc(f.name) +
        (f.note ? "<small>" + esc(f.note) + "</small>" : "") + "</div>" +
      '<span class="fsize">' + esc(f.size || "") + "</span>" +
      '<span class="fgo">' + (isLocal ? "下载 ↓" : "打开 ↗") + "</span></a>";
  }

  function viewFiles() {
    var all = S.files || [];
    return {
      title: S.meta.name + "的资料",
      html: '<div class="wrap">' +
        '<section class="block">' +
          secHead("FILES", "资料", all.length + " 项") +
          '<div class="filterbar">' +
            '<button class="chip on" data-kind="">全部</button>' +
            ["datasheet", "manual", "tool", "image"].map(function (k) {
              return '<button class="chip" data-kind="' + k + '">' + KIND_LABEL[k] + "</button>";
            }).join("") +
            '<label class="search">' +
              '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>' +
              '<input id="fq" type="search" placeholder="搜索资料" autocomplete="off">' +
            "</label>" +
          "</div>" +
          '<div class="flist" id="flist">' +
            (all.length ? all.map(fileRow).join("") : '<div class="empty">还没有资料</div>') +
          "</div>" +
          '<div class="hint">' +
            "本地文件放在 <code>assets/files/</code> 目录下，然后在 <code>data.js</code> 的 <code>SITE.files</code> 里加一条：" +
            "本地文件用 <code>path: \"assets/files/文件名\"</code>，外部资源用 <code>url</code>。" +
            "支持 <code>datasheet / manual / tool / image / other</code> 五种类型，筛选项自动对应。" +
          "</div>" +
        "</section>" +
      "</div>",
      mount: function () {
        var list = document.getElementById("flist");
        var q = document.getElementById("fq");
        var bar = document.querySelector(".filterbar");
        var kind = "";

        function draw() {
          var k = q.value.trim().toLowerCase();
          var hit = all.filter(function (f) {
            if (kind && (f.kind || "other") !== kind) return false;
            if (!k) return true;
            return (f.name + " " + (f.note || "")).toLowerCase().indexOf(k) >= 0;
          });
          list.innerHTML = hit.length ? hit.map(fileRow).join("") : '<div class="empty">没有匹配的资料</div>';
        }

        bar.addEventListener("click", function (e) {
          var btn = e.target.closest(".chip");
          if (!btn) return;
          [].forEach.call(bar.querySelectorAll(".chip"), function (c) { c.classList.remove("on"); });
          btn.classList.add("on");
          kind = btn.getAttribute("data-kind");
          draw();
        });
        q.addEventListener("input", draw);
      }
    };
  }

  function viewNotFound() {
    return {
      title: S.meta.name + "的创客空间",
      html: '<div class="wrap"><section class="block" style="padding-top:80px">' +
        '<div class="empty">404 · 这一页不存在<br><br>' +
        '<a href="/">← 回首页</a></div></section></div>'
    };
  }

  /* ---------- 路由 ---------- */

  function currentPath() {
    var p = location.pathname.replace(/\/+$/, "");
    return p || "/";
  }

  function route() {
    var h = currentPath().replace(/^\//, "");
    var parts = h.split("/").filter(Boolean);
    var seg = parts[0] || "";
    var arg = parts[1] ? decodeURIComponent(parts[1]) : "";

    if (!seg) return viewHome();
    if (seg === "projects") return viewProjects();
    if (seg === "project") return viewProject(arg);
    if (seg === "notes") return viewNotes();
    if (seg === "note") return viewNote(arg);
    if (seg === "files") return viewFiles();
    return viewNotFound();
  }

  /* ---------- 导航气泡 ----------
   * 气泡是绝对定位的，位置与宽度取自当前选中项，用 transform 平移实现滑动
   */
  function movePill(animate) {
    var pill = document.querySelector(".nav-pill");
    var links = document.querySelectorAll("#navLinks a");
    if (!pill || !links.length) return;

    var active = null;
    for (var i = 0; i < links.length; i++) {
      if (links[i].classList.contains("on")) { active = links[i]; break; }
    }
    if (!active) { pill.style.opacity = "0"; return; }

    if (!animate) pill.style.transition = "none";
    pill.style.width = active.offsetWidth + "px";
    pill.style.transform = "translateX(" + active.offsetLeft + "px)";
    pill.style.opacity = "1";
    if (!animate) {
      void pill.offsetWidth;
      pill.style.transition = "";
    }
  }

  /* ---------- 页面切换 ----------
   * 旧内容淡出并轻微左移 → 换内容 → 新内容淡入并回到原位
   * 不依赖 View Transition，任何浏览器表现一致
   */
  var transitioning = false;

  function navigate(target, dir) {
    if (!target || target === currentPath() || transitioning) return;

    var next = dir > 0;
    transitioning = true;

    view.style.transition = "opacity .17s ease, transform .17s ease";
    view.style.opacity = "0";
    view.style.transform = "translateX(" + (next ? -22 : 22) + "px)";

    window.setTimeout(function () {
      try { history.pushState({ path: target }, "", target); } catch (err) { location.hash = target; }
      render();

      view.style.transition = "none";
      view.style.transform = "translateX(" + (next ? 22 : -22) + "px)";
      void view.offsetWidth;

      view.style.transition = "opacity .26s ease, transform .32s cubic-bezier(.2, 1, .3, 1)";
      view.style.opacity = "1";
      view.style.transform = "none";

      window.setTimeout(function () {
        view.style.transition = "";
        view.style.opacity = "";
        view.style.transform = "";
        transitioning = false;
      }, 340);
    }, 175);
  }

  /* ---------- 首页开场动画 ----------
   * 时间轴：
   *   0.00s  卡片铺满全屏，「你好」逐字浮现
   *   0.90s  卡片弹性收缩回原位，「你好」缩小上移淡出
   *   1.25s  卡片内容淡入
   *   1.80s  三个气泡自下而上依次弹起
   * 收缩用 FLIP：先量出卡片最终位置，反向施加 transform 使其与全屏重合，
   * 再去掉 transform，浏览器自行补间，布局不会错位。
   */
  function introLater(fn, ms) {
    introTimers.push(window.setTimeout(fn, ms));
  }

  function clearIntroTimers() {
    for (var i = 0; i < introTimers.length; i++) window.clearTimeout(introTimers[i]);
    introTimers = [];
  }

  /* 点击打断：立刻收尾到最终状态，不留半截动画 */
  function skipIntro() {
    if (!introRunning) return;
    introRunning = false;
    clearIntroTimers();

    var card = document.querySelector(".jelly");
    var layer = document.querySelector(".intro-layer");

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

    document.body.classList.remove("intro-on");
    document.documentElement.classList.remove("intro-on");
    window.scrollTo(0, 0);
  }

  function playIntro() {
    var card = document.querySelector(".jelly");
    var layer = document.querySelector(".intro-layer");
    if (!card || !layer) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var hello = layer.querySelector(".intro-hello");
    var welcome = layer.querySelector(".intro-welcome");
    if (!hello || !welcome) return;

    var r = card.getBoundingClientRect();
    if (!r.width || !r.height) return;

    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.max(vw / r.width, vh / r.height) * 1.02;
    var dx = vw / 2 - (r.left + r.width / 2);
    var dy = vh / 2 - (r.top + r.height / 2);
    var move = "translate3d(" + dx + "px," + dy + "px,0)";

    introRunning = true;
    document.body.classList.add("intro-on");
    document.documentElement.classList.add("intro-on");
    card.classList.add("is-intro");

    /* 气泡：位移 + 等比放大。圆角不做任何覆盖，保持 44px，
       这样任意缩放倍数下圆角占宽度的比例恒定，全程都是气泡形态 */
    card.style.transformOrigin = "50% 50%";
    card.style.transform = move + " scale(" + s + ")";

    /* 文字层本身就居中于视口，而气泡放大后中心也在视口中心，
       所以开场不需要位移；收缩时再反向跟随气泡回到原位 */
    layer.style.transform = "translate3d(0,0,0)";
    layer.classList.add("on");

    /* 串行节奏，总时长约 5 秒 */
    introLater(function () { hello.classList.add("show"); }, 120);
    introLater(function () { hello.classList.add("out"); }, 1250);
    introLater(function () { welcome.classList.add("in"); }, 1700);

    /* 收缩：气泡与文字层用完全相同的时长和缓动一起归位，两者始终同中心 */
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
      document.body.classList.remove("intro-on");
      document.documentElement.classList.remove("intro-on");
      var bubbles = document.querySelector(".bubbles");
      if (bubbles) bubbles.classList.add("play");
      introRunning = false;
    }, 3900);
  }

  function render() {
    var r = route();
    view.innerHTML = r.html;
    document.title = r.title || S.meta.name;
    if (typeof r.mount === "function") r.mount();

    var seg = currentPath().replace(/^\//, "").split("/")[0] || "";
    var key = /^(project|projects)$/.test(seg) ? "projects"
      : /^(note|notes)$/.test(seg) ? "notes"
      : seg;
    [].forEach.call(document.querySelectorAll("#navLinks a"), function (a) {
      a.classList.toggle("on", a.getAttribute("data-nav") === key);
    });

    window.scrollTo(0, 0);

    if (introPending && !location.hash.replace(/^#\/?/, "").split("/")[0]) {
      introPending = false;
      window.setTimeout(playIntro, 40);
    }

    lastPath = currentPath();

    if (slideClass) {
      view.classList.remove("slide-next", "slide-prev");
      void view.offsetWidth;
      view.classList.add(slideClass);
      (function (cls) {
        window.setTimeout(function () { view.classList.remove(cls); }, 420);
      })(slideClass);
      slideClass = "";
    }

    /* 首次定位不要动画，之后跟随选中项滑动 */
    movePill(pillReady);
    pillReady = true;
  }

  /* ---------- 左右滑动切换 ----------
   * 顺序：首页 → 项目 → 笔记 → 资料
   * 左滑进入下一项（新页从右侧进），右滑返回上一项
   * 详情页（#/note/xxx、#/project/xxx）不参与滑动，避免和返回逻辑冲突
   */
  var PAGE_ORDER = ["", "projects", "notes", "files"];
  var slideClass = "";

  function pageIndex() {
    var seg = currentPath().replace(/^\//, "").split("/")[0] || "";
    return PAGE_ORDER.indexOf(seg);
  }

  function slideTo(dir) {
    var i = pageIndex();
    if (i < 0) return;
    var n = i + dir;
    if (n < 0 || n >= PAGE_ORDER.length) return;
    var target = "/" + PAGE_ORDER[n];
    navigate(target.replace(/\/$/, "") || "/", dir);
  }

  function initSwipe() {
    var startX = 0, startY = 0, tracking = false;

    document.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      if (document.body.classList.contains("intro-on")) { tracking = false; return; }
      /* 排除可横向滚动的内容与输入框，否则会抢走手势 */
      var t = e.target;
      if (t && t.closest && t.closest("pre, input, textarea, .hint")) { tracking = false; return; }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    document.addEventListener("touchend", function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (Math.abs(dx) < 55) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.15) return;
      slideTo(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  /* ---------- 静态部分 ---------- */

  function initStatic() {
    var yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = S.meta.year;
    document.getElementById("navStatus").textContent = S.meta.status;
    document.getElementById("navGithub").href = S.meta.github;

    var links = '<a href="' + esc(S.meta.github) + '" target="_blank" rel="noopener">GitHub</a>';
    if (S.meta.email) {
      links += '<a href="mailto:' + esc(S.meta.email) + '">' + esc(S.meta.email) + "</a>";
    }
    document.getElementById("footLinks").innerHTML = links;
  }

  window.addEventListener("popstate", function () {
    if (currentPath() === lastPath) return;
    render();
  });

  /* 站内所有 hash 链接统一走 navigate，保证每次切换都有过渡 */
  document.addEventListener("click", function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href^="/"]') : null;
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href.indexOf("//") === 0) return;
    e.preventDefault();

    var cur = PAGE_ORDER.indexOf(currentPath().replace(/^\//, "").split("/")[0] || "");
    var nxt = PAGE_ORDER.indexOf(href.replace(/^\//, "").split("/")[0] || "");
    navigate(href, (cur >= 0 && nxt >= 0 && nxt < cur) ? -1 : 1);
  });

  /* 片头期间整页锁定，任意点击即跳过 */
  function introGuard(e) {
    if (!document.body.classList.contains("intro-on")) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    skipIntro();
  }
  document.addEventListener("touchstart", introGuard, { capture: true, passive: false });
  document.addEventListener("mousedown", introGuard, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      if (document.body.classList.contains("intro-on")) skipIntro();
    }
  }, true);

  window.addEventListener("resize", function () { movePill(false); });
  initSwipe();
  initStatic();
  render();
})();
