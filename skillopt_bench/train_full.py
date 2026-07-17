"""
Full SkillOpt integration using ReflACTTrainer with Claude Code backend.

Requires:
  pip install skillopt
  Claude Code CLI installed and authenticated
  Azure OpenAI or OpenAI API key for optimizer model

Usage:
  python skillopt_bench/train_full.py
"""

import json, os, sys, time
from pathlib import Path

# Add project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SKILL_PATH = PROJECT_ROOT / ".claude" / "skills" / "chatbi-analysis" / "SKILL.md"
VAL_SET_PATH = PROJECT_ROOT / "skillopt_bench" / "val_set.jsonl"
OUTPUT_DIR = PROJECT_ROOT / ".claude" / "skills" / "chatbi-analysis" / "skillopt_output"

def setup():
    """Validate prerequisites."""
    issues = []

    if not SKILL_PATH.exists():
        issues.append(f"Skill not found: {SKILL_PATH}")
    if not VAL_SET_PATH.exists():
        issues.append(f"Val set not found: {VAL_SET_PATH}")

    try:
        import skillopt
        print(f"SkillOpt v{skillopt.__version__} found")
    except ImportError:
        issues.append("skillopt not installed. Run: pip install skillopt")

    # Check Claude Code
    import subprocess
    result = subprocess.run(["claude", "--version"], capture_output=True, text=True)
    if result.returncode != 0:
        issues.append("Claude Code CLI not found. Install from: https://claude.ai/code")
    else:
        print(f"Claude Code: {result.stdout.strip()}")

    if issues:
        print("Issues found:")
        for i in issues:
            print(f"  - {i}")
        return False
    return True


def run_skillopt_training():
    """
    Run SkillOpt ReflACTTrainer with Claude Code backend.

    The trainer:
    1. Loads the skill document as the "trainable parameter"
    2. In each epoch, runs rollouts on training tasks using Claude Code
    3. Reflects on failures and proposes edits
    4. Validates edits on held-out gate set
    5. Saves best_skill.md when done
    """
    from skillopt.engine.trainer import ReflACTTrainer

    # Load tasks
    with open(VAL_SET_PATH, "r", encoding="utf-8") as f:
        tasks = [json.loads(line) for line in f if line.strip()]

    print(f"Loaded {len(tasks)} validation tasks")

    # Split train/gate
    split = int(len(tasks) * 0.7)
    train_tasks = tasks[:split]
    gate_tasks = tasks[split:]

    print(f"Train: {len(train_tasks)}, Gate: {len(gate_tasks)}")

    # Configure trainer
    trainer = ReflACTTrainer(
        skill_path=str(SKILL_PATH),
        output_dir=str(OUTPUT_DIR),
        train_tasks=train_tasks,
        gate_tasks=gate_tasks,
        max_epochs=5,
        textual_lr=4.0,           # Max edits per step
        mini_batch_size=5,         # Tasks per mini-batch
        target_backend="claude_code",
        optimizer_backend="azure",  # or "openai"
        verbose=True,
    )

    # Configure Claude Code as target
    trainer.configure_claude_code_exec(
        system_prompt_path=None,  # Use skill content directly
        max_turns=15,
    )

    # Run training
    print("\nStarting training...\n")
    trainer.train()

    # Print results
    print(f"\n=== Results ===")
    print(f"Best skill saved to: {OUTPUT_DIR / 'best_skill.md'}")
    print(f"Training history: {OUTPUT_DIR / 'history.json'}")

    # Compare before/after
    original = SKILL_PATH.read_text(encoding="utf-8")
    best = (OUTPUT_DIR / "best_skill.md").read_text(encoding="utf-8")
    print(f"\nBefore: {len(original)} chars, {len(original.splitlines())} lines")
    print(f"After:  {len(best)} chars, {len(best.splitlines())} lines")


def main():
    print("=== ChatBI SkillOpt Training ===\n")

    if not setup():
        print("\nFix the issues above and retry.")
        return

    run_skillopt_training()


if __name__ == "__main__":
    main()
