"""
Claude Agent SDK chat handler — EdgeOne Makers agent-python format.

Route: POST /chat
Response: SSE stream (text/event-stream)

SSE event protocol:
  event: text_delta  data: {"delta": "..."}
  event: tool_called data: {"tool": "ToolName"}
  event: image       data: {"imageId": "...", "base64": "...", "mimeType": "...", "size": ...}
  event: ping        data: {"ts": 1710000000000}
  event: error       data: {"message": "..."}
  event: done        data: {"stopped": false}

Session persistence:
  Uses ctx.store to save user/assistant messages for /history recovery.

Tools:
  EdgeOne platform sandbox tools (commands/files/code_interpreter/browser)
  bridged via Claude SDK's MCP Server mechanism.
"""

from __future__ import annotations

import asyncio
import base64
import json
import httpx
import os
import time
from typing import Any, AsyncGenerator
from uuid import UUID

from dotenv import load_dotenv

load_dotenv()

try:
    from claude_agent_sdk import (
        ClaudeAgentOptions,
        create_sdk_mcp_server,
        query,
    )
    _SDK_AVAILABLE = True
except ImportError:
    _SDK_AVAILABLE = False

from .._model import collect_gateway_env, resolve_model_name
from .._logger import create_logger
from ._stream import (
    StreamState,
    iter_query_messages,
    sanitize_assistant_text,
    sdk_message_to_sse,
    sse_event,
)


logger = create_logger("chat")
HEARTBEAT_INTERVAL_S = 5
MCP_SERVER_NAME = "edgeone"

# Module-level file cache: conversation_id → [{name, content_b64, mimeType}]
# Files are re-written to sandbox /tmp/ on every request (sandbox /tmp/ is ephemeral).
_file_cache: dict[str, list[dict]] = {}

SYSTEM_PROMPT = (
  'You are ChatBI, a business data analyst. Parse natural language → analyze data → deliver reports.\n'
  'Speak Chinese to Chinese-speaking users.\n\n'
  '## BUILT-IN Workflow (follow this EXACT order — no Skill tool needed)\n'
  '### Phase 1: Quick Preview\n'
  'When user uploads data: `ls /tmp/` → `head` to preview each file.\n'
  'If >1 file: use code_interpreter to detect common columns (JOIN keys).\n'
  'Report: rows×cols, column names, JOIN keys, any quality issues.\n'
  'If data is messy → use Skill tool to load clean-data-xls.\n\n'
  '### Phase 2: Confirm Direction\n'
  'Based on columns, suggest 2-3 analysis directions. Let user choose.\n'
  'If user already specified: confirm understanding briefly, then proceed.\n'
  'For methodology, Read harness/spec/tasks/ matching the direction.\n\n'
  '### Phase 3: Save File FIRST, Then Summarize\n'
  '1. Use code_interpreter to generate AND save the deliverable to /tmp/:\n'
  '   - HTML: code = "open(\"/tmp/dashboard.html\",\"w\").write(html_content)"\n'
  '   - Excel: code = "import openpyxl; wb.save(\"/tmp/report.xlsx\")"\n'
  '   - PDF: save to /tmp/report.pdf\n'
  '2. After saving, write a brief text summary (2-3 sentences).\n'
  'The saved file auto-downloads to the user — that is the primary deliverable.\n\n'
  '## Tools\n'
  'code_interpreter (Python), commands (shell), files (sandbox I/O), browser.\n'
  'Loadable skills: clean-data-xls, humanizer-zh, markitdown, pdf-report.\n\n'
  '## Rules\n'
  'Save deliverable file to /tmp/ BEFORE writing your text summary.\n'
  'Never retry failed tools. No simulated results. Greetings ≤5 words.'
)


def _normalize_uuid(value: str) -> str | None:
    """Return canonical UUID string, or None if value is not a valid UUID."""
    try:
        return str(UUID(value))
    except (TypeError, ValueError):
        return None


