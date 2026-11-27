"""
Hyper AI Sub-agents - Tools for calling specialized AI assistants

Each sub-agent reuses existing AI assistant's conversation system:
- call_prompt_ai: Prompt AI for trading prompt generation/optimization
- call_program_ai: Program AI for strategy code writing
- call_signal_ai: Signal AI for signal pool configuration
- call_attribution_ai: Attribution AI for trade analysis

Sub-agents maintain their own conversation history in their respective tables.
Hyper AI passes conversation_id to continue previous sessions.

ARCHITECTURE NOTE: Sub-agent execution returns a Generator, not a string.
The generator yields subagent_progress SSE events (forwarded to frontend via
StreamBufferManager for real-time progress display), and finally yields a
subagent_result event containing the final JSON string for the main LLM.
See ai_stream_service.py module docstring for the full buffer/polling architecture.
"""

import json
import logging
import time
from typing import Dict, Any, Generator, Optional

from sqlalchemy.orm import Session

from services.ai_stream_service import format_sse_event

# Human-readable names for sub-agents (used in progress events sent to frontend)
SUBAGENT_DISPLAY_NAMES = {
    "call_prompt_ai": "Prompt AI",
    "call_program_ai": "Program AI",
    "call_signal_ai": "Signal AI",
    "call_attribution_ai": "Attribution AI",
}

logger = logging.getLogger(__name__)


# Sub-agent tool definitions in OpenAI format
# Note: Sub-agents inherit Hyper AI's LLM configuration, no account_id needed
SUBAGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "call_prompt_ai",
            "description": """Call Prompt AI to generate or optimize trading prompts.
Use this when user wants to:
- Create a new trading prompt from scratch
- Optimize an existing prompt
- Add/modify variables in a prompt
- Validate prompt syntax

The sub-agent has access to variables reference and can preview prompts with real data.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Task description for Prompt AI"
                    },
                    "conversation_id": {
                        "type": "integer",
                        "description": "Optional: Continue a previous Prompt AI conversation"
                    },
                    "prompt_id": {
                        "type": "integer",
                        "description": "Optional: Prompt ID if editing existing prompt"
                    }
                },
                "required": ["task"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "call_program_ai",
            "description": """Call Program AI to write or modify trading strategy code.
Use this when user wants to:
- Create a new trading program/strategy
- Modify existing program code
- Debug or fix code issues
- Add new features to a program

The sub-agent can query market data, validate code, and run test executions.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Task description for Program AI"
                    },
                    "conversation_id": {
                        "type": "integer",
                        "description": "Optional: Continue a previous Program AI conversation"
                    },
                    "program_id": {
                        "type": "integer",
                        "description": "Optional: Program ID if editing existing program"
                    }
                },
                "required": ["task"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "call_signal_ai",
            "description": """Call Signal AI to configure signal pools.
Use this when user wants to:
- Create a new signal pool
- Modify signal pool configuration
- Add/remove signals from a pool
- Run signal backtest

The sub-agent can query available signals and run backtests.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Task description for Signal AI"
                    },
                    "conversation_id": {
                        "type": "integer",
                        "description": "Optional: Continue a previous Signal AI conversation"
                    }
                },
                "required": ["task"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "call_attribution_ai",
            "description": """Call Attribution AI to analyze trading performance.
Use this when user wants to:
- Analyze why a trade succeeded or failed
- Get performance attribution report
- Understand decision patterns
- Review historical trades

The sub-agent can query decision logs and provide detailed analysis.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Task description for Attribution AI"
                    },
                    "conversation_id": {
                        "type": "integer",
                        "description": "Optional: Continue a previous Attribution AI conversation"
                    }
                },
                "required": ["task"]
            }
        }
    }
]


