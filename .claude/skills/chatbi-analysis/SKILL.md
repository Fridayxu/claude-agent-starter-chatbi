---
name: chatbi-analysis
description: General business data analysis — EDA, trend analysis, ranking, comparison, dashboard, report generation
---

# ChatBI Analysis Skill

Load this skill for ANY business data analysis task. Covers the full pipeline from loading to deliverable.

## Progressive Analysis Pipeline

### Phase 1: Quick Preview
Read `harness/spec/tasks/task_01_eda.md` for EDA methodology.
- `ls /tmp/` to list files, `head` to preview first rows
- Report: row count, columns, types, quality issues
- If dirty → route to clean-data-xls skill

### Phase 2: Confirm Direction
Based on column structure, suggest 2-3 analysis directions:
| Data Has | Suggest |
|----------|---------|
| Date + Amount | Trend over time |
| Category + Amount | Ranking by category |
| Region + Amount | Geographic comparison |
| Quantity + Price | Revenue & profit analysis |
| Multiple tables | Cross-table JOIN analysis |

### Phase 3: Analyze & Deliver

Based on user's chosen direction, reference the matching harness task:

| Direction | Harness Task |
|-----------|-------------|
| Trend, time series | `harness/spec/tasks/task_02_forecast.md` |
| Classification, ranking | `harness/spec/tasks/task_03_abc_xyz.md` |
| KPI calculation | `harness/spec/tasks/task_04_safety_stock.md` |
| Impact analysis | `harness/spec/tasks/task_05_promotional.md` |
| Comparison, pricing | `harness/spec/tasks/task_06_pricing.md` |
| Dashboard, visualization | `harness/spec/tasks/task_07_dashboard.md` |

### Phase 4: Output Deliverable (ALWAYS)
After analysis, ALWAYS produce a downloadable file:
- **HTML Dashboard**: ```html block with Chart.js CDN — frontend auto-shows Preview button
- **Excel Report**: `openpyxl` → save `/tmp/report.xlsx` — auto-downloaded
- **PDF Report**: `reportlab` → save `/tmp/report.pdf` — auto-downloaded

## Validation
Reference `harness/evaluation/quality_gates.yaml` for quality standards.
Reference `harness/rules/analysis_rules.md` for analytical constraints.

## Rules
- NEVER text-only — always produce a file deliverable
- Use Read tool to access harness specs for methodology
- For large files: sample first, confirm approach, then process
- Use Chinese for Chinese-speaking users