async def resolve_claude_session_binding(
    session_store: Any,
    conversation_id: str,
) -> tuple[str | None, str | None]:
    """
    Bind Claude SDK session to frontend conversation_id.

    First request for a conversation uses session_id=<conversation_id> to create
    a deterministic SDK session. Later requests use resume=<conversation_id>
    when that transcript already exists in session_store.
    """
    session_id = _normalize_uuid(conversation_id)
    if not session_id:
        logger.log(f"[session] skip SDK session binding: invalid conversation_id={conversation_id!r}")
        return None, None

    try:
        from claude_agent_sdk._internal.sessions import project_key_for_directory

        # project_key is load-bearing: EdgeOne ClaudeSessionStore.load() uses it
        # as a namespace prefix on blob keys. Drop it and load() returns None.
        project_key = project_key_for_directory(os.getcwd())
        entries = await session_store.load({"project_key": project_key, "session_id": session_id})
        if entries:
            logger.log(f"[session] resume Claude SDK session_id={session_id}, entries={len(entries)}")
            return None, session_id
        logger.log(f"[session] create Claude SDK session_id={session_id}")
    except Exception as e:
        logger.error(f"[session] failed to inspect session_store for resume: {e}")

    return session_id, None


def build_agent_options(
    session_store=None,
    mcp_server=None,
    mcp_server_name: str = MCP_SERVER_NAME,
    allowed_tools: list[str] | None = None,
    session_id: str | None = None,
    resume: str | None = None,
) -> "ClaudeAgentOptions":
    """Build Claude Agent SDK options. EdgeOne tools come from MCP."""
    cwd = os.getcwd()
    skill_read_allow_rules = [
        "Read(.claude/skills/**)",
        f"Read({cwd}/.claude/skills/**)",
        "Read(harness/spec/**)",
        "Read(harness/workflows/**)",
        "Read(harness/rules/**)",
        "Read(harness/evaluation/**)",
        "Write(.claude/skills/chatbi-analysis/kpi_memory.md)",
    ]
    # Merge incoming MCP tool names with the built-in Read scoping rules.
    # The Python SDK's `settings` field only accepts a JSON-file path
    # (str | None), unlike the TS SDK which also accepts an inline Settings
    # dict. Trying to pass a dict raises CLIConnectionError("Failed to start
    # Claude Code: expected str, bytes or os.PathLike object, not dict") at
    # subprocess launch. So we route the same `permissions.allow` intent
    # through `allowed_tools` instead — the CLI treats both as auto-allow
    # rules with identical syntax.
    merged_allowed_tools = list(
        dict.fromkeys((allowed_tools or []) + skill_read_allow_rules)
    )
    opts = ClaudeAgentOptions(
        model=resolve_model_name(),
        system_prompt=SYSTEM_PROMPT,
        cwd=cwd,
        tools=["Skill", "Read"],
        allowed_tools=merged_allowed_tools,
        setting_sources=["project"],
        skills="project",          # Only project skills, skip system-level
        permission_mode="dontAsk",
        max_turns=15,
        env=collect_gateway_env(),
        include_partial_messages=True,   # Required for text_delta streaming
        max_buffer_size=4 * 1024 * 1024,  # 4MB — sufficient for screenshots
        session_id=session_id,
        resume=resume,
    )
    if session_store is not None:
        opts.session_store = session_store
    if mcp_server is not None:
        opts.mcp_servers = {mcp_server_name: mcp_server}
    return opts


