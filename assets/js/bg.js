/* ============================================================================
 * bg.js —— 壁纸层唯一的实现
 *
 * 三个地方共用：访客端 index.html、手册页、管理端三页。用法 window.__bgPaint(url)。
 *
 * 为什么必须「解码完再挂地址」：把地址写死进 CSS、或拿到地址就立刻赋值的话，
 * 图片还在下载时浏览器会从上往下一段段往画布上填，看上去就是
 * 「上半张出来了、下面没有」。等 decode() 完成再一次挂上去、再一次淡入，
 * 中途不会出现半张图。
 *
 * .bg 默认 opacity: 0，只有调过本函数才会加上 .bg-on 显形。
 * 所以每个页面启动时都必须至少调一次，否则整页没有背景。
 * ========================================================================== */

(function () {
  "use strict";

  window.__bgPaint = function (url) {
    var bg = document.querySelector(".bg");
    if (!bg || !url) return;

    var show = function () {
      bg.style.backgroundImage = 'url("' + url + '")';
      bg.classList.add("bg-on");
    };

    var img = new Image();
    img.decoding = "async";
    img.onload = function () {
      if (img.decode) img.decode().then(show, show);
      else show();
    };
    img.onerror = show;
    img.src = url;
  };
})();
