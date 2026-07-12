---
name: chatbi-analysis
description: Supply chain data analysis — EDA, forecasting, ABC/XYZ, inventory, pricing
---

# ChatBI Analysis Skill

Activate for ANY supply chain data analysis task. This skill defines the standard analysis pipeline.

## Analysis Pipeline

### 1. Data Loading & Validation
- Use `files` tool to list and read uploaded CSV/Excel files
- Check: row count, column names, data types, missing values
- Reference `harness/spec/data_spec.md` for data quality standards
- Reference `harness/rules/data_rules.md` for data red lines

### 2. Exploratory Data Analysis (EDA)
- Reference `harness/spec/tasks/task_01_eda.md`
- Compute: summary statistics, distributions, correlations
- Identify: outliers, patterns, seasonal effects
- Use `code_interpreter` (Python) with built-in csv/statistics modules

### 3. Task-Specific Analysis
Based on user request, pick the matching task spec:

| Request | Task Spec |
|---------|-----------|
| Forecasting, demand prediction | `harness/spec/tasks/task_02_forecast.md` |
| ABC/XYZ classification | `harness/spec/tasks/task_03_abc_xyz.md` |
| Safety stock, ROP | `harness/spec/tasks/task_04_safety_stock.md` |
| Promotional impact | `harness/spec/tasks/task_05_promotional.md` |
| Pricing analysis | `harness/spec/tasks/task_06_pricing.md` |
| Dashboard, report | `harness/spec/tasks/task_07_dashboard.md` |

### 4. Validation & Quality Gates
- Reference `harness/evaluation/quality_gates.yaml`
- Run applicable check scripts from `harness/scripts/`
- Every analysis MUST pass validation before presenting results

### 5. Report Generation
- Present findings as structured report: Overview → Key Numbers → Details → Recommendations
- Use Chinese for Chinese-speaking users
- Include specific numbers, not just qualitative descriptions
- Suggest next steps based on findings

## Key Rules
- NEVER simulate data — always read actual files
- Use `code_interpreter` for ALL calculations
- For large files (>10K rows): use sampling or chunked processing
- Charts: save to sandbox filesystem, use dark matplotlib theme
- If a tool fails: explain why and suggest alternatives