def _run_subagent_stream(generator, subagent_name: str = "sub-agent") -> Generator[str, None, Dict[str, Any]]:
    """
    Run a sub-agent's streaming generator, yield progress events, and collect results.

    This is a GENERATOR that:
    1. Consumes the sub-agent's SSE stream event by event
    2. Yields subagent_progress SSE events for each meaningful step (tool_call, tool_round)
       - These events flow up through the main chat generator -> StreamBufferManager -> frontend
    3. Collects the final result internally (same as before)
    4. Returns the result dict via generator return value (accessed via StopIteration.value)

    The caller uses: result = yield from _run_subagent_stream(gen, name)
    """
    display_name = SUBAGENT_DISPLAY_NAMES.get(subagent_name, subagent_name)
    result = {
        "status": "failed",
        "content": "",
        "conversation_id": None,
        "message_id": None,
        "tool_calls": [],
        "error": None
    }

    try:
        for event_str in generator:
            # Skip empty strings
            if not event_str or not event_str.strip():
                continue

            event_type = None
            event_data = None

            # Check if this is standard SSE format: "event: xxx\ndata: {...}\n\n"
            if event_str.startswith("event: "):
                lines = event_str.strip().split("\n")
                for line in lines:
                    if line.startswith("event: "):
                        event_type = line[7:].strip()
                    elif line.startswith("data: "):
                        try:
                            event_data = json.loads(line[6:].strip())
                        except json.JSONDecodeError:
                            continue
            elif event_str.startswith("data: "):
                try:
                    event_data = json.loads(event_str[6:].strip())
                    event_type = event_data.get("type")
                except json.JSONDecodeError:
                    continue

            # Skip if we couldn't parse
            if not event_type or event_data is None:
                continue

            if event_type == "conversation_created":
                result["conversation_id"] = event_data.get("conversation_id")

            elif event_type == "reasoning":
                reasoning_text = event_data.get("content", "")
                if reasoning_text:
                    yield format_sse_event("subagent_progress", {
                        "subagent": display_name,
                        "step": "reasoning",
                        "content": reasoning_text[:200],
                    })

            elif event_type == "tool_call":
                tool_name = event_data.get("name", "")
                result["tool_calls"].append({
                    "name": tool_name,
                    "args": event_data.get("args") or event_data.get("arguments")
                })
                yield format_sse_event("subagent_progress", {
                    "subagent": display_name,
                    "step": "tool_call",
                    "tool": tool_name,
                    "tool_calls_count": len(result["tool_calls"]),
                })

            elif event_type == "tool_result":
                tool_name = event_data.get("name", "")
                yield format_sse_event("subagent_progress", {
                    "subagent": display_name,
                    "step": "tool_result",
                    "tool": tool_name,
                })

            elif event_type == "tool_round":
                yield format_sse_event("subagent_progress", {
                    "subagent": display_name,
                    "step": "tool_round",
                    "round": event_data.get("round"),
                    "max_rounds": event_data.get("max_rounds") or event_data.get("max"),
                })

            elif event_type == "content":
                result["content"] += event_data.get("content", "")

            elif event_type == "done":
                result["status"] = "success"
                result["content"] = event_data.get("content", result["content"])
                result["conversation_id"] = event_data.get("conversation_id", result["conversation_id"])
                result["message_id"] = event_data.get("message_id")
                break

            elif event_type == "error":
                result["status"] = "failed"
                result["error"] = event_data.get("content") or event_data.get("message", "Unknown error")
                break

            elif event_type == "interrupted":
                result["status"] = "interrupted"
                result["error"] = event_data.get("error", "Interrupted")
                result["message_id"] = event_data.get("message_id")
                break

    except Exception as e:
        result["status"] = "failed"
        result["error"] = str(e)
        logger.error(f"[_run_subagent_stream] Error: {e}")

    return result


def execute_call_prompt_ai(
    db: Session,
    task: str,
    conversation_id: Optional[int] = None,
    prompt_id: Optional[int] = None,
    user_id: int = 1
) -> Generator[str, None, str]:
    """
    Execute Prompt AI sub-agent. Returns a generator that yields progress
    SSE events and finally returns the result JSON string via StopIteration.value.
    """
    from services.ai_prompt_generation_service import generate_prompt_with_ai_stream
    from services.hyper_ai_service import get_llm_config

    logger.info(f"[call_prompt_ai] task={task[:50]}..., conv_id={conversation_id}, prompt_id={prompt_id}")

    try:
        llm_config = get_llm_config(db)
        if not llm_config.get("configured"):
            return json.dumps({
                "subagent": "prompt_ai",
                "status": "failed",
                "error": "Hyper AI LLM not configured."
            })

        generator = generate_prompt_with_ai_stream(
            db=db,
            user_message=task,
            conversation_id=conversation_id,
            prompt_id=prompt_id,
            user_id=user_id,
            llm_config=llm_config
        )

        result = yield from _run_subagent_stream(generator, "call_prompt_ai")

        return json.dumps({
            "subagent": "prompt_ai",
            "status": result["status"],
            "conversation_id": result["conversation_id"],
            "message_id": result["message_id"],
            "content": result["content"],
            "tool_calls_count": len(result["tool_calls"]),
            "error": result["error"]
        })

    except Exception as e:
        logger.error(f"[call_prompt_ai] Error: {e}")
        return json.dumps({"subagent": "prompt_ai", "status": "failed", "error": str(e)})


def execute_call_program_ai(
    db: Session,
    task: str,
    conversation_id: Optional[int] = None,
    program_id: Optional[int] = None,
    user_id: int = 1
) -> Generator[str, None, str]:
    """Execute Program AI sub-agent. Yields progress events, returns result JSON."""
    from services.ai_program_service import generate_program_with_ai_stream
    from services.hyper_ai_service import get_llm_config

    logger.info(f"[call_program_ai] task={task[:50]}..., conv_id={conversation_id}")

    try:
        llm_config = get_llm_config(db)
        if not llm_config.get("configured"):
            return json.dumps({
                "subagent": "program_ai",
                "status": "failed",
                "error": "Hyper AI LLM not configured."
            })

        generator = generate_program_with_ai_stream(
            db=db,
            user_message=task,
            conversation_id=conversation_id,
            program_id=program_id,
            user_id=user_id,
            llm_config=llm_config
        )

        result = yield from _run_subagent_stream(generator, "call_program_ai")

        return json.dumps({
            "subagent": "program_ai",
            "status": result["status"],
            "conversation_id": result["conversation_id"],
            "message_id": result["message_id"],
            "content": result["content"],
            "tool_calls_count": len(result["tool_calls"]),
            "error": result["error"]
        })

    except Exception as e:
        logger.error(f"[call_program_ai] Error: {e}")
        return json.dumps({"subagent": "program_ai", "status": "failed", "error": str(e)})


