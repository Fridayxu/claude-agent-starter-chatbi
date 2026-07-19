const zh = {
  // Header
  "app.title": "ChatBI",
  "app.subtitle": "自然语言 → 数据分析 → 自动报表",

  // Empty state
  "empty.title": "ChatBI — 数据智能报表助手",
  "empty.hint": "上传 Excel/CSV 数据，用自然语言描述你要的分析。自动完成：数据清洗 → 探索分析 → 图表看板 → 报表导出。不再手动做表。",
  "empty.features": "自然语言驱动 · 自动报表生成 · 多格式导出 · Harness方法论",

  // Chat input
  "chat.placeholder": "上传数据，告诉我你想分析什么…  ⏎ 发送 · Shift+⏎ 换行",
  "chat.hint": "ChatBI · 自然语言 → 数据报表 · Powered by EdgeOne Makers + Harness",

  // Preset questions
  "preset.1": "上传数据并生成分析看板（HTML图表）",
  "preset.2": "分析数据趋势并导出Excel报表",
  "preset.3": "对比不同维度的数据并给出结论",

  // Tool indicators
  "tool.commands": "终端命令",
  "tool.files": "文件操作",
  "tool.codeRunner": "代码解释器",
  "tool.browser": "浏览器",

  // Web search activity (in-bubble chip)
  "webSearch.error.wsaMissing": "搜索不可用，需配置 {0} API Key",
  "webSearch.error.wsaCta": "获取 Key",

  // Skill indicators
  "skill.sandboxAlgorithms": "沙箱算法执行",

  // Debug panel
  "debug.title": "传输流",
  "debug.events": "事件",
  "debug.clear": "清除",
  "debug.empty": "等待 SSE 事件...",
  "debug.emptyHint": "发送消息后，所有原始后端数据将在此处显示。",

  // Status & errors
  "status.error": "⚠️ 请求失败，请检查后端服务是否启动。",
  "status.stopped": "⏹ *已停止生成*",
  "status.backendError": "⚠️ 后端中断请求失败，服务端可能仍在运行。",

  // Language toggle
  "lang.switch": "English",

  // Sidebar
  "sidebar.label": "会话列表",
  "sidebar.title": "会话",
  "sidebar.newChat": "新建聊天",
  "sidebar.loading": "正在加载会话...",
  "sidebar.loadMore": "加载更多",
  "sidebar.loadingMore": "加载中...",
  "sidebar.emptyTitle": "暂无会话",
  "sidebar.emptyHint": "点击「新建聊天」开始第一段对话。",
  "sidebar.delete": "删除会话",
  "sidebar.deleteConfirm": "确定要永久删除这个会话吗？此操作不可恢复。",

  // Aria labels (button hover/screen-reader)
  "aria.send": "发送",
  "aria.clearHistory": "清除历史",
  "aria.stopGeneration": "停止生成",

  // ─── Floating bottom-right action badges ─────────────────────────────
  "floatingLink.deploy": "一键部署",
  "floatingLink.github": "GitHub",
} as const;

export default zh;
