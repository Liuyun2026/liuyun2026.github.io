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
  var S = null;   /* 内容数据，启动时从 content.json 载入 */
  /* 是否还要播开场动画，由首屏脚本决定：首页且非「版本重载」才会挂 intro-pending。
     写死 true 的话，版本自检触发的那次重载会再播一遍四秒片头，
     观感就是「刷新后闪一下，然后还得等半天」 */
  var introPending = document.documentElement.classList.contains("intro-pending");
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
      .replace(/\!\[([^\]]*)\]\(([^)\s]+)\)/g,
        '<img src="$2" alt="$1" loading="lazy">')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
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

    function tableRow(t) {
      var cells = [], cur = "", str = t.trim().replace(/^\|/, "").replace(/\|$/, "");
      for (var k = 0; k < str.length; k++) {
        var ch = str[k];
        if (ch === "\\" && str[k + 1] === "|") { cur += "|"; k++; continue; }
        if (ch === "|") { cells.push(cur.trim()); cur = ""; continue; }
        cur += ch;
      }
      cells.push(cur.trim());
      return cells;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i]).trim();

      /* 表格：首行是表头，第二行是 |---| 分隔行 */
      if (line.charAt(0) === "|" && i + 1 < lines.length &&
          /^\|[\s:|-]+\|?[\s:|-]*$/.test(String(lines[i + 1]).trim())) {
        flushPara(); closeList(); closeQuote();
        var head = tableRow(line);
        i += 2;
        var body = [];
        while (i < lines.length && String(lines[i]).trim().charAt(0) === "|") {
          body.push(tableRow(String(lines[i])));
          i++;
        }
        i--;
        var th = head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("");
        var tb = body.map(function (r) {
          return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>";
        }).join("");
        html += '<div class="tablewrap"><table><thead><tr>' + th + "</tr></thead><tbody>" + tb + "</tbody></table></div>";
        continue;
      }

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

  /* ---------- 来源标记 ----------
   * 从管理端点「项目 / 笔记 / 资料」进来时地址带 ?from=admin，
   * 此时顶栏的「首页」指回管理端主页，其余情况指访客首页。
   * 站内切换页面时要把标记带上，否则跳一次就丢了。
   */
  function fromAdmin() {
    return /(^|[?&])from=admin(&|$)/.test(location.search);
  }

  function withOrigin(path) {
    if (!fromAdmin()) return path;
    /* 已经带标记就不再重复追加 */
    if (/(^|[?&])from=admin(&|$)/.test(path)) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "from=admin";
  }

  /* 顶栏随来源切换形态：
   *   「内容 / 壁纸」两项在 HTML 里就有，由 html.from-admin 控制显隐，
   *   因此首帧即为正确的四项或六项，不存在"先少后多"的闪动。
   *   这里只负责把首页链接指向对应主页，并同步根元素标记。
   */
  function syncNavOrigin() {
    var admin = fromAdmin();
    var nav = document.getElementById("navLinks");

    document.documentElement.classList.toggle("from-admin", admin);
    if (nav) nav.classList.toggle("nav-links--admin", admin);

    var home = nav && nav.querySelector('a[data-nav=""]');
    if (!home) return;
    if (admin) {
      home.setAttribute("href", "/admin/");
      home.setAttribute("title", "回管理端主页");
    } else {
      home.setAttribute("href", "/");
      home.removeAttribute("title");
    }
  }

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

  /* 附件列表：正文末尾的文件下载区 */
  function attachments(list) {
    if (!list || !list.length) return "";
    return '<div class="attach">' +
      '<div class="attach-head">附件 · ' + list.length + ' 个</div>' +
      '<div class="attach-list">' +
      list.map(function (a) {
        var href = a.path || a.url || "#";
        var local = !!a.path;
        return '<a class="attach-item" href="' + esc(href) + '"' +
          (local ? " download" : ' target="_blank" rel="noopener"') + ">" +
          '<span class="attach-name">' + esc(a.name) + "</span>" +
          (a.size ? '<span class="attach-size">' + esc(a.size) + "</span>" : "") +
          '<span class="attach-go">' + (local ? "下载 ↓" : "打开 ↗") + "</span></a>";
      }).join("") +
      "</div></div>";
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
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>' },
      /* 气泡里用两字简称：项目 / 笔记 / 资料 / 日志 同一套字号才排得齐，
         全称在圆形内会换行。顶栏仍是「日志与碎碎念」 */
      { href: "/journal", t: "日志", e: "Journal",
        ico: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M8 2.8v3.6M16 2.8v3.6"/><path d="M7.5 13.5h4M7.5 17h7"/></svg>' }
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
                '<span class="pill"><i class="dot"></i>站点</span>' +
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

        '<div class="wrap home-more">' +
          '<section class="block">' +
            secHead("PROJECTS", "项目", S.projects.length + " 个") +
            '<div class="cards">' +
              (S.projects.length
                ? S.projects.map(function (p, i) { return projectCard(p, i); }).join("")
                : '<div class="empty">暂无内容</div>') +
            '</div>' +
          '</section>' +
          '<section class="block">' +
            secHead("NOTES", "笔记", S.notes.length + " 篇") +
            '<div class="nlist">' +
              (recent.length ? recent.map(noteRow).join("") : '<div class="empty">暂无内容</div>') +
            '</div>' +
          '</section>' +
          '<section class="block">' +
            secHead("FILES", "资料", S.files.length + " 项") +
            '<div class="flist">' +
              (S.files.length ? S.files.map(fileRow).join("") : '<div class="empty">暂无内容</div>') +
            '</div>' +
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
            (S.projects.length
              ? S.projects.map(function (p, i) { return projectCard(p, i); }).join("")
              : '<div class="empty">暂无内容</div>') +
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
            .join("") || '<div class="empty">没有匹配的内容</div>';
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
          "</div>" +
          specTable(p.specs) +
          (p.body && p.body.length ? '<article class="prose detail-prose">' + md(p.body) + "</article>" : "") +
          (links ? '<div class="link-row">' + links + "</div>" : "") +
          attachments(p.attachments) +
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
          '<div class="nlist" id="nlist">' +
            (items.length ? items.map(noteRow).join("") : '<div class="empty">暂无内容</div>') +
          "</div>" +
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
          list.innerHTML = hit.length ? hit.map(noteRow).join("") : '<div class="empty">没有匹配的内容</div>';
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
        '<div class="wrap-inner">' + attachments(n.attachments) + "</div>" +
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
    var row = '<a class="frow"' + attrs + ">" +
      '<span class="fkind' + (KIND_CLASS[kind] || "") + '">' + (KIND_LABEL[kind] || "FILE") + "</span>" +
      '<div class="fname">' + esc(f.name) +
        (f.note ? "<small>" + esc(f.note) + "</small>" : "") + "</div>" +
      '<span class="fsize">' + esc(f.size || "") + "</span>" +
      '<span class="fgo">' + (isLocal ? "下载 ↓" : "打开 ↗") + "</span></a>";

    /* 有正文的资料在行下面挂一个可展开块，不打断点击跳转 */
    var body = (f.body || []).join("\n").trim();
    if (!body) return '<div class="fitem">' + row + "</div>";
    return '<div class="fitem">' + row +
      '<details class="fbody"><summary>正文</summary>' +
        '<div class="prose">' + md(body.split("\n")) + "</div>" +
      "</details></div>";
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
            (all.length ? all.map(fileRow).join("") : '<div class="empty">暂无内容</div>') +
          "</div>" +
          (all.length ? '<div class="hint">点条目直接打开；带链接的会另开页面。</div>' : "") +
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
          list.innerHTML = hit.length ? hit.map(fileRow).join("") : '<div class="empty">没有匹配的内容</div>';
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

  /* ---------- 日志与碎碎念 ----------
   * 一条一项：日期 + 心情 + 正文，按日期倒序。
   * 正文以纯文本为主，只把 ![说明](地址) 渲染成图片；
   * 地址只放行站内路径与 http(s)，其余按原文显示。
   */
  function journalText(raw) {
    var s = String(raw || "");
    var re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
    function plain(t) { return esc(t).replace(/\n/g, "<br>"); }
    var out = "", last = 0, m;
    while ((m = re.exec(s)) !== null) {
      out += plain(s.slice(last, m.index));
      var url = m[2];
      out += /^(\/|https?:\/\/)/i.test(url)
        ? '<img class="jimg" src="' + esc(url) + '" alt="' + esc(m[1]) + '" loading="lazy">'
        : plain(m[0]);
      last = re.lastIndex;
    }
    out += plain(s.slice(last));
    return out || '<span class="hintline">（空）</span>';
  }

  function journalRow(it) {
    var mood = it.mood ? '<span class="jmark">' + esc(it.mood) + "</span>" : "";
    return '<div class="jrow">' +
      '<div class="jwhen"><span class="jdate">' + esc(it.date || "") + "</span>" + mood + "</div>" +
      '<div class="jtext">' + journalText(it.text) + "</div>" +
    "</div>";
  }

  function viewJournal() {
    var all = (S.journal || []).slice().sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    });
    return {
      title: S.meta.name + "的日志与碎碎念",
      html: '<div class="wrap">' +
        '<section class="block">' +
          secHead("JOURNAL", "日志与碎碎念", all.length + " 条") +
          '<div class="jlist">' +
            (all.length ? all.map(journalRow).join("") : '<div class="empty">还没有记录</div>') +
          "</div>" +
        "</section>" +
      "</div>",
      mount: function () {}
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
    if (seg === "journal") return viewJournal();
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

  /* 切页方向交给 slideClass：render() 会把它挂到 #view 上，
     真正的位移落在末级视觉块（卡片、列表、标题），容器本身不动。
     容器一旦有 transform 就成了 backdrop root，卡片会先透明再变磨砂 */
  function navigate(target, dir) {
    if (!target || target === currentPath()) return;

    /* 带上来源标记，站内转一圈后「首页」仍知道该回管理端 */
    var url = withOrigin(target);

    slideClass = dir ? (dir > 0 ? "slide-next" : "slide-prev") : "";

    try { history.pushState({ path: target }, "", url); } catch (err) { location.hash = target; }
    render();
    /* 地址先变、标题后设，历史条目的标题要再同步一次才不会记成上一页 */
    try { history.replaceState({ path: target }, document.title, url); } catch (err) {}
  }

  /* ---------- 首页开场动画 ----------
   * 时间轴：
   *   0.00s  卡片铺满全屏（首屏静态层在同一帧交班，两边同一套材质），「你好」浮起
   *   1.25s  「你好」上移淡出
   *   1.70s  欢迎语淡入
   *   2.50s  卡片弹性收缩回原位，模糊同步回到设计值
   *   3.86s  落定，撤掉铺满配方，卡片内容淡入
   *   3.90s  三个气泡自下而上依次弹起
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

  /* 主卡的模糊半径全程不动，就用设计值。
     transform: scale() 确实会把 backdrop 的模糊一起放大（铺满时 34px 看着像 100px+），
     按倍数折回能对上，但那要求一路动画 backdrop-filter——等于每帧重算一遍整屏模糊，
     在真机上直接掉帧。所以反过来选：模糊恒定，让它在收缩过程中随缩放自然收敛，
     落定那一帧正好是设计值，一样没有跳变。 */

  /* 解锁页面：顶栏、页脚恢复显示 */
  function introOff() {
    document.documentElement.classList.remove("intro-on", "intro-pending");
    /* 片头结束，补上等待中的壁纸与档位 */
    if (typeof flushWallpaper === "function") flushWallpaper();
    flushGlass();
  }

  /* 点击打断：立刻收尾到最终状态，不留半截动画 */
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
    window.scrollTo(0, 0);
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

  function playIntro() {
    afterVerCheck(playIntroNow);
  }

  function playIntroNow() {
    var card = document.querySelector(".jelly");
    /* 静态首屏层由 index.html 提供，不在视图 HTML 里重建 */
    var layer = document.getElementById("introLayer");
    var boot = document.getElementById("introBoot");
    /* 提前退出时必须解锁，否则顶栏/页脚会被首屏脚本藏死 */
    var done = function () {
      var bs = document.querySelector(".bubbles");
      if (bs) bs.classList.add("play");
    };
    if (!card || !layer) { introOff(); done(); return; }

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.documentElement.classList.remove("intro-pending");
      introOff(); done(); return;
    }

    var hello = layer.querySelector(".intro-hello");
    var welcome = layer.querySelector(".intro-welcome");
    if (!hello || !welcome) { introOff(); done(); return; }

    /* 静态层首帧已显示「你好」；清掉上一轮留下的状态再接管时间轴 */
    hello.classList.remove("out");
    welcome.classList.remove("in");
    hello.classList.add("show");

    /* 档位在动画开始前定死：本机记忆已由 index.html 的首屏脚本套用，
       这里把 theme.json 的差异一并落地。之后整段片头不再切档——
       满屏卡片、收缩过程、落定后的卡片，自始至终同一套玻璃 */
    flushGlass();

    var r = card.getBoundingClientRect();
    if (!r.width || !r.height) { introOff(); done(); return; }

    var vw = window.innerWidth, vh = window.innerHeight;
    /* 1.05 的余量：移动端地址栏收起会让可视高度变，留一点才保证铺满
       （铺不满时底边会露出没糊的壁纸，看着像「下面缺一块」） */
    var s = Math.max(vw / r.width, vh / r.height) * 1.05;
    var dx = vw / 2 - (r.left + r.width / 2);
    var dy = vh / 2 - (r.top + r.height / 2);
    var move = "translate3d(" + dx + "px," + dy + "px,0)";

    introRunning = true;
    document.documentElement.classList.add("intro-on");

    /* 先上片头配方，再撤待播隐藏，两件事必须在同一帧完成。
       中间隔一次绘制的话，卡片会先以默认的玻璃样式画一帧，
       再切成片头样式，看上去就是「先透后糊」跳一下 */
    card.classList.add("is-intro");
    document.documentElement.classList.remove("intro-pending");

    /* 气泡：位移 + 等比放大。圆角不做任何覆盖，保持 44px，
       这样任意缩放倍数下圆角占宽度的比例恒定，全程都是气泡形态 */
    card.style.transformOrigin = "50% 50%";
    card.style.transform = move + " scale(" + s + ")";

    /* 静态层与卡片都带一层白膜，两层叠着的那几帧整屏会亮一截——看上去就是
       「开头闪一下」。接管时先把静态层的底色抹掉（模糊留着），叠的只剩模糊，
       亮度与接管前一模一样；两帧后整层撤掉，连重叠的模糊也不留 */
    if (boot) {
      boot.style.background = "transparent";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { boot.classList.add("fade"); });
      });
    }

    /* 文字层本身就居中于视口，而气泡放大后中心也在视口中心，
       所以开场不需要位移；收缩时再反向跟随气泡回到原位 */
    layer.style.transform = "translate3d(0,0,0)";
    layer.classList.add("on");

    /* 串行节奏，总时长约五秒半 */
    introLater(function () { hello.classList.add("show"); }, 120);
    introLater(function () { hello.classList.add("out"); }, 1250);
    introLater(function () { welcome.classList.add("in"); }, 1700);

    /* 收缩：气泡与文字层用完全相同的时长和缓动一起归位，两者始终同中心。
       过渡只挂 transform——纯位移缩放走在合成器上，不重绘；
       再加 backdrop-filter 的话每帧都要重算整屏模糊，真机会掉帧 */
    introLater(function () {
      var ease = "cubic-bezier(.32,.9,.3,1)";
      card.style.transition = "transform 1.35s " + ease;
      card.style.transform = "translate3d(0,0,0) scale(1)";
      layer.style.transition = "transform 1.35s " + ease + ", opacity .55s ease";
      layer.style.transform = "translate3d(" + (-dx) + "px," + (-dy) + "px,0)";
      layer.classList.remove("on");
    }, 2500);

    /* 落定（2500 + 1350）之后才撤铺满配方：此时 transform 已是 1，
       模糊本来就是设计值，撤掉只把内容的过渡打开，画面上没有任何变化 */
    introLater(function () { card.classList.remove("is-intro"); }, 3860);

    introLater(function () {
      /* 只撤过渡，卡片保留恒等 transform：从 scale(1) 退回 none 会让这层玻璃
         重新分层、整块重画一次，落定那一刻就是一顿。恒等变换不影响布局 */
      card.style.transition = "";
      layer.style.transition = "none";
      layer.style.transform = "";
      window.setTimeout(function () { layer.style.transition = ""; }, 60);
      /* 必须走 introOff 收尾，不能只 remove("intro-on")：
         片头期间 applyWallpaper 会把壁纸地址挂进 pendingWallpaper，
         由 introOff 里的 flushWallpaper 补上。直接移除类名会让它永远挂着，
         首页就一直停在 CSS 的默认壁纸，表现为「换了壁纸没反应」 */
      introOff();
      var bubbles = document.querySelector(".bubbles");
      if (bubbles) bubbles.classList.add("play");
      introRunning = false;
    }, 3900);
  }

  function render() {
    if (!S) return;
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

    /* 顶栏按来源切形态：管理端进来的补内容/壁纸，首页指回管理端 */
    syncNavOrigin();

    window.scrollTo(0, 0);

    /* 同步启动：内容刚写入 DOM、尚未绘制，此时上加缩放变换不会闪出原位 */
    if (introPending && currentPath() === "/" && !location.hash.replace(/^#\/?/, "").split("/")[0]) {
      introPending = false;
      playIntro();
    }

    lastPath = currentPath();

    /* 新内容已进 DOM、尚未绘制，此时挂方向类，首帧就是滑动的起点 */
    if (slideClass) {
      view.classList.remove("slide-next", "slide-prev");
      void view.offsetWidth;
      view.classList.add(slideClass);
      (function (cls) {
        window.setTimeout(function () { view.classList.remove(cls); }, 460);
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
  function pageOrder() {
    return ["", "projects", "notes", "files", "journal"];
  }
  var slideClass = "";

  function indexOfPath(p) {
    var seg = String(p || "").replace(/^\//, "").split("/")[0] || "";
    return pageOrder().indexOf(seg);
  }

  function pageIndex() {
    return indexOfPath(currentPath());
  }

  function slideTo(dir) {
    var i = pageIndex();
    if (i < 0) return;
    var n = i + dir;
    var order = pageOrder();
    if (n < 0 || n >= order.length) return;

    /* 滑到「首页」且来自管理端时，跳管理端主页（独立页面，只能整页跳转） */
    if (n === 0 && fromAdmin()) {
      location.href = "/admin/";
      return;
    }

    var target = "/" + order[n];
    navigate(target.replace(/\/$/, "") || "/", dir);
  }

  function initSwipe() {
    var startX = 0, startY = 0, tracking = false;

    document.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      if (document.documentElement.classList.contains("intro-on")) { tracking = false; return; }
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

  /* 壁纸由 content/theme.json 决定，缺省时用内置图。
     先离屏解码再换背景：直接赋值会在主线程解码整图，若正好撞上开场动画就掉帧。
     片头播放期间先挂起，动画结束后再换，避免抢动画的帧。 */
  var pendingWallpaper = "";

  function paintWallpaper(url) {
    var bg = document.querySelector(".bg");
    if (!bg || !url) return;
    /* 记住这张地址：下次进入首屏直接用它，不必等 theme.json 回来，
       否则会先显示默认图、再看着它换成用户那张 */
    try { localStorage.setItem("bg-guest", url); } catch (e) {}
    var probe = new Image();
    probe.decoding = "async";
    var show = function () {
      bg.style.backgroundImage = 'url("' + url + '")';
      /* 解码完成后才亮：边下边挂会让图片从上往下一段段画出来 */
      bg.classList.add("bg-on");
    };
    probe.onload = function () {
      if (probe.decode) probe.decode().then(show, show); else show();
    };
    probe.onerror = show;
    probe.src = url;
  }

  /* 玻璃质感由 theme.json 的 glass 字段决定：clear 为透明，其余按磨砂。
     该字段分两侧存（guest / admin），访客端只取 guest；
     旧数据是单个字符串，直接当作 guest 值使用 */
  function glassOf(v) {
    var g = (v && typeof v === "object") ? v.guest : v;
    return g === "clear" ? "clear" : "frosted";
  }

  /* 片头进行中要切换的档位先存这里，收尾时再落地 */
  var pendingGlass = null;

  function applyGlass(v) {
    var cur = glassOf(v);
    /* 本机记忆立刻更新：下次进入由 HTML 首屏脚本直接套用 */
    try { localStorage.setItem("glass-guest", cur); } catch (e) {}

    var de = document.documentElement;
    /* 片头进行中：卡片还没铺满之前算「动画前」，这时落地最安全，数据一到就定；
       一旦卡片已经铺满，中途切会让整页玻璃在眼前变一次，只能推迟到收尾。
       首帧用的是本机记忆，只有首次访问或换了设备才会走到推迟那一支 */
    if (de.classList.contains("intro-on") && document.querySelector(".jelly.is-intro")) {
      pendingGlass = cur;
      return;
    }
    de.classList.toggle("glass-clear", cur === "clear");
  }

  function flushGlass() {
    if (pendingGlass === null) return;
    document.documentElement.classList.toggle("glass-clear", pendingGlass === "clear");
    pendingGlass = null;
  }

  function applyWallpaper(url) {
    if (!url) return;
    /* 不再等片头结束再换图：越早换，越能藏在片头的覆盖层下面完成。
       预加载用 decoding: async，不会抢动画的帧 */
    paintWallpaper(url);
  }

  /* 片头结束时由 introOff 调用，补上被挂起的壁纸 */
  function flushWallpaper() {
    if (!pendingWallpaper) return;
    var url = pendingWallpaper;
    pendingWallpaper = "";
    paintWallpaper(url);
  }

  function initStatic() {
    document.getElementById("navStatus").textContent = "站点";
    document.getElementById("navGithub").href = S.meta.github;
    document.getElementById("footLinks").innerHTML =
      '<a href="' + esc(S.meta.github) + '" target="_blank" rel="noopener">GitHub</a>';
  }

  window.addEventListener("popstate", function () {
    if (currentPath() === lastPath) return;
    var from = indexOfPath(lastPath), to = indexOfPath(currentPath());
    slideClass = (from > -1 && to > -1 && to !== from) ? (to > from ? "slide-next" : "slide-prev") : "";
    render();
  });

  /* 站内所有 hash 链接统一走 navigate，保证每次切换都有过渡 */
  document.addEventListener("click", function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href^="/"]') : null;
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href.indexOf("//") === 0) return;
    /* 独立页面（管理端、内容、壁纸、手册）交给浏览器整页跳转，不走站内路由 */
    if (/^\/(admin|manage|theme|manual)(\/|$)/.test(href)) return;
    e.preventDefault();

    var cur = pageOrder().indexOf(currentPath().replace(/^\//, "").split("/")[0] || "");
    var nxt = pageOrder().indexOf(href.replace(/^\//, "").split("/")[0] || "");
    navigate(href, (cur >= 0 && nxt >= 0 && nxt < cur) ? -1 : 1);
  });

  /* 片头期间整页锁定，任意点击即跳过 */
  function introGuard(e) {
    if (!document.documentElement.classList.contains("intro-on")) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    skipIntro();
  }
  document.addEventListener("touchstart", introGuard, { capture: true, passive: false });
  document.addEventListener("mousedown", introGuard, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      if (document.documentElement.classList.contains("intro-on")) skipIntro();
    }
  }, true);

  window.addEventListener("resize", function () { movePill(false); });

  initSwipe();

  /* 内容按类别拆在 content/ 目录下，与代码区分离。
     请求带时间戳：绕开浏览器与 CDN 对 JSON 的缓存，保存后刷新立即生效 */
  var PARTS = ["meta", "projects", "notes", "files", "journal", "theme"];
  var bust = "?t=" + Date.now();
  Promise.all(PARTS.map(function (k) {
    return fetch("/content/" + k + ".json" + bust).then(function (res) {
      if (!res.ok) throw new Error(k + " HTTP " + res.status);
      return res.json();
    });
  }))
    .then(function (arr) {
      /* meta 是对象而非数组；数据异常时补齐默认值，
         保证站点名、状态条与 GitHub 主页链接始终可用 */
      var m = (arr[0] && !Array.isArray(arr[0]) && typeof arr[0] === "object") ? arr[0] : {};
      S = {
        meta: {
          name: m.name || "流雲",
          status: m.status || "",
          github: m.github || "https://github.com/Liuyun2026"
        },
        projects: arr[1], notes: arr[2], files: arr[3], journal: arr[4], theme: arr[5]
      };
      applyWallpaper(S.theme && S.theme.guest);
      applyGlass(S.theme && S.theme.glass);
      initStatic();
      render();
    })
    .catch(function () {
      /* 加载失败时解锁页面，顶栏与页脚正常显示错误提示 */
      introOff();
      view.innerHTML =
        '<div class="wrap"><div class="empty">内容加载失败，请刷新页面重试</div></div>';
    });
})();
