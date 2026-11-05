/* ============================================================================
 * data.js —— 站点全部内容的唯一数据源
 *
 * 新增项目：往 SITE.projects 数组里追加一个对象
 * 新增笔记：往 SITE.notes 里追加，body 为数组，每项一行，用 .join 拼接
 * 新增资料：文件放进 assets/files/，然后在 SITE.files 里加一条，
 *           path 写 "assets/files/文件名"，或改用 url 指向外部链接
 *
 * 字段说明见每个对象的注释。改完刷新页面即可，无需构建。
 * ========================================================================== */

const SITE = {

  /* ---- 站点基本信息 ---- */
  meta: {
    name: "流雲",
    handle: "Liuyun2026",
    tagline: "硬件工程师 · 电源变换 / 高速数字 / 板级集成",
    intro:
      "做板子的。从电源树到 Bank 引脚、从网表核对到手册翻译，习惯把每个数值追到数据手册的原文和页码上再落笔。",
    /* 填入邮箱后页脚自动出现邮件入口；留空则只显示 GitHub */
    email: "",
    github: "https://github.com/Liuyun2026",
    location: "中国 · 山西 · 太原",
    org: "中北大学",
    /* 首页右上角状态点后的文字 */
    status: "在做 Zynq-7020 三合一板",
    year: new Date().getFullYear()
  },

  /* ---- 首页规格卡（模仿器件手册首页的键值区） ---- */
  spec: [
    ["ROLE", "硬件工程师"],
    ["ORG", "中北大学"],
    ["LOC", "中国 · 山西 · 太原"],
    ["FOCUS", "电源变换 / 高速数字"],
    ["EDA", "嘉立创 EDA · KiCad"],
    ["LANG", "Python · C · 技术文档"],
    ["STATE", "Zynq-7020 设计中"]
  ],

  /* ---- 技能分组 ---- */
  skills: [
    {
      group: "电源",
      items: ["同步 Buck / Boost 拓扑", "环路补偿与稳定性", "限流与软启动设计", "热设计与损耗核算", "电池组充电策略"]
    },
    {
      group: "数字与接口",
      items: ["DDR3 布线基础", "RGMII / 千兆以太网", "SDIO / eMMC", "QSPI Flash", "USB 转串口"]
    },
    {
      group: "板级与工艺",
      items: ["原理图设计", "电源树规划", "叠层与阻抗", "可调试性设计（测试点优先）"]
    },
    {
      group: "工具链",
      items: ["嘉立创 EDA", "KiCad", "Python 脚本化校验", "示波器 / 电子负载 / 直流源"]
    },
    {
      group: "调试与验证",
      items: ["网表全量核对", "参数极限复核", "上电时序与保护验证", "故障定位与复现"]
    },
    {
      group: "文档",
      items: ["技术手册中英对照翻译", "双语排版与术语统一", "设计说明撰写"]
    }
  ],

  /* ---- 项目 ----
   * id       路由与锚点用，唯一
   * category 用于项目页筛选：硬件 / 软件 / 文档
   * status   自由文本，页面按关键词着色
   * specs    [[名称, 值], ...] 渲染成参数表
   */
  projects: [
    {
      id: "zynq7020",
      title: "Zynq-7020 三合一硬件平台",
      subtitle: "XC7Z020-CLG400 · PS + PL + 模拟前端一体板",
      category: "硬件",
      status: "进行中",
      year: "2026",
      featured: true,
      summary:
        "把处理系统、可编程逻辑和高速模拟前端压到一张板上：DDR3、eMMC、QSPI、千兆以太网、14 位 ADC 与高速 DAC，配一条从 12 V 起算的完整电源树。",
      specs: [
        ["主控", "XC7Z020-2CLG400"],
        ["PS Bank", "500 / 501 / 502"],
        ["PL Bank", "0 / 13 / 34 / 35"],
        ["存储", "DDR3 · QSPI Flash · eMMC KLM8G1GETF-B041"],
        ["模拟前端", "AD9251（14 位 ADC）· DAC904E"],
        ["以太网", "RTL8211E-VL · RGMII"],
        ["时钟", "YXC YSO1 33.3333 MHz 有源晶振"],
        ["输入", "12 V DC"],
        ["电源树", "2×SY8368（12V→5V）+ 4×TPS62A06（1V0 / 1V8 / 1V5 / 3V3）"],
        ["EDA", "嘉立创 EDA"]
      ],
      tags: ["Zynq-7000", "DDR3", "RGMII", "eMMC", "电源树", "嘉立创 EDA"],
      links: []
    },
    {
      id: "tps40057",
      title: "TPS40057 同步降压充电级",
      subtitle: "12 V → 7.5 V / 10 A（峰值 15 A）· 3S5P 锂电",
      category: "硬件",
      status: "参数固化",
      year: "2026",
      featured: true,
      summary:
        "面向 3S5P 电池组的恒压充电级。重点不在「能出 7.5 V」，而在于把开关频率、电感量、限流点、软启动、UVLO 锁到一组可复现的数值上，并逐项用数据手册原文复核。",
      specs: [
        ["控制器", "TPS40057"],
        ["开关频率", "302 kHz（R_T = 59 kΩ，f_SW = 17820 / R_T）"],
        ["输出", "7.5 V / 10 A 连续，15 A 限流"],
        ["分压网络", "R1 = 97.6 kΩ / R2 = 10 kΩ → 7.53 V"],
        ["电感", "3.3 µH，I_sat ≥ 15 A"],
        ["纹波电流", "ΔI ≈ 2.84 A（约 28% I_OUT）"],
        ["限流设定", "R_ILIM = 6.34 kΩ → 15 A"],
        ["软启动", "C_SS = 33 nF C0G"],
        ["UVLO", "≈ 10 V"],
        ["功率管", "BSC030N08NS5（R_DS(on) = 3 mΩ）"]
      ],
      tags: ["TPS40057", "同步 Buck", "锂电充电", "环路补偿"],
      links: []
    },
    {
      id: "importer",
      title: "component-standardized-importer",
      subtitle: "KiCad / 嘉立创元件库标准化导入工具",
      category: "软件",
      status: "开源",
      year: "2026",
      featured: true,
      summary:
        "KiCad 自带库覆盖不全，嘉立创上的器件在库里找不到，只能一个个手工导入；时间一长，命名和字段全乱。这个工具把导入、命名、字段标准化串成一条流程，开源。",
      specs: [
        ["语言", "Python"],
        ["解决的问题", "库缺失 · 元件找不到 · 命名不统一 · 字段混乱"],
        ["许可", "开源，禁止商用"]
      ],
      tags: ["Python", "KiCad", "嘉立创 EDA", "EDA 工具链"],
      links: [{ label: "GitHub 仓库", url: "https://github.com/Liuyun2026/component-standardized-importer" }]
    },
    {
      id: "trm",
      title: "Zynq-7000 TRM 中英对照",
      subtitle: "UG585 · 1800+ 页双语排版",
      category: "文档",
      status: "进行中",
      year: "2026",
      summary:
        "把 Zynq-7000 技术参考手册做成中英对照 PDF：保留原始排版、图表不重排、术语统一、不留大片空白。目的是查寄存器和时序时不必在两个窗口之间来回切。",
      specs: [
        ["原文", "AMD / Xilinx UG585 · Zynq-7000 SoC TRM"],
        ["规模", "1800+ 页"],
        ["版式", "中英对照，保留原始图表位置"],
        ["要求", "不漏译 · 术语一致 · 无大片留白"]
      ],
      tags: ["UG585", "技术翻译", "PDF 排版"],
      links: []
    },
    {
      id: "netcheck",
      title: "net_check.py 网表核对",
      subtitle: "导出即全量重解析的网名级校验",
      category: "软件",
      status: "日常在用",
      year: "2026",
      featured: true,
      summary:
        "配合「画一块、问一块」的节奏：每次原理图导出后全量重跑，核对 Bank 引脚状态、电源树连接与网络命名，不允许拿上一版快照的结论顶替。",
      specs: [
        ["输入", "KiCad / 嘉立创 EDA 导出的网表"],
        ["输出", "网络名级差异 · Bank 引脚状态表 · 电源树核对"],
        ["原则", "每次全量重解析，不读旧快照"]
      ],
      tags: ["Python", "网表", "校验流程"],
      links: []
    }
  ],

  /* ---- 笔记 ----
   * body 为字符串数组，逐行拼接；支持 ## 标题、- 列表、> 引用、代码围栏
   * 行内支持 `code`、**加粗**、[文字](链接)
   * draft: true 的条目不渲染到页面，可用来存格式模板
   */
  notes: [
    {
      id: "rt-302k",
      title: "TPS40057 的频率不是「标称」出来的：R_T = 59 kΩ 对应 302 kHz",
      date: "2026",
      tags: ["TPS40057", "参数计算"],
      summary:
        "手册里的 1.56 MHz 是最短导通时间约束下的上限，不是 R_T 能设到的值。把两者混为一谈，电感会按 3~5 倍偏小去选。",
      body: [
        "## 结论",
        "",
        "f_SW = 17820 / R_T(kΩ)。R_T 取 59 kΩ 时 f_SW ≈ 302 kHz，这是一个能稳定工作的设置点，不是极限值。",
        "",
        "## 容易踩的坑",
        "",
        "手册里 1.56 MHz 那一栏描述的是**最短导通时间**所允许的最高开关频率，用途是校验在当前输入输出比下占空比是否做得出来，不是 R_T 的可设范围。拿它当设计目标，电感会按 3~5 倍偏小计算，纹波和开关损耗一起跑偏。",
        "",
        "## 一串联动的数",
        "",
        "```",
        "f_SW = 17820 / R_T = 17820 / 59 ≈ 302 kHz",
        "D    = V_OUT / V_IN = 7.5 / 12 = 0.625",
        "ΔI   = (V_IN - V_OUT) × D / (f_SW × L)",
        "     = 4.5 × 0.625 / (302k × 3.3µ) ≈ 2.84 A",
        "```",
        "",
        "ΔI ≈ 2.84 A，对 10 A 连续输出约 28%，落在纹波取 30% I_OUT 的常规区间内。",
        "",
        "## 锁定的那组值",
        "",
        "- 分压：R1 = 97.6 kΩ / R2 = 10 kΩ → 7.53 V",
        "- 电感：3.3 µH，I_sat ≥ 15 A",
        "- 限流：R_ILIM = 6.34 kΩ → 15 A（内部 10 µA 电流源）",
        "- 软启动：C_SS = 33 nF C0G",
        "- UVLO：≈ 10 V",
        "",
        "> 校验口径：只认数据手册的 Recommended Operating Conditions 与 Absolute Maximum Ratings。功能章节里的「标称档位」不能当上限用。"
      ]
    },
    {
      id: "rtl8211e-1v8",
      title: "RTL8211E-VL 的 DVDD33 接 1.8 V，算不算超规格",
      date: "2026",
      tags: ["RTL8211E", "电平兼容", "查手册"],
      summary:
        "标称 1.5 V RGMII 不等于上限 1.5 V。参数表给的是 1.43~1.9 V，1.8 V 平台完全合规。",
      body: [
        "## 原始数据",
        "",
        "- p62 Table 50（Absolute Maximum Ratings）：DVDD33 绝对最大 2.0 V",
        "- p62 Table 51 / p64 Table 54（Recommended Operating Conditions）：1.43 V ~ 1.9 V",
        "",
        "## 判断过程",
        "",
        "手册功能章节写的是 1.5 V 标称 RGMII，全文没有出现过「1.8 V」字样。但参数表把推荐工作范围写到了 1.43 ~ 1.9 V，绝对最大到 2.0 V——上限留到 1.9 V，正是给 1.8 V 平台（例如 Zynq MIO Bank1）留的余量。",
        "",
        "## 结论",
        "",
        "1.8 V 落在推荐工作范围之内，属于合规使用，既不超推荐范围也不超绝对最大额定。",
        "",
        "> 「supports 1.5 V signaling」这类功能描述不等于「上限 1.5 V」。判规格只认参数表。",
        "",
        "这条也是自我提醒：先看参数表，再谈开源的板子画得规不规范。"
      ]
    },
    {
      id: "no-snapshot",
      title: "网表核对该全量重跑，不该沿用上一版结论",
      date: "2026",
      tags: ["流程", "KiCad"],
      summary:
        "渐进式画图时每块原理图都会动到共享网络，旧快照里的「已确认」在新网表里可能已经失效。",
      body: [
        "## 问题",
        "",
        "边画边问的做法会让核对结论带有时间戳：上一轮确认过的 Bank 引脚，可能因为新加的一路上拉或电源改接而失效。直接引用旧结论，等于在旧图上做新判断。",
        "",
        "## 做法",
        "",
        "- 每次导出网表后全量解析，逐项重新判定，不读旧快照",
        "- 先比对文件指纹（网表 md5），有变化才重跑，避免无谓计算",
        "- 同时检查原理图源文件有没有比网表更新的保存记录",
        "- 输出落到网络名一级，不用「大致接对了」这种结论",
        "",
        "## 代价与收益",
        "",
        "单次多花几分钟，换掉的是「改了一处、错在另一处」这类最难查的故障。"
      ]
    },
    {
      id: "note-template",
      draft: true,
      title: "（模板）新增笔记从这里复制",
      date: "",
      tags: ["模板"],
      summary:
        "这一条是格式示例，复制到 data.js 的 notes 数组里改掉 id、title、body 即可，写完把本条删除。",
      body: [
        "## 小节标题",
        "",
        "正文段落。段内可以写 `行内代码`、**加粗**，以及 [外链](https://example.com)。",
        "",
        "## 列表与代码",
        "",
        "- 列表项一",
        "- 列表项二",
        "",
        "```",
        "代码块直接写，注意 body 是字符串数组，每行一个元素",
        "```",
        "",
        "> 引用用于放结论或校验口径。"
      ]
    }
  ],

  /* ---- 资料 ----
   * kind 用于筛选：datasheet / manual / tool / image / other
   * path 指向 assets/files/ 下的本地文件；url 指向外部链接，二选一
   * size 可选，手写或留空
   */
  files: [
    {
      name: "TPS40057 产品页与数据手册",
      kind: "datasheet",
      note: "TI 官方页面，数据手册、封装、工具都在这里",
      url: "https://www.ti.com/product/TPS40057",
      size: ""
    },
    {
      name: "component-standardized-importer 源码",
      kind: "tool",
      note: "元件库标准化导入工具，Python",
      url: "https://github.com/Liuyun2026/component-standardized-importer",
      size: ""
    }
  ]
};
