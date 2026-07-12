const en = {
  // Header
  "app.title": "ChatBI Agent",
  "app.subtitle": "Supply Chain Data Analyst · Natural Language to Data Reports",

  // Empty state
  "empty.title": "ChatBI — Supply Chain Analyst",
  "empty.hint": "Upload CSV/Excel data files, describe your analysis needs in natural language. I'll handle EDA, forecasting, inventory optimization, pricing strategy, and generate structured reports.",
  "empty.features": "Sandbox Python · Session Memory · Harness Framework · Auto Reports",

  // Chat input
  "chat.placeholder": "Upload data and describe your analysis...  ⏎ Send · Shift+⏎ Newline",
  "chat.hint": "ChatBI Agent · Claude Agent SDK + EdgeOne Makers + Harness Engineering",

  // Preset questions
  "preset.1": "Upload a CSV and run Exploratory Data Analysis (EDA)",
  "preset.2": "Forecast demand based on historical sales data",
  "preset.3": "Perform ABC/XYZ inventory classification",

  // Tool indicators
  "tool.commands": "Commands",
  "tool.files": "Files",
  "tool.codeRunner": "Code Runner",
  "tool.browser": "Browser",

  // Web search activity (in-bubble chip)
  "webSearch.error.wsaMissing": "Web search unavailable — needs a {0} API key",
  "webSearch.error.wsaCta": "Get a key",

  // Skill indicators
  "skill.sandboxAlgorithms": "Sandbox Algorithms",

  // Debug panel
  "debug.title": "Trace",
  "debug.events": "events",
  "debug.clear": "Clear",
  "debug.empty": "Waiting for SSE events...",
  "debug.emptyHint": "After sending a message, all raw backend data will be displayed here.",

  // Status & errors
  "status.error": "Request failed. Please check if the backend service is running.",
  "status.stopped": "⏹ *Generation stopped*",
  "status.backendError": "Backend abort request failed. The server may still be running.",

  // Language toggle
  "lang.switch": "中文",

  // Sidebar
  "sidebar.label": "Conversation list",
  "sidebar.title": "Chats",
  "sidebar.newChat": "New chat",
  "sidebar.loading": "Loading conversations...",
  "sidebar.loadMore": "Load more",
  "sidebar.loadingMore": "Loading...",
  "sidebar.emptyTitle": "No conversations yet",
  "sidebar.emptyHint": "Click \"New chat\" to start your first conversation.",
  "sidebar.delete": "Delete conversation",
  "sidebar.deleteConfirm": "Permanently delete this conversation? This cannot be undone.",

  // Aria labels (button hover/screen-reader)
  "aria.send": "Send",
  "aria.clearHistory": "Clear history",
  "aria.stopGeneration": "Stop generation",

  // ─── Floating bottom-right action badges ─────────────────────────────
  "floatingLink.deploy": "Deploy",
  "floatingLink.github": "GitHub",
} as const;

export default en;
