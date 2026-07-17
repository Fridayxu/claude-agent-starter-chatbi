# SkillOpt — ChatBI Skill Optimization

Automatically optimize the `chatbi-analysis` skill using SkillOpt's reflective training loop.

## How It Works

```
原始 SKILL.md ──→ Claude Code 执行任务 ──→ 记录轨迹(成功/失败)
                                              │
                                              ▼
优化 SKILL.md ←── 验证通过 ←── 生成编辑 ←── 优化器分析
                 (gate set)    (add/delete)   (GPT-4o)
```

## Quick Start

```bash
# 1. Install
pip install skillopt

# 2. Run training
python skillopt_bench/train_full.py

# 3. Compare
diff .claude/skills/chatbi-analysis/SKILL.md \
     .claude/skills/chatbi-analysis/skillopt_output/best_skill.md
```

## Validation Set

`val_set.jsonl` contains 20 supply chain analysis tasks with expected outputs:
- EDA (revenue, products, categories)
- ABC Classification
- Forecasting
- Inventory analysis
- Pricing analysis
- Data quality checks
- Report generation

## Proving It Works

| Method | How |
|--------|-----|
| **Training curve** | `history.json` shows epoch-by-epoch pass rate improvement |
| **Before/After diff** | Compare original vs optimized SKILL.md |
| **A/B test** | Run same 20 tasks with both skills, compare accuracy |
| **Token efficiency** | Optimized skills should be shorter (300-2000 tokens) while maintaining accuracy |

## Requirements

- Claude Code CLI (authenticated)
- Azure OpenAI or OpenAI API key (for optimizer model)
- Python 3.10+
