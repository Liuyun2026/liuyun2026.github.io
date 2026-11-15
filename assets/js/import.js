/* ============================================================================
 * import.js —— 把文档文件转成正文用的 Markdown
 *
 * 只做「抽文字」：.md / .txt / .docx / .pptx / .xlsx 稳定可用，.pdf 尽力而为。
 * 不引第三方库——docx/pptx/xlsx 本质是 zip + xml，浏览器自带
 * DecompressionStream 就能解，没必要为此挂一个几百 KB 的依赖。
 *
 * 对外只暴露一个入口：
 *   window.__docToMarkdown(file) -> Promise<{ markdown, note }>
 *   note 是给用户看的补充说明（比如「只取了第一个工作表」）。
 *
 * 已知边界：
 *   - 只取文字，图片、图表、批注、公式一律丢弃。
 *   - .doc / .ppt / .xls 是 97-2003 的二进制格式，不是 zip，这里不支持。
 *   - PDF 的文字提取看字体：用标准编码的能出字，内嵌中文 CID 字体的出不来，
 *     会明确提示改存为 docx。
 * ========================================================================== */

(function () {
  "use strict";

  var MAX_BYTES = 20 * 1024 * 1024;

  /* ---------- zip ---------- */

  function dvOf(buf) { return new DataView(buf); }
  function u16(dv, o) { return dv.getUint16(o, true); }
  function u32(dv, o) { return dv.getUint32(o, true); }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器不支持解压，无法读取 Office 文件（需较新的 Chrome / Edge / Safari）");
    }
    var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* 读 zip 中央目录，返回 路径 -> 解压后的字节 */
  async function unzip(buf) {
    var dv = dvOf(buf);
    var eocd = -1;
    for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
      if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是有效的 Office 文件（找不到 zip 目录）");

    var count = u16(dv, eocd + 10);
    var off = u32(dv, eocd + 16);
    var out = new Map();

    for (var n = 0; n < count; n++) {
      if (u32(dv, off) !== 0x02014b50) break;
      var method = u16(dv, off + 10);
      var csize = u32(dv, off + 20);
      var nameLen = u16(dv, off + 28);
      var extraLen = u16(dv, off + 30);
      var commentLen = u16(dv, off + 32);
      var lho = u32(dv, off + 42);
      var name = new TextDecoder("utf-8").decode(new Uint8Array(buf, off + 46, nameLen));
      off += 46 + nameLen + extraLen + commentLen;

      if (u32(dv, lho) !== 0x04034b50) continue;
      var lNameLen = u16(dv, lho + 26);
      var lExtraLen = u16(dv, lho + 28);
      var start = lho + 30 + lNameLen + lExtraLen;
      var raw = new Uint8Array(buf, start, csize);

      if (method === 0) out.set(name, raw);
      else if (method === 8) out.set(name, await inflateRaw(raw));
      /* 其它压缩方式（zip64 / bzip2）在 Office 文件里不会出现，直接跳过 */
    }
    return out;
  }

  function xmlOf(u8) {
    var s = new TextDecoder("utf-8").decode(u8);
    var doc = new DOMParser().parseFromString(s, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("文档内部结构损坏，读不出来");
    return doc;
  }

  function all(root, tag) { return Array.prototype.slice.call(root.getElementsByTagName(tag)); }

  /* ---------- 通用清洗 ---------- */

  function tidy(md) {
    return md
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      .trim();
  }

  /* ---------- .docx ---------- */

  /* 段落文字：按顺序取 w:t，遇到 w:br / w:cr 换行、w:tab 补空格 */
  function paraText(node) {
    var buf = "";
    (function walk(el) {
      for (var i = 0; i < el.childNodes.length; i++) {
        var c = el.childNodes[i];
        if (c.nodeType !== 1) continue;
        var tag = c.tagName;
        if (tag === "w:t") buf += c.textContent;
        else if (tag === "w:br" || tag === "w:cr") buf += "\n";
        else if (tag === "w:tab") buf += "  ";
        else walk(c);
      }
    })(node);
    return buf;
  }

  function tblToMd(tbl) {
    var rows = all(tbl, "w:tr").map(function (tr) {
      return all(tr, "w:tc").map(function (tc) {
        return paraText(tc).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
      });
    }).filter(function (r) { return r.length; });
    if (!rows.length) return [];
    var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    rows = rows.map(function (r) {
      while (r.length < cols) r.push("");
      return r;
    });
    var out = ["| " + rows[0].join(" | ") + " |", "|" + new Array(cols + 1).join("---|")];
    for (var i = 1; i < rows.length; i++) out.push("| " + rows[i].join(" | ") + " |");
    return out;
  }

  async function docx(file) {
    var zip = await unzip(await file.arrayBuffer());
    var doc = zip.get("word/document.xml");
    if (!doc) throw new Error("这个 docx 里没有 word/document.xml");

    var body = all(xmlOf(doc), "w:body")[0];
    if (!body) return { markdown: "", note: "文档是空的" };

    var lines = [];
    Array.prototype.forEach.call(body.childNodes, function (node) {
      if (node.nodeType !== 1) return;
      if (node.tagName === "w:p") {
        var txt = paraText(node).trim();
        if (!txt) { lines.push(""); return; }
        var pStyle = all(node, "w:pStyle")[0];
        var style = pStyle ? (pStyle.getAttribute("w:val") || "") : "";
        var hm = /^(?:Heading|标题)\s*([1-6])$/i.exec(style);
        var isList = all(node, "w:numPr").length > 0;
        if (hm) lines.push(new Array(+hm[1] + 1).join("#") + " " + txt);
        else if (isList) lines.push("- " + txt);
        else lines.push(txt);
      } else if (node.tagName === "w:tbl") {
        lines.push("", ...tblToMd(node), "");
      }
    });

    return { markdown: tidy(lines.join("\n")), note: "" };
  }

  /* ---------- .pptx ---------- */

  async function pptx(file) {
    var zip = await unzip(await file.arrayBuffer());
    var slides = Array.from(zip.keys())
      .filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
      .sort(function (a, b) { return (+a.match(/(\d+)/)[1]) - (+b.match(/(\d+)/)[1]); });
    if (!slides.length) throw new Error("这个 pptx 里没有幻灯片");

    var out = [];
    slides.forEach(function (name, idx) {
      var doc = xmlOf(zip.get(name));
      out.push("## 第 " + (idx + 1) + " 页");
      var shapes = all(doc, "p:sp");
      var first = true;
      shapes.forEach(function (sp) {
        var texts = all(sp, "a:t").map(function (t) { return t.textContent.trim(); })
          .filter(function (s) { return s; });
        if (!texts.length) return;
        if (first) {
          out.push("### " + texts[0]);
          for (var i = 1; i < texts.length; i++) out.push("- " + texts[i]);
          first = false;
        } else {
          texts.forEach(function (t) { out.push("- " + t); });
        }
      });
      out.push("");
    });

    return { markdown: tidy(out.join("\n")), note: "" };
  }

  /* ---------- .xlsx ---------- */

  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || "");
    if (!m) return -1;
    var n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  async function xlsx(file) {
    var zip = await unzip(await file.arrayBuffer());

    var shared = [];
    var ss = zip.get("xl/sharedStrings.xml");
    if (ss) {
      all(xmlOf(ss), "si").forEach(function (si) {
        shared.push(all(si, "t").map(function (t) { return t.textContent; }).join(""));
      });
    }

    var sheets = Array.from(zip.keys())
      .filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
      .sort(function (a, b) { return (+a.match(/(\d+)/)[1]) - (+b.match(/(\d+)/)[1]); });
    if (!sheets.length) throw new Error("这个 xlsx 里没有工作表");

    var out = [];
    sheets.forEach(function (name, si2) {
      var doc = xmlOf(zip.get(name));
      var grid = [];
      var maxCol = 0;

      all(doc, "row").forEach(function (row) {
        var r = +row.getAttribute("r") - 1;
        if (!(r >= 0)) r = grid.length;
        var cells = [];
        all(row, "c").forEach(function (c) {
          var ci = colIndex(c.getAttribute("r"));
          if (ci < 0) ci = cells.length;
          var v = all(c, "v")[0];
          var val = "";
          if (c.getAttribute("t") === "s") val = v ? (shared[+v.textContent] || "") : "";
          else if (c.getAttribute("t") === "inlineStr") {
            val = all(c, "t").map(function (t) { return t.textContent; }).join("");
          } else val = v ? v.textContent : "";
          cells[ci] = String(val).replace(/\|/g, "\\|").trim();
          if (ci + 1 > maxCol) maxCol = ci + 1;
        });
        grid[r] = cells;
      });

      var rows = [];
      for (var r = 0; r < grid.length; r++) {
        if (!grid[r]) continue;
        var line = [];
        for (var c = 0; c < maxCol; c++) line.push(grid[r][c] || "");
        if (line.join("").trim()) rows.push(line);
      }
      if (!rows.length) return;

      if (sheets.length > 1) out.push("### 工作表 " + (si2 + 1));
      out.push("| " + rows[0].join(" | ") + " |", "|" + new Array(maxCol + 1).join("---|"));
      for (var i = 1; i < rows.length; i++) out.push("| " + rows[i].join(" | ") + " |");
      out.push("");
    });

    return {
      markdown: tidy(out.join("\n")),
      note: sheets.length > 1 ? "已导出全部 " + sheets.length + " 个工作表" : ""
    };
  }

  /* ---------- .pdf（尽力而为） ---------- */

  /* 解 FlateDecode 流，扫 Tj / TJ 里的字符串。字体是标准编码时能出字，
     内嵌中文 CID 字体的抽不出来——那种只能另存为 docx。 */
  async function pdf(file) {
    var bytes = new Uint8Array(await file.arrayBuffer());
    var latin = new TextDecoder("latin1").decode(bytes);
    var chunks = [];
    var idx = 0;

    while (true) {
      var s = latin.indexOf("stream", idx);
      if (s < 0) break;
      var dataStart = s + 6;
      if (latin.substr(dataStart, 2) === "\r\n") dataStart += 2;
      else if (/[\r\n]/.test(latin[dataStart])) dataStart += 1;
      var e = latin.indexOf("endstream", dataStart);
      if (e < 0) break;
      var slice = bytes.subarray(dataStart, e);
      /* 流的字典在 stream 关键字前面一点，看有没有 FlateDecode 决定要不要解压 */
      var dict = latin.slice(Math.max(0, s - 300), s);
      idx = e + 9;
      if (/\/FlateDecode/.test(dict)) {
        try {
          chunks.push(new TextDecoder("latin1").decode(await inflateRaw(slice)));
        } catch (err) { /* 解不开就跳过 */ }
      } else if (!/\/Filter/.test(dict)) {
        chunks.push(new TextDecoder("latin1").decode(slice));
      }
    }

    var text = [];
    chunks.forEach(function (c) {
      var re = /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:[^\[\]]|\\.)*\]\s*TJ|\bT\*|\bTd\b|\bTD\b|\bET\b/g;
      var m;
      while ((m = re.exec(c))) {
        var tok = m[0];
        if (/T\*|Td|TD|ET/.test(tok)) { text.push("\n"); continue; }
        var inner = tok.match(/\((?:\\.|[^\\)])*\)/g) || [];
        inner.forEach(function (p) {
          text.push(p.slice(1, -1)
            .replace(/\\([nrt])/g, function (_, ch) { return ch === "n" ? "\n" : ch === "r" ? "" : "  "; })
            .replace(/\\([()\\])/g, "$1"));
        });
      }
      text.push("\n");
    });

    var raw = text.join("").replace(/[ \t]+/g, " ");
    var printable = raw.replace(/[^\x20-\x7E\u4e00-\u9fa5]/g, "").length;
    if (!raw.trim() || printable / Math.max(1, raw.length) < 0.5) {
      throw new Error("这份 PDF 的文字抽不出来（多数字体是内嵌子集的），先另存为 docx 再导入");
    }
    return {
      markdown: tidy(raw.replace(/\n{2,}/g, "\n")),
      note: "PDF 只按文本流提取，段落顺序和表格可能错乱，导入后需要校对"
    };
  }

  /* ---------- 入口 ---------- */

  window.__docToMarkdown = function (file) {
    if (!file) return Promise.reject(new Error("没有选文件"));
    if (file.size > MAX_BYTES) {
      return Promise.reject(new Error("文件超过 20MB，先精简一下再导入"));
    }
    var name = String(file.name || "").toLowerCase();
    var ext = (name.match(/\.([a-z0-9]+)$/) || [])[1] || "";

    if (ext === "md" || ext === "markdown" || ext === "txt") {
      return file.text().then(function (t) {
        return { markdown: tidy(t), note: "" };
      });
    }
    if (ext === "docx") return docx(file);
    if (ext === "pptx") return pptx(file);
    if (ext === "xlsx") return xlsx(file);
    if (ext === "pdf") return pdf(file);
    if (ext === "doc" || ext === "ppt" || ext === "xls") {
      return Promise.reject(new Error("不支持 97-2003 的 ." + ext + "，请另存为 ." + ext + "x"));
    }
    return Promise.reject(new Error("不支持 ." + ext + "，可导入 md / txt / docx / pptx / xlsx / pdf"));
  };
})();
