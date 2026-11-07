/* ============================================================================
 * vercheck.js —— 页面版本自检
 *
 * 背景：GitHub Pages 给 HTML 的 Cache-Control 是 max-age=600，改完发布后
 * 浏览器最长十分钟仍展示旧 HTML，出现「明明改了却没变」的错觉。
 *
 * 做法：页面 head 里写入自身构建号 window.__BUILD__，本脚本用带时间戳的
 * 请求取最新的 content/build.json 比对；不一致说明手里是旧 HTML，带上
 * 新构建号重新加载（新 URL 无缓存，必然拿到最新页面）。
 * sessionStorage 记录已重载过的构建号，避免部署中间态造成刷新循环。
 * ========================================================================== */

(function () {
  "use strict";

  var local = window.__BUILD__;
  if (!local || !window.fetch || !window.sessionStorage) return;

  /* 已经被同一次部署重载过，说明服务端还没切换完，本轮直接放弃 */
  var guardKey = "build-reloaded";
  if (sessionStorage.getItem(guardKey) === local) return;

  fetch("/content/build.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("build.json");
      return res.json();
    })
    .then(function (info) {
      var remote = info && info.v;
      if (!remote || remote === local) return;

      sessionStorage.setItem(guardKey, remote);
      var next = location.pathname + "?v=" + remote;
      if (location.search && location.search.length > 1) {
        next = location.pathname + location.search.replace(/([?&])v=[^&]*/, "$1v=" + remote);
      }
      location.replace(next);
    })
    .catch(function () {});
})();