async def _gateway_direct_stream(
    ctx: Any, cid: str, user_message: str, history_msgs: list,
    api_key: str, base_url: str, model: str,
) -> AsyncGenerator[str, None]:
    """Gateway Direct path — standard OpenAI-compatible multi-turn chat.
    Fast (no SDK overhead) with proper message-role memory."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Add conversation history with proper role tags
    for m in history_msgs:
        role = getattr(m, "role", "user")
        content = getattr(m, "content", "")
        if content and role in ("user", "assistant"):
            messages.append({"role": role, "content": str(content)[:4000]})

    # Add current message
    messages.append({"role": "user", "content": user_message})

    logger.log(f"[gateway] streaming with {len(messages)} messages (history={len(history_msgs)})")

    async with httpx.AsyncClient(timeout=180.0) as client:
        try:
            async with client.stream(
                "POST",
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True,
                },
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    yield sse_event("error", {"message": f"Gateway {response.status_code}: {body.decode()[:300]}"})
                    yield sse_event("done", {"stopped": False})
                    return

                assistant_text = ""
                async for line in response.aiter_lines():
                    if ctx.request.signal.is_set():
                        break
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            assistant_text += content
                            yield sse_event("text_delta", {"delta": content})
                    except (json.JSONDecodeError, KeyError):
                        pass

                # Save assistant message
                if cid and assistant_text.strip():
                    try:
                        await ctx.store.append_message(conversation_id=cid, role="assistant", content=assistant_text.strip())
                    except Exception as e:
                        logger.error(f"[gateway] failed to save: {e}")

        except httpx.ReadError:
            if not ctx.request.signal.is_set():
                yield sse_event("error", {"message": "Stream interrupted"})
        except Exception as e:
            logger.error(f"[gateway] error: {e}")
            yield sse_event("error", {"message": str(e)})

    yield sse_event("done", {"stopped": False})


async def handler(ctx: Any) -> AsyncGenerator[str, None]:
    """EdgeOne Makers entry point (async generator streaming)."""
    cid = ctx.conversation_id or ""
    logger.log(f"[chat] entered with cid={cid!r}")

    body = ctx.request.body
    user_message: str = body.get("message", "") if isinstance(body, dict) else ""
    uploaded_files: list[dict] = body.get("files", []) if isinstance(body, dict) else []
    uploaded_templates: list[dict] = body.get("templates", []) if isinstance(body, dict) else []
    uploaded_skills: list[dict] = body.get("skills", []) if isinstance(body, dict) else []

    # Handle template uploads — save to /tmp/user-templates/
    template_paths: list[str] = []
    if uploaded_templates:
        sandbox = getattr(ctx, "sandbox", None)
        for tpl in uploaded_templates:
            tpl_name = tpl.get("name", "template.yaml")
            tpl_content = tpl.get("content", "")
            tpl_path = f"/tmp/user-templates/{tpl_name}"
            try:
                raw = base64.b64decode(tpl_content)
                text = raw.decode("utf-8", errors="replace")
                if sandbox and hasattr(sandbox, "files"):
                    await sandbox.files.make_dir("/tmp/user-templates")
                    await sandbox.files.write(tpl_path, text)
                    template_paths.append(tpl_path)
                    logger.log(f"[template] saved {tpl_name} to {tpl_path}")
            except Exception as e:
                logger.error(f"[template] failed to save {tpl_name}: {e}")

    # Handle file uploads — write to sandbox via ctx.sandbox.files.write()
    file_paths: list[str] = []
    if uploaded_files:
        # Cache files for this conversation (sandbox /tmp/ is ephemeral across requests)
        if cid not in _file_cache:
            _file_cache[cid] = []
        for f in uploaded_files:
            _file_cache[cid].append({
                "name": f.get("name", "uploaded_file"),
                "content": f.get("content", ""),
                "mimeType": f.get("mimeType", "text/csv"),
            })

    # Re-write cached files to sandbox on every request (sandbox /tmp/ may be cleaned)
    if cid and cid in _file_cache:
        sandbox = getattr(ctx, "sandbox", None)
        for f in _file_cache[cid]:
            fname = f["name"]
            b64 = f["content"]
            mime = f["mimeType"]
            fpath = f"/tmp/{fname}"

            try:
                raw = base64.b64decode(b64)
                # Text files (CSV, JSON, TXT): write via sandbox.files.write (UTF-8 only)
                if mime and ("csv" in mime or "json" in mime or "text" in mime or "txt" in mime):
                    text = raw.decode("utf-8", errors="replace")
                    if sandbox and hasattr(sandbox, "files"):
                        await sandbox.files.write(fpath, text)
                        logger.log(f"[sandbox] wrote {fname} ({len(text)} chars) to {fpath}")
                    else:
                        # Fallback: embed in message (sandbox unavailable)
                        truncated = text[:50000]
                        user_message = f"[File: {fname}]\n{truncated}\n\n{user_message}"
                        logger.log(f"[fallback] embedded {fname} ({len(truncated)} chars) in message")
                else:
                    # Binary files (Excel etc): write base64, decode in sandbox via commands
                    if sandbox and hasattr(sandbox, "files"):
                        await sandbox.files.write(fpath + ".b64", b64)
                        logger.log(f"[sandbox] wrote {fname}.b64 ({len(b64)} b64 chars) to {fpath}.b64")
                        file_paths.append(f"{fpath}.b64 (base64-encoded, decode with: base64 -d {fpath}.b64 > {fpath})")
                        continue
                    else:
                        truncated = b64[:50000]
                        user_message = f"[Binary file: {fname}]\n```base64\n{truncated}\n```\n\n{user_message}"
                        logger.log(f"[fallback] embedded binary {fname} in message")
                        continue

                file_paths.append(fpath)
            except Exception as e:
                logger.error(f"[sandbox] failed to write {fname}: {e}")
                # Last resort: embed truncated content
                truncated = b64[:30000]
                user_message = f"[File: {fname} (write failed: {e})]\n```base64\n{truncated}\n```\n\n{user_message}"

        if file_paths:
            path_list = "\n".join(f"  - {p}" for p in file_paths)
            file_note = f"Files in sandbox:\n{path_list}\n\nRead with code_interpreter: `open('/tmp/filename')`\n\n"
            if not user_message.strip():
                user_message = file_note + "Analyze these files."
            else:
                user_message = file_note + user_message

    # Handle skill uploads — save to /tmp/user-skills/
    skill_paths: list[str] = []
    if uploaded_skills:
        sandbox2 = getattr(ctx, "sandbox", None)
        for sk in uploaded_skills:
            sk_name = sk.get("name", "skill") + ".md"
            sk_content = sk.get("content", "")
            sk_path = f"/tmp/user-skills/{sk_name}"
            try:
                raw = base64.b64decode(sk_content)
                text = raw.decode("utf-8", errors="replace")
                if sandbox2 and hasattr(sandbox2, "files"):
                    await sandbox2.files.make_dir("/tmp/user-skills")
                    await sandbox2.files.write(sk_path, text)
                    skill_paths.append(sk_path)
                    logger.log(f"[skill] saved {sk_name} to {sk_path}")
            except Exception as e:
                logger.error(f"[skill] failed to save {sk_name}: {e}")

    # Add template info to message
    if template_paths:
        tpl_list = "\n".join(f"  - {p}" for p in template_paths)
        tpl_note = f"\n\nUser uploaded report templates:\n{tpl_list}\nUse these templates instead of defaults. Read with code_interpreter: `open('/tmp/user-templates/filename')`\n"
        user_message = (user_message or "") + tpl_note

    # Add skill info to message
    if skill_paths:
        sk_list = "\n".join(f"  - {p}" for p in skill_paths)
        sk_note = f"\n\nUser uploaded custom skills:\n{sk_list}\nUse Skill tool to LOAD these skills before analysis.\n"
        user_message = (user_message or "") + sk_note

    logger.log(f"[file] {len(file_paths)} files in sandbox, message size={len(user_message)} chars")

    if not user_message.strip():
        yield sse_event("error", {"message": "'message' or 'files' is required"})
        yield sse_event("done", {"stopped": False})
        return

    # Extract frontend-generated message IDs for history alignment
    user_msg_id: str = body.get("userMsgId", "") if isinstance(body, dict) else ""
    bot_msg_id: str = body.get("botMsgId", "") if isinstance(body, dict) else ""

    # Extract user ID for store scoping
    raw_user_id = body.get("userId") or body.get("user_id") or "" if isinstance(body, dict) else ""
    user_id = str(raw_user_id).strip() or None

    store_adapter = ctx.store
    cancel_signal = ctx.request.signal

    # Save user message to store (both paths need this)
    if cid:
        try:
            await store_adapter.append_message(
                conversation_id=cid,
                role="user",
                content=user_message,
                user_id=user_id,
            )
        except Exception as e:
            logger.error(f"[store] failed to save user message: {e}")

    # ═══ Routing: Gateway Direct for chat, SDK for file analysis ═══
    has_files_in_sandbox = bool(file_paths)
    if not has_files_in_sandbox and user_message.strip():
        # Fast path: Gateway Direct — proper multi-turn memory, no SDK overhead
        env = ctx.env
        api_key = env.get("AI_GATEWAY_API_KEY") or os.environ.get("AI_GATEWAY_API_KEY", "")
        base_url = env.get("AI_GATEWAY_BASE_URL") or os.environ.get("AI_GATEWAY_BASE_URL", "https://ai-gateway.edgeone.link/v1")
        if not base_url.endswith("/v1"):
            base_url = base_url.rstrip("/") + "/v1"
        model = resolve_model_name()

        if not api_key:
            yield sse_event("error", {"message": "Missing AI_GATEWAY_API_KEY"})
            yield sse_event("done", {"stopped": False})
            return

        # Fetch history for multi-turn memory
        history_msgs: list = []
        if cid and store_adapter:
            try:
                history_msgs = await store_adapter.get_messages(conversation_id=cid, limit=30, order="asc")
                # Exclude the just-saved current message
                history_msgs = history_msgs[:-1] if history_msgs else []
            except Exception as e:
                logger.error(f"[gateway] history fetch failed: {e}")

        logger.log(f"[route] Gateway Direct (no files), history={len(history_msgs)}")
        async for event in _gateway_direct_stream(ctx, cid, user_message, history_msgs, api_key, base_url, model):
            yield event
        return

    # ═══ SDK path: file analysis with sandbox tools ═══
    if not _SDK_AVAILABLE:
        yield sse_event("error", {"message": "claude_agent_sdk is not installed"})
        yield sse_event("done", {"stopped": False})
        return

    # Get Claude session store for transcript persistence (matches TS reference).
    # This gives the SDK multi-turn context, preventing chaotic/repeated tool calls.
    try:
        raw_session_store = store_adapter.claude_session_store()
        logger.log(f"[session_store] enabled, type={type(raw_session_store).__name__}, value={raw_session_store is not None}")
    except Exception as e:
        raw_session_store = None
        logger.error(f"[session_store] failed to get claude_session_store: {e}")
    session_store = raw_session_store

    # Save user message (with frontend-generated ID if available)
    if cid:
        # === DEBUG: dump all store messages for this conversation ===
        try:
            all_msgs = await store_adapter.get_messages(conversation_id=cid, limit=100, order="asc")
            logger.log(f"[debug_store] conversation={cid}, total_messages={len(all_msgs)}")
            for m in all_msgs:
                role = getattr(m, "role", "?")
                msg_id = getattr(m, "message_id", "?")
                content = getattr(m, "content", "")
                preview = str(content)[:200] if content else ""
                created_at = getattr(m, "created_at", 0)
                logger.log(f"[debug_store]   [{role}] id={msg_id} ts={created_at} content={preview}")
        except Exception as e:
            logger.error(f"[debug_store] failed to dump: {e}")
        # === END DEBUG ===

    # Build EdgeOne platform tools → Claude Agent SDK MCP server
    raw_tools = ctx.tools
    if not hasattr(raw_tools, "to_claude_mcp_server"):
        yield sse_event("error", {"message": "context.tools.to_claude_mcp_server is unavailable."})
        yield sse_event("done", {"stopped": False})
        return

    edgeone_mcp = raw_tools.to_claude_mcp_server(MCP_SERVER_NAME, {"always_load": True})
    logger.log("[tool_debug][mcp_server]", {
        "name": getattr(edgeone_mcp, "name", None),
        "allowed_tools": getattr(edgeone_mcp, "allowed_tools", None),
        "tools": [
            {
                "name": getattr(tool, "name", None) if not isinstance(tool, dict) else tool.get("name"),
                "description": getattr(tool, "description", None) if not isinstance(tool, dict) else tool.get("description"),
                "input_schema": getattr(tool, "input_schema", None) if not isinstance(tool, dict) else tool.get("input_schema"),
            }
            for tool in (getattr(edgeone_mcp, "tools", None) or [])
        ],
    })
    mcp_server = create_sdk_mcp_server(
        name=edgeone_mcp.name,
        tools=edgeone_mcp.tools,
    )

    sdk_session_id, sdk_resume = await resolve_claude_session_binding(session_store, cid)
    options = build_agent_options(
        session_store=session_store,
        mcp_server=mcp_server,
        mcp_server_name=edgeone_mcp.name,
        allowed_tools=edgeone_mcp.allowed_tools,
        session_id=sdk_session_id,
        resume=sdk_resume,
    )

    # ── In-session memory: prepend conversation history ──
    # Claude SDK session resume is unreliable with @makers/ models,
    # so we manually fetch history and include it in the prompt.
    history_prefix = ""
    if cid and store_adapter:
        try:
            history_msgs = await store_adapter.get_messages(conversation_id=cid, limit=20, order="asc")
            if history_msgs and len(history_msgs) > 1:  # >1 because current user msg is already in there
                lines = ["## Conversation History (for context)\n"]
                for m in history_msgs[:-1]:  # exclude the just-saved current message
                    role = getattr(m, "role", "user")
                    content = getattr(m, "content", "")
                    if content and len(str(content)) < 2000:
                        lines.append(f"{role}: {content}")
                history_prefix = "\n".join(lines) + "\n\n---\n\n"
                logger.log(f"[memory] prepended {len(lines)-1} history messages ({len(history_prefix)} chars)")
        except Exception as e:
            logger.error(f"[memory] failed to fetch history: {e}")

    prompt_text = history_prefix + user_message if history_prefix else user_message

    stopped = False
    stream_state = StreamState(bot_msg_id=bot_msg_id)

    try:
        response_iter = query(prompt=prompt_text, options=options).__aiter__()
        async for item_type, msg in iter_query_messages(response_iter, cancel_signal, HEARTBEAT_INTERVAL_S):
            if item_type == "cancelled":
                logger.log(f"[cancel] cancel_signal observed, stopping stream cid={cid!r}")
                stopped = True
                break
            if item_type == "finished":
                break
            if item_type == "ping":
                yield sse_event("ping", {"ts": int(time.time() * 1000)})
                continue

            events, should_stop = sdk_message_to_sse(msg, stream_state, logger)
            for event in events:
                yield event
            if should_stop:
                break

    except Exception as e:  # noqa: BLE001
        logger.error(f"[error] {e}")
        yield sse_event("error", {
            "message": str(e),
            "errorType": type(e).__name__,
            "detail": repr(e),
        })

    # Save assistant response (with frontend-generated ID if available)
    # Save even if text is empty but images were sent (use placeholder)
    assistant_content = sanitize_assistant_text(stream_state.full_assistant_text).strip()
    if not assistant_content and stream_state.has_images:
        assistant_content = "[image]"

    if store_adapter and cid and assistant_content:
        try:
            await store_adapter.append_message(
                conversation_id=cid,
                role="assistant",
                content=assistant_content,
                user_id=user_id,
            )
        except Exception as e:
            logger.error(f"[store] failed to save assistant response: {e}")

    # ── Auto-detect generated files in sandbox and emit download events ──
    sandbox = getattr(ctx, "sandbox", None)
    if sandbox is not None:
        for _ext in ("xlsx", "pdf", "png", "html"):
            try:
                _result = await sandbox.commands.run(
                    f"ls /tmp/*.{_ext} 2>/dev/null && for f in /tmp/*.{_ext}; do echo \"FILE:$f:$(base64 -w0 $f 2>/dev/null | head -c 500000)\"; done"
                )
                _out = getattr(_result, "stdout", "") or ""
                if isinstance(_out, list):
                    _out = "\n".join(_out)
                for _line in str(_out).split("\n"):
                    if _line.startswith("FILE:") and ":" in _line[5:]:
                        _parts = _line[5:].split(":", 1)
                        if len(_parts) == 2:
                            _fp, _b64 = _parts
                            _fname = os.path.basename(_fp.strip())
                            _b64 = _b64.strip()
                            if _fname and _b64 and len(_b64) > 10:
                                _mime = _fp.rsplit(".", 1)[-1].strip()
                                yield sse_event("file_generated", {"name": _fname, "base64": _b64, "mime": _mime})
                                # Clean up sandbox file
                                try:
                                    await sandbox.commands.run(f"rm -f {_fp.strip()}")
                                except:
                                    pass
                                logger.log(f"[file_gen] emitted {_fname} ({len(_b64)} b64 chars)")
            except Exception as _e:
                logger.error(f"[file_gen] scan failed for .{_ext}: {_e}")

    yield sse_event("done", {"stopped": stopped})
