---
name: chatbi-analysis
description: General business data analysis — multi-file JOIN, report templates, smart KPI, dashboard & report generation
---

# ChatBI Analysis Skill

## Progressive Analysis Pipeline

### Phase 1: Quick Preview
- `ls /tmp/` to list files, `head` to preview headers
- Report: row count, columns, types, quality issues
- If dirty → route to `clean-data-xls` skill
- **Multi-file detection**: If >1 file in /tmp/, read headers of ALL files and detect potential JOIN keys (columns with same name or similar values across files). Present join suggestions to user.

### Phase 2: Confirm Direction
Based on column structure and file count, suggest 2-3 analysis directions:

| Data Pattern | Suggest |
|-------------|---------|
| Date + Amount | Trend over time |
| Category + Amount | Ranking by category |
| Region + Amount | Geographic comparison |
| Multiple tables | Cross-table JOIN — auto-detect keys |
| Quantity + Price | Revenue & profit analysis |
| Text columns | Sentiment, keyword extraction |

### Phase 2b: Report Template Selection
After confirming direction, check `harness/spec/templates/` for a matching report template:

| Domain | Template File | When to Use |
|--------|--------------|-------------|
| Sales | `sales_report.yaml` | Revenue, profit, products, channels |
| Finance | `finance_report.yaml` | P&L, cashflow, budget vs actual |
| HR | `hr_report.yaml` | Headcount, turnover, compensation |
| Operations | `ops_report.yaml` | Inventory, supply chain, efficiency |
| Marketing | `marketing_report.yaml` | Campaign ROI, funnel, attribution |

Read the template with the `Read` tool. It defines required KPIs, charts, and output structure. Follow the template structure when generating the final report.

### Phase 2c: Smart KPI Memory
Before calculating any metric, check `.claude/skills/chatbi-analysis/kpi_memory.md`. This file stores previously defined KPI formulas. If the metric already exists, reuse the exact formula. If new, define it explicitly and append to kpi_memory.md after analysis.

KPI definition format:
```
| KPI Name | Formula | Source Columns | Last Used |
|----------|---------|---------------|-----------|
| 毛利率 | (Revenue - Cost) / Revenue * 100 | Revenue, Cost | 2026-07-19 |
```

### Phase 3: Analyze & Deliver

Based on user's chosen direction, reference the matching harness task:

| Direction | Harness Task |
|-----------|-------------|
| EDA, overview | `harness/spec/tasks/task_01_eda.md` |
| Trend, time series | `harness/spec/tasks/task_02_forecast.md` |
| Classification, ranking | `harness/spec/tasks/task_03_abc_xyz.md` |
| KPI calculation | `harness/spec/tasks/task_04_safety_stock.md` |
| Impact analysis | `harness/spec/tasks/task_05_promotional.md` |
| Comparison, pricing | `harness/spec/tasks/task_06_pricing.md` |
| Dashboard, visualization | `harness/spec/tasks/task_07_dashboard.md` |

### Phase 4: Output Deliverable (ALWAYS)
- **HTML Dashboard**: ```html block with Chart.js — auto-preview button
- **Excel Report**: `openpyxl` → `/tmp/report.xlsx` — auto-download
- **PDF Report**: `reportlab` → `/tmp/report.pdf` — auto-download

## Multi-File JOIN Logic

When multiple files are in /tmp/, use code_interpreter to:
```python
import csv, os
files = [f for f in os.listdir('/tmp/') if f.endswith('.csv')]
# Read headers from each file
headers = {}
for f in files:
    with open(f'/tmp/{f}') as fh:
        headers[f] = csv.reader(fh).__next__()
# Find common columns (same name)
common = set.intersection(*[set(h) for h in headers.values()])
# Suggest JOIN if common columns found
```

If common columns found → "检测到 {file1} 和 {file2} 有共同字段 {col}，建议关联分析"

## Validation
- Reference `harness/evaluation/quality_gates.yaml` for quality standards
- Reference `harness/rules/analysis_rules.md` for analytical constraints
- After analysis, append new KPI definitions to `kpi_memory.md`

## Rules
- NEVER text-only — always produce a file deliverable
- ALWAYS check kpi_memory.md before defining new metrics
- Read harness specs for methodology reference via Read tool
- For multi-file: always check for JOIN keys first
- For large files: sample, confirm, then process
