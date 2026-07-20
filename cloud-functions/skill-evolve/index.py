"""
POST /skill-evolve — Analyze conversation and auto-improve SKILL.md.

Triggered by frontend after each assistant response completes.
Uses Gateway Direct to analyze the conversation for improvement signals.
Applies safe, append-only edits to .claude/skills/chatbi-analysis/SKILL.md.
"""

import json, os, time, httpx
from pathlib import Path

SKILL_PATH = "/tmp/user-code/.claude/skills/chatbi-analysis/SKILL.md"
BACKUP_DIR = "/tmp/user-code/.claude/skills/chatbi-analysis/backups"
MAX_EDITS_PER_DAY = 5
MAX_APPEND_LINES = 3  # Maximum lines to append per edit

EVOLVE_PROMPT = """You are a skill optimizer. Analyze this conversation and determine if the skill needs improvement.

## Conversation
{conversation}

## Current Skill
{skill}

## Instructions
1. Identify if the USER corrected the assistant or expressed dissatisfaction.
2. If YES: what specifically went wrong? Write a SINGLE concise rule (1-2 lines) that would prevent this.
3. If NO: respond with "NO_CHANGE".
4. Never remove existing rules. Only suggest ADDING new ones.

Respond in JSON:
{{"action": "NO_CHANGE"}} or {{"action": "APPEND", "rule": "new rule text here", "reason": "why this is needed"}}"""


def _count_today_edits() -> int:
    """Count edits made today from backup files."""
    try:
        today = time.strftime("%Y-%m-%d")
        count = 0
        if os.path.exists(BACKUP_DIR):
            for f in os.listdir(BACKUP_DIR):
                if f.startswith(today):
                    count += 1
        return count
    except:
        return 0


def _backup_skill() -> str:
    """Create a timestamped backup of current SKILL.md."""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        ts = time.strftime("%Y-%m-%d_%H%M%S")
        backup_path = os.path.join(BACKUP_DIR, f"{ts}_backup.md")
        if os.path.exists(SKILL_PATH):
            with open(SKILL_PATH, "r", encoding="utf-8") as src:
                with open(backup_path, "w", encoding="utf-8") as dst:
                    dst.write(src.read())
        return backup_path
    except Exception as e:
        return f"backup_failed: {e}"


def _append_rule(rule: str) -> bool:
    """Append a new rule to SKILL.md. Only adds, never removes."""
    try:
        if not os.path.exists(SKILL_PATH):
            return False

        with open(SKILL_PATH, "r", encoding="utf-8") as f:
            content = f.read()

        # Avoid duplicates
        if rule.strip() in content:
            return False

        # Append rule under a new "## Learned Rules" section
        if "## Learned Rules" not in content:
            content += "\n\n## Learned Rules\n"

        content += f"\n- {rule.strip()}"

        with open(SKILL_PATH, "w", encoding="utf-8") as f:
            f.write(content)

        return True
    except Exception:
        return False


async def handler(ctx):
    """EdgeOne cloud function entry point."""
    body = getattr(ctx, "body", {}) or {}
    conversation_id = body.get("conversation_id", "")
    messages = body.get("messages", [])

    if not messages or len(messages) < 2:
        return {"action": "SKIP", "reason": "not enough messages"}

    # ── Rate limit: max N edits per day ──
    today_edits = _count_today_edits()
    if today_edits >= MAX_EDITS_PER_DAY:
        return {"action": "SKIP", "reason": f"daily limit reached ({today_edits}/{MAX_EDITS_PER_DAY})"}

    # ── Check for improvement signals ──
    # Quick pre-filter: does the conversation contain correction signals?
    correction_signals = ["不对", "错了", "应该是", "重新", "再算", "不对的", "不正确",
                          "wrong", "incorrect", "redo", "retry", "再分析", "重新分析"]
    has_signal = any(
        any(signal in (msg.get("content", "") or "").lower() for signal in correction_signals)
        for msg in messages if msg.get("role") == "user"
    )

    if not has_signal:
        return {"action": "SKIP", "reason": "no correction signal detected"}

    # ── Read current skill ──
    try:
        with open(SKILL_PATH, "r", encoding="utf-8") as f:
            current_skill = f.read()
    except FileNotFoundError:
        return {"action": "SKIP", "reason": "skill file not found"}
    except Exception as e:
        return {"action": "ERROR", "reason": str(e)}

    # ── Build conversation text ──
    conv_text = "\n".join(
        f"{m.get('role','user')}: {m.get('content','')[:500]}"
        for m in messages[-10:]  # Last 10 messages
    )

    # ── Call AI Gateway to analyze ──
    env = getattr(ctx, "env", {}) or {}
    # Try multiple sources for credentials (platform auto-inject varies)
    api_key = (env.get("AI_GATEWAY_API_KEY") or os.environ.get("AI_GATEWAY_API_KEY") or
               os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("MAKERS_MODELS_KEY", ""))
    base_url = (env.get("AI_GATEWAY_BASE_URL") or os.environ.get("AI_GATEWAY_BASE_URL") or
                os.environ.get("ANTHROPIC_BASE_URL") or "https://ai-gateway.edgeone.link/v1")
    if not base_url.endswith("/v1"):
        base_url = base_url.rstrip("/") + "/v1"
    model = (env.get("AI_GATEWAY_MODEL") or os.environ.get("AI_GATEWAY_MODEL") or
             os.environ.get("CLAUDE_MODEL") or "@makers/deepseek-v4-flash")

    if not api_key:
        return {"action": "SKIP", "reason": "no API key available (will retry next conversation)"}

    prompt = EVOLVE_PROMPT.format(conversation=conv_text, skill=current_skill[:3000])

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "Respond with JSON only. No markdown."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 200,
                },
            )

            if resp.status_code != 200:
                return {"action": "ERROR", "reason": f"API {resp.status_code}"}

            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            # Parse JSON response
            try:
                # Extract JSON from possible markdown wrapping
                if "```" in content:
                    content = content.split("```")[1]
                    if content.startswith("json"):
                        content = content[4:]
                result = json.loads(content.strip())
            except json.JSONDecodeError:
                return {"action": "SKIP", "reason": f"unparseable response: {content[:100]}"}

            action = result.get("action", "NO_CHANGE")

            if action == "APPEND" and result.get("rule"):
                rule = result["rule"]
                reason = result.get("reason", "")

                # Safety: backup before editing
                backup = _backup_skill()

                # Apply edit
                if _append_rule(rule):
                    return {
                        "action": "APPENDED",
                        "rule": rule,
                        "reason": reason,
                        "backup": backup,
                        "edits_today": today_edits + 1,
                    }
                else:
                    return {"action": "SKIP", "reason": "append failed (duplicate or error)"}

            return {"action": "NO_CHANGE", "reason": result.get("reason", "no improvement needed")}

    except Exception as e:
        return {"action": "ERROR", "reason": str(e)}
