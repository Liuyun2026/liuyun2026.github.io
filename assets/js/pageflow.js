/* ============================================================================
 * pageflow.js —— 独立页面之间的跳转过渡
 *
 * 适用范围：管理端主页 / 内容 / 壁纸 / 手册与访客端之间的跳转。
 * 这些是各自独立的 HTML，只能整页加载；访客端内部的 首页 / 日志 / 项目 /
 * 笔记 / 资料 属于同一 SPA，由 app.js 自己处理，不经过本脚本。
 *
 * 三个动作：
 *   1. 预取   指针移入或触摸按下时插入 <link rel=prefetch>，点击时 HTML 已在缓存
 *   2. 淡出   点击后先淡出 140ms 再跳转，避免瞬间白屏
 *   3. 淡入   目标页加载后淡入 200ms，与淡出连成一次过渡
 *
 * 不使用 @view-transition：跨文档视图过渡会把旧页快照叠在新页面上，
 * 与首页/管理端主页的开场动画冲突（表现为文字播两次、首次带顶栏），已移除。
 *
 * 监听使用 capture 阶段，先于各页自身脚本的冒泡监听。
 * ========================================================================== */

(function () {
  "use strict";

  var LEAVE_MS = 140;
  var NAV_KEY = "pf-navigating";
  var leaving = false;

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function norm(p) {
    return String(p || "").replace(/\/+$/, "") || "/";
  }

  /* 独立页面：必须整页跳转，不能由 SPA 路由接管 */
  function isStandalone(pathname) {
    return /^\/(admin|manage|theme|manual)(\/|$)/.test(pathname);
  }

  /* 访客端 SPA 存在 #view 容器；它自己处理 /、/journal、/projects 等路由 */
  function isGuestSpa() {
    return !!document.getElementById("view");
  }

  function urlOf(a) {
    try { return new URL(a.getAttribute("href"), location.href); } catch (e) { return null; }
  }

  /* 这个地址是否必须整页跳转 */
  function needsFullLoad(u) {
    if (!u || u.origin !== location.origin) return false;
    if (isStandalone(u.pathname)) return true;
    /* 当前页不是访客 SPA 时，任何站内跳转都是整页加载，一律接管 */
    if (!isGuestSpa()) return true;
    /* 访客 SPA 内部路由不归这里管 */
    return false;
  }

  function prefetch(u) {
    try {
      var href = u.pathname + u.search;
      if (document.querySelector('link[rel="prefetch"][data-pf="' + href + '"]')) return;
      var link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "document";
      link.href = href;
      link.setAttribute("data-pf", href);
      document.head.appendChild(link);
    } catch (e) {}
  }

  /* ---- 1. 预取：悬停 / 触摸 / 聚焦即预热 ---- */
  function warm(e) {
    var t = e.target;
    var a = t && t.closest ? t.closest("a[href]") : null;
    if (!a) return;
    var u = urlOf(a);
    if (needsFullLoad(u)) prefetch(u);
  }
  document.addEventListener("mouseover", warm, { passive: true });
  document.addEventListener("touchstart", warm, { passive: true });
  document.addEventListener("focusin", warm, true);

  /* ---- 2. 淡出后跳转 ---- */
  document.addEventListener("click", function (e) {
    if (leaving || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    /* 带 data-adm 的是管理端 SPA 内部视图切换，不归这里管 */
    if (a.hasAttribute("data-adm")) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;

    var u = urlOf(a);
    if (!needsFullLoad(u)) return;
    if (norm(u.pathname) === norm(location.pathname) && !u.search) return;

    e.preventDefault();
    e.stopPropagation();

    leaving = true;
    prefetch(u);

    if (reduceMotion()) { location.href = u.href; return; }

    try { sessionStorage.setItem(NAV_KEY, "1"); } catch (err) {}

    document.documentElement.classList.add("pf-leaving");
    window.setTimeout(function () { location.href = u.href; }, LEAVE_MS);
  }, true);

  /* ---- 3. 进入时淡入 ---- */
  function enter() {
    var came = false;
    try {
      came = sessionStorage.getItem(NAV_KEY) === "1";
      sessionStorage.removeItem(NAV_KEY);
    } catch (e) {}
    if (!came) return;

    /* 有开场动画的页面由动画接管，不叠加淡入。
       静态首屏层在所有页面都存在，不能用它判断，只认 html.intro-on */
    if (document.documentElement.classList.contains("intro-on")) return;

    /* 只让中间内容区滑入。壁纸 .bg 与顶栏 .nav 是固定骨架，
       整页淡入会把它们一起带走，看起来像页面重开 */
    var main = document.querySelector("main");
    if (!main) return;
    main.classList.add("pf-entering");
    window.setTimeout(function () {
      main.classList.remove("pf-entering");
    }, 380);
  }

  /* 用户中途按浏览器返回时，清掉残留的淡出态 */
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      leaving = false;
      document.documentElement.classList.remove("pf-leaving");
    }
  });

  /* ---- 4. 空闲预热：把常用页拉进缓存 ---- */
  var WARM_TARGETS = ["/", "/admin/", "/manage/", "/theme/", "/manual/"];

  function warmAll() {
    WARM_TARGETS.forEach(function (p) {
      if (norm(p) === norm(location.pathname)) return;
      try { prefetch(new URL(p, location.origin)); } catch (e) {}
    });
  }

  function idle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 3000 });
    else window.setTimeout(fn, 1500);
  }

  function start() {
    enter();
    idle(warmAll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
