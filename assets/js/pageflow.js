/* ============================================================================
 * pageflow.js —— 跨页面（整页跳转）过渡
 *
 * 背景：项目 / 笔记 / 资料在同一 SPA 内切换，有过渡动画；而管理端主页、内容、
 * 壁纸、手册是独立页面，只能整页加载，点下去会先白屏再出现，观感明显卡顿。
 *
 * 做法（三级配合，全部为原生能力，无框架）：
 *   1. 预取   鼠标移入 / 触摸按下时，对目标页插入 <link rel=prefetch>，
 *             点击时 HTML 已在缓存里，省掉网络往返
 *   2. 淡出   点击时先让当前页淡出 150ms，再去跳转，避免瞬间白屏
 *   3. 淡入   新页加载后淡入 220ms，衔接成"淡出 → 淡入"的一次过渡
 *
 * 监听使用 capture 阶段，先于各页自身脚本的冒泡监听，
 * 需要整页跳转的链接由这里接管，SPA 内部路由仍由 app.js 处理。
 * ========================================================================== */

(function () {
  "use strict";

  var LEAVE_MS = 150;
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

  /* 访客端 SPA 存在 #view 容器；它自己会处理 /、/projects 等路由 */
  function isGuestSpa() {
    return !!document.getElementById("view");
  }

  function urlOf(a) {
    try { return new URL(a.getAttribute("href"), location.href); } catch (e) { return null; }
  }

  /* 这个地址是否必须整页跳转 */
  function needsFullLoad(u) {
    if (!u || u.origin !== location.origin) return false;

    /* 管理端主页、内容、壁纸、手册永远是独立页 */
    if (isStandalone(u.pathname)) return true;

    /* 当前页不是访客 SPA 时，任何站内跳转都是整页加载，一律接管 */
    if (!isGuestSpa()) return true;

    /* 访客 SPA 内部的 /、/projects 等交给 app.js 的过渡动画 */
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

  /* ---- 1. 预取：悬停 / 触摸即预热 ---- */
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
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;

    var u = urlOf(a);
    if (!needsFullLoad(u)) return;
    if (norm(u.pathname) === norm(location.pathname) && !u.search) return;

    e.preventDefault();
    e.stopPropagation();

    leaving = true;
    prefetch(u);

    try { sessionStorage.setItem(NAV_KEY, "1"); } catch (err) {}

    var go = function () { location.href = u.href; };

    if (reduceMotion()) { go(); return; }

    document.documentElement.classList.add("pf-leaving");
    window.setTimeout(go, LEAVE_MS);
  }, true);

  /* ---- 3. 进入时淡入 ---- */
  function enter() {
    var came = false;
    try {
      came = sessionStorage.getItem(NAV_KEY) === "1";
      sessionStorage.removeItem(NAV_KEY);
    } catch (e) {}
    if (!came) return;

    /* 有开场动画的页面（访客首页、管理端主页）由动画接管，不再叠加淡入 */
    if (document.querySelector(".intro-layer")) return;
    if (document.documentElement.classList.contains("intro-on")) return;

    document.body.classList.add("pf-entering");
    window.setTimeout(function () {
      document.body.classList.remove("pf-entering");
    }, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enter);
  } else {
    enter();
  }

  /* 用户中途按浏览器返回时，清掉残留的淡出态 */
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      leaving = false;
      document.documentElement.classList.remove("pf-leaving");
    }
  });
})();
