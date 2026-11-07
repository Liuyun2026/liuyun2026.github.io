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
 *
 * window.__VERCHECK__：向开场动画暴露自检结论。
 * 版本一致（或放弃重载）时 resolve；确认要重载时保持 pending，页面随即卸载。
 * 开场动画等这个 Promise 才启动时间轴，避免播到一半被重载后重播一次。
 * ========================================================================== */

(function () {
  "use strict";

  var local = window.__BUILD__;
  var NEVER = new Promise(function () {});

  if (!local || !window.fetch || !window.sessionStorage) {
    window.__VERCHECK__ = Promise.resolve(true);
    return;
  }

  /* 守卫：记「上次尝试重载的目标版本 + 时间」。
     20 秒内重复看到同一个目标版本视为重载没成功（CDN 未切换），放弃；
     超过 20 秒说明是用户手动又刷新了一次，应当允许再试——
     只记版本号不记时间的话，一次失败之后这一整个会话都不会再自动更新，
     表现就是「刷新好多下都不动，得等十分钟缓存过期」。 */
  var guardKey = "build-retry";
  var GUARD_MS = 20000;

  function guardAllows(remote) {
    try {
      var raw = sessionStorage.getItem(guardKey) || "";
      var parts = raw.split(":");
      if (parts[0] === remote && Date.now() - Number(parts[1] || 0) < GUARD_MS) return false;
      sessionStorage.setItem(guardKey, remote + ":" + Date.now());
      return true;
    } catch (e) {
      /* 写不进去就没有防循环能力，宁可不重载 */
      return false;
    }
  }

  /* 请求挂住时主动放弃自检：宁可看旧页面，也不能让片头播到一半再被重载 */
  var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 1500) : null;

  window.__VERCHECK__ = fetch("/content/build.json?t=" + Date.now(),
      { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
    .then(function (res) {
      if (!res.ok) throw new Error("build.json");
      return res.json();
    })
    .then(function (info) {
      if (timer) clearTimeout(timer);
      var remote = info && info.v;
      if (!remote || remote === local) return true;

      /* 同样的目标版本刚试过就不再试，避免刷新循环；
         隔了一段时间（用户手动再刷）则放行 */
      if (!guardAllows(remote)) return true;

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

      /* 页面即将卸载，时间轴不启动，静态首屏保持显示到新页面接手 */
      return NEVER;
    })
    .catch(function () {
      if (timer) clearTimeout(timer);
      return true;
    });
})();
