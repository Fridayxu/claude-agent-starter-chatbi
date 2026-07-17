---
name: chatbi-analysis
description: Supply chain data analysis — EDA, forecasting, ABC/XYZ, inventory, pricing, data cleaning, dashboard generation
---

# ChatBI Analysis Skill

Activate for ANY supply chain data analysis task. This skill defines the standard analysis pipeline with intelligent routing.

## Orchestration (Route First, Then Execute)

When a user request arrives, classify intent before executing:

| User Intent | Trigger Words | Route |
|-------------|--------------|-------|
| **Data Cleaning** | "清洗", "去重", "格式不对", "数据很乱", "脏数据", "clean" | → Step 0: Data Cleaning |
| **Quick Look** | "看看", "概况", "有多少行", "有哪些列" | → Step 1: Quick Preview |
| **EDA / Analysis** | "分析", "趋势", "分布", "相关性", "统计" | → Step 2: Full EDA |
| **Forecasting** | "预测", "forecast", "下个月", "趋势" | → Step 3: Forecasting |
| **Classification** | "ABC", "分类", "排名", "TOP" | → Step 3: ABC/XYZ |
| **Inventory** | "库存", "安全库存", "补货", "ROP" | → Step 3: Inventory |
| **Pricing** | "定价", "价格", "折扣", "毛利率" | → Step 3: Pricing |
| **Dashboard** | "看板", "图表", "dashboard", "可视化" | → Step 4: Dashboard |
| **Report** | "报告", "报表", "导出", "PDF", "Excel" | → Step 5: Report |

## Analysis Pipeline

### Step 0: Data Cleaning (IMPORTANT — run BEFORE analysis)
If the data shows ANY quality issues, invoke the `clean-data-xls` skill FIRST:
- Detect: whitespace, casing, number-as-text, date format issues, duplicates, missing values, mixed types, encoding problems
- Propose fixes in a summary table before changing anything
- Apply with user confirmation for destructive operations
- Report before/after summary

**Key rule: Never analyze dirty data. Always check quality first.**

### Step 1: Quick Preview
- `ls /tmp/` to list files, `head` to preview first rows
- Report: row count, column names, data types, file size
- Flag any obvious quality issues (missing values, odd formats)

### Step 2: Exploratory Data Analysis (EDA)
- Reference `harness/spec/tasks/task_01_eda.md`
- Compute: summary statistics, distributions, correlations
- Identify: outliers, patterns, seasonal effects
- Use `code_interpreter` (Python) with built-in csv/statistics modules

### Step 3: Task-Specific Analysis
Based on user request, pick the matching task spec:

| Request | Task Spec |
|---------|-----------|
| Forecasting, demand prediction | `harness/spec/tasks/task_02_forecast.md` |
| ABC/XYZ classification | `harness/spec/tasks/task_03_abc_xyz.md` |
| Safety stock, ROP | `harness/spec/tasks/task_04_safety_stock.md` |
| Promotional impact | `harness/spec/tasks/task_05_promotional.md` |
| Pricing analysis | `harness/spec/tasks/task_06_pricing.md` |

### Step 4: Dashboard Generation
- Generate HTML dashboards in ` ```html ` blocks with Chart.js CDN
- The frontend auto-detects and shows a Preview button
- Use dark-themed or light-themed charts matching the app theme

### Step 5: Report Generation
- Present findings as structured report: Overview → Key Numbers → Details → Recommendations
- Use Chinese for Chinese-speaking users
- Include specific numbers, not just qualitative descriptions
- Suggest next steps based on findings
- For Excel/PDF: generate via code_interpreter, read back with files tool

### Step 6: Validation & Quality Gates
- Reference `harness/evaluation/quality_gates.yaml`
- Run applicable check scripts from `harness/scripts/`
- Every analysis MUST pass validation before presenting results

## Branch Failure Rules (inspired by smart-data-analysis)
- If one analysis branch fails: explain the specific reason, don't silently switch branches
- If data is too dirty: route to Step 0 (cleaning), don't skip
- If a task spec is missing: tell user what's needed, don't improvise
- If a tool fails: explain why and suggest alternatives

## Key Rules
- NEVER simulate data — always read actual files
- ALWAYS clean data before analysis (check for quality issues first)
- Use `code_interpreter` for ALL calculations
- For large files (>10K rows): use sampling or chunked processing
- Charts: save to sandbox filesystem, use matplotlib
- Present key numbers first, then details
- Be concise: greetings ≤5 words