def execute_call_signal_ai(
    db: Session,
    task: str,
    conversation_id: Optional[int] = None,
    user_id: int = 1
) -> Generator[str, None, str]:
    """Execute Signal AI sub-agent. Yields progress events, returns result JSON."""
    from services.ai_signal_generation_service import generate_signal_with_ai_stream
    from services.hyper_ai_service import get_llm_config

    logger.info(f"[call_signal_ai] task={task[:50]}..., conv_id={conversation_id}")

    try:
        llm_config = get_llm_config(db)
        if not llm_config.get("configured"):
            return json.dumps({
                "subagent": "signal_ai",
                "status": "failed",
                "error": "Hyper AI LLM not configured."
            })

        generator = generate_signal_with_ai_stream(
            db=db,
            user_message=task,
            conversation_id=conversation_id,
            user_id=user_id,
            llm_config=llm_config
        )

        result = yield from _run_subagent_stream(generator, "call_signal_ai")

        return json.dumps({
            "subagent": "signal_ai",
            "status": result["status"],
            "conversation_id": result["conversation_id"],
            "message_id": result["message_id"],
            "content": result["content"],
            "tool_calls_count": len(result["tool_calls"]),
            "error": result["error"]
        })

    except Exception as e:
        logger.error(f"[call_signal_ai] Error: {e}")
        return json.dumps({"subagent": "signal_ai", "status": "failed", "error": str(e)})


def execute_call_attribution_ai(
    db: Session,
    task: str,
    conversation_id: Optional[int] = None,
    user_id: int = 1
) -> Generator[str, None, str]:
    """Execute Attribution AI sub-agent. Yields progress events, returns result JSON."""
    from services.ai_attribution_service import generate_attribution_analysis_stream
    from services.hyper_ai_service import get_llm_config

    logger.info(f"[call_attribution_ai] task={task[:50]}..., conv_id={conversation_id}")

    try:
        llm_config = get_llm_config(db)
        if not llm_config.get("configured"):
            return json.dumps({
                "subagent": "attribution_ai",
                "status": "failed",
                "error": "Hyper AI LLM not configured."
            })

        generator = generate_attribution_analysis_stream(
            db=db,
            user_message=task,
            conversation_id=conversation_id,
            user_id=user_id,
            llm_config=llm_config
        )

        result = yield from _run_subagent_stream(generator, "call_attribution_ai")

        return json.dumps({
            "subagent": "attribution_ai",
            "status": result["status"],
            "conversation_id": result["conversation_id"],
            "message_id": result["message_id"],
            "content": result["content"],
            "tool_calls_count": len(result["tool_calls"]),
            "error": result["error"]
        })

    except Exception as e:
        logger.error(f"[call_attribution_ai] Error: {e}")
        return json.dumps({"subagent": "attribution_ai", "status": "failed", "error": str(e)})


def execute_subagent_tool(
    db: Session,
    tool_name: str,
    arguments: Dict[str, Any],
    user_id: int = 1
) -> Generator[str, None, str]:
    """
    Execute a sub-agent tool by name. Returns a generator that yields
    subagent_progress SSE events and returns the final result JSON string.

    The caller in hyper_ai_service.py uses:
        gen = execute_subagent_tool(db, name, args)
        tool_result = yield from gen  # forwards progress events, gets result
    """
    try:
        if tool_name == "call_prompt_ai":
            return (yield from execute_call_prompt_ai(
                db,
                task=arguments.get("task", ""),
                conversation_id=arguments.get("conversation_id"),
                prompt_id=arguments.get("prompt_id"),
                user_id=user_id
            ))

        elif tool_name == "call_program_ai":
            return (yield from execute_call_program_ai(
                db,
                task=arguments.get("task", ""),
                conversation_id=arguments.get("conversation_id"),
                program_id=arguments.get("program_id"),
                user_id=user_id
            ))

        elif tool_name == "call_signal_ai":
            return (yield from execute_call_signal_ai(
                db,
                task=arguments.get("task", ""),
                conversation_id=arguments.get("conversation_id"),
                user_id=user_id
            ))

        elif tool_name == "call_attribution_ai":
            return (yield from execute_call_attribution_ai(
                db,
                task=arguments.get("task", ""),
                conversation_id=arguments.get("conversation_id"),
                user_id=user_id
            ))

        else:
            return json.dumps({"error": f"Unknown sub-agent tool: {tool_name}"})

    except Exception as e:
        logger.error(f"[execute_subagent_tool] Error executing {tool_name}: {e}")
        return json.dumps({"error": str(e)})

