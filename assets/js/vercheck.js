/* ============================================================================
 * vercheck.js —— 页面版本自检
 *
 * 背景：GitHub Pages 给 HTML 的 Cache-Control 是 max-age=600，改完发布后
 * 浏览器最长十分钟仍展示旧 HTML，出现「明明改了却没变」的错觉。
 *
 * 做法：页面 head 里写入自身构建号 window.__BUILD__，本脚本用带时间戳的
 * 请求取最新的 content/build.json 比对；不一致说明手里是旧 HTML，带上
 * 新构建号重新加载（新 URL 无缓存，应能拿到最新页面）。
 *
 * 防循环关键：同一目标版本只允许自动重载一次。
 * 守卫值记的是「重载目标版本」，发现 build.json 与本地不一致时，
 * 若守卫值已等于目标版本，说明上一次重载也没能拿到新版（CDN 未切换等），
 * 本轮直接放弃，绝不循环。
 * ========================================================================== */

(function () {
  "use strict";

  var local = window.__BUILD__;
  if (!local || !window.fetch || !window.sessionStorage) return;

  var guardKey = "build-reloaded";

  fetch("/content/build.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("build.json");
      return res.json();
    })
    .then(function (info) {
      var remote = info && info.v;
      if (!remote || remote === local) return;

      try {
        /* 这个目标版本已经试过一次仍拿不到，放弃，避免刷新循环 */
        if (sessionStorage.getItem(guardKey) === remote) return;
        sessionStorage.setItem(guardKey, remote);
      } catch (e) {}

      /* 保留原有查询参数（如 from=admin），只替换或追加 v 作为缓存破坏符 */
      var params = [];
      var raw = location.search.replace(/^\?/, "");
      if (raw) {
        params = raw.split("&").filter(function (kv) {
          return kv && kv.indexOf("v=") !== 0;
        });
      }
      params.push("v=" + remote);
      location.replace(location.pathname + "?" + params.join("&"));
    })
    .catch(function () {});
})();
