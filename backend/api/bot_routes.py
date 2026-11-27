"""Bot Integration API Routes - Manage Telegram/Discord bot configurations"""
import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from database.connection import get_db
from services.bot_service import (
    get_bot_config,
    get_all_bot_configs,
    save_bot_config,
    get_decrypted_bot_token,
    update_bot_status,
    delete_bot_config,
)
from services.telegram_bot_service import (
    validate_telegram_token,
    setup_telegram_webhook,
    remove_telegram_webhook,
    send_telegram_message,
)
from services.discord_bot_service import (
    validate_discord_token,
    start_discord_gateway,
    stop_discord_gateway,
    send_discord_message_via_client,
    is_discord_client_running,
)

router = APIRouter(prefix="/api/bot", tags=["Bot Integration"])


class BotConfigRequest(BaseModel):
    platform: str  # telegram / discord / whatsapp / wechat / etc.
    bot_token: str
    bot_username: Optional[str] = None
    bot_app_id: Optional[str] = None


class BotStatusRequest(BaseModel):
    platform: str
    status: str  # disconnected / connecting / connected / error
    error_message: Optional[str] = None


@router.get("/configs")
def list_bot_configs(db: Session = Depends(get_db)):
    """List all bot configurations."""
    return {"configs": get_all_bot_configs(db)}


@router.get("/config/{platform}")
def get_bot_config_endpoint(platform: str, db: Session = Depends(get_db)):
    """Get bot configuration for a specific platform."""
    config = get_bot_config(db, platform)
    if not config:
        return {"config": None, "configured": False}
    return {"config": config, "configured": True}


@router.post("/config")
def save_bot_config_endpoint(request: BotConfigRequest, db: Session = Depends(get_db)):
    """Save or update bot configuration."""
    # Validate platform - allow known platforms (new platforms should be added here)
    known_platforms = ["telegram", "discord", "whatsapp", "wechat"]
    if request.platform not in known_platforms:
        raise HTTPException(status_code=400, detail=f"Invalid platform. Must be one of: {', '.join(known_platforms)}")

    if not request.bot_token:
        raise HTTPException(status_code=400, detail="Bot token is required")

    config = save_bot_config(
        db=db,
        platform=request.platform,
        bot_token=request.bot_token,
        bot_username=request.bot_username,
        bot_app_id=request.bot_app_id,
    )
    return {"success": True, "config": config}


@router.put("/status")
def update_bot_status_endpoint(request: BotStatusRequest, db: Session = Depends(get_db)):
    """Update bot connection status."""
    success = update_bot_status(
        db=db,
        platform=request.platform,
        status=request.status,
        error_message=request.error_message,
    )
    if not success:
        raise HTTPException(status_code=404, detail=f"Bot config for {request.platform} not found")
    return {"success": True}


@router.delete("/config/{platform}")
def delete_bot_config_endpoint(platform: str, db: Session = Depends(get_db)):
    """Delete bot configuration."""
    success = delete_bot_config(db, platform)
    if not success:
        raise HTTPException(status_code=404, detail=f"Bot config for {platform} not found")
    return {"success": True}


# ============================================================================
# Notification Configuration
# ============================================================================

NOTIFICATION_CONFIG_KEY = "bot_notification_config"
DEFAULT_NOTIFICATION_CONFIG = {
    "ai_trader": True,
    "program_trader": True,
    "signal_pools": {}  # pool_id -> bool, default all False
}


class NotificationConfigRequest(BaseModel):
    ai_trader: bool = True
    program_trader: bool = True
    signal_pools: dict = {}  # {"pool_id": true/false}


@router.get("/notification-config")
def get_notification_config(db: Session = Depends(get_db)):
    """Get bot push notification configuration."""
    from database.models import SystemConfig
    config = db.query(SystemConfig).filter(
        SystemConfig.key == NOTIFICATION_CONFIG_KEY
    ).first()
    if not config:
        return {"config": DEFAULT_NOTIFICATION_CONFIG}
    try:
        return {"config": json.loads(config.value)}
    except json.JSONDecodeError:
        return {"config": DEFAULT_NOTIFICATION_CONFIG}


@router.put("/notification-config")
def update_notification_config(
    request: NotificationConfigRequest,
    db: Session = Depends(get_db)
):
    """Update bot push notification configuration."""
    from database.models import SystemConfig
    config_data = {
        "ai_trader": request.ai_trader,
        "program_trader": request.program_trader,
        "signal_pools": request.signal_pools,
    }
    config = db.query(SystemConfig).filter(
        SystemConfig.key == NOTIFICATION_CONFIG_KEY
    ).first()
    if config:
        config.value = json.dumps(config_data)
    else:
        config = SystemConfig(
            key=NOTIFICATION_CONFIG_KEY,
            value=json.dumps(config_data)
        )
        db.add(config)
    db.commit()
    return {"success": True, "config": config_data}


def get_notification_config_dict(db: Session) -> dict:
    """Helper function to get notification config as dict (for use in hooks)."""
    from database.models import SystemConfig
    config = db.query(SystemConfig).filter(
        SystemConfig.key == NOTIFICATION_CONFIG_KEY
    ).first()
    if not config:
        return DEFAULT_NOTIFICATION_CONFIG.copy()
    try:
        return json.loads(config.value)
    except json.JSONDecodeError:
        return DEFAULT_NOTIFICATION_CONFIG.copy()


# ============================================================================
# Tool name mapping for Telegram progress messages
# ============================================================================

TOOL_LABELS = {
    "get_system_overview":    {"en": "Checking system status",      "zh": "正在检查系统状态"},
    "get_wallet_status":      {"en": "Querying wallet balances",    "zh": "正在查询钱包余额"},
    "get_klines":             {"en": "Fetching K-line data",        "zh": "正在获取K线数据"},
    "get_market_regime":      {"en": "Analyzing market regime",     "zh": "正在分析市场状态"},
    "get_market_flow":        {"en": "Analyzing market flow",       "zh": "正在分析资金流向"},
    "get_system_logs":        {"en": "Reading system logs",         "zh": "正在读取系统日志"},
    "get_api_reference":      {"en": "Loading API reference",       "zh": "正在加载API文档"},
    "get_contact_config":     {"en": "Loading contact info",        "zh": "正在加载联系方式"},
    "get_trading_environment":{"en": "Getting trading environment", "zh": "正在获取交易环境"},
    "get_watchlist":          {"en": "Getting watchlist",           "zh": "正在获取监控列表"},
    "update_watchlist":       {"en": "Updating watchlist",          "zh": "正在更新监控列表"},
    "diagnose_trader_issues": {"en": "Diagnosing trader issues",    "zh": "正在诊断交易员问题"},
    "list_traders":           {"en": "Listing AI traders",          "zh": "正在列出AI交易员"},
    "list_signal_pools":      {"en": "Listing signal pools",        "zh": "正在列出信号池"},
    "list_strategies":        {"en": "Listing strategies",          "zh": "正在列出策略"},
    "save_signal_pool":       {"en": "Saving signal pool",          "zh": "正在保存信号池"},
    "save_prompt":            {"en": "Saving prompt strategy",      "zh": "正在保存提示词策略"},
    "save_program":           {"en": "Saving program strategy",     "zh": "正在保存程序化策略"},
    "create_ai_trader":       {"en": "Creating AI trader",          "zh": "正在创建AI交易员"},
    "update_ai_trader":       {"en": "Updating AI trader",          "zh": "正在更新AI交易员"},
    "bind_prompt_to_trader":  {"en": "Binding prompt to trader",    "zh": "正在绑定提示词到交易员"},
    "bind_program_to_trader": {"en": "Binding program to trader",   "zh": "正在绑定程序到交易员"},
    "update_trader_strategy": {"en": "Updating trader strategy",    "zh": "正在更新交易员策略"},
    "update_program_binding": {"en": "Updating program binding",    "zh": "正在更新程序绑定"},
    "update_signal_pool":     {"en": "Updating signal pool",        "zh": "正在更新信号池"},
    "update_prompt_binding":  {"en": "Updating prompt binding",     "zh": "正在更新提示词绑定"},
    "delete_trader":          {"en": "Deleting trader",             "zh": "正在删除交易员"},
    "delete_prompt_template": {"en": "Deleting prompt template",    "zh": "正在删除提示词模板"},
    "delete_signal_definition":{"en": "Deleting signal definition", "zh": "正在删除信号定义"},
    "delete_signal_pool":     {"en": "Deleting signal pool",        "zh": "正在删除信号池"},
    "delete_trading_program": {"en": "Deleting trading program",    "zh": "正在删除交易程序"},
    "delete_prompt_binding":  {"en": "Deleting prompt binding",     "zh": "正在删除提示词绑定"},
    "delete_program_binding": {"en": "Deleting program binding",    "zh": "正在删除程序绑定"},
    "load_skill":             {"en": "Loading skill module",        "zh": "正在加载技能模块"},
    "load_skill_reference":   {"en": "Loading skill reference",     "zh": "正在加载技能参考"},
    "save_memory":            {"en": "Saving memory",               "zh": "正在保存记忆"},
    "call_prompt_ai":         {"en": "Running prompt AI analysis",  "zh": "正在运行提示词AI分析"},
    "call_program_ai":        {"en": "Running program AI analysis", "zh": "正在运行程序AI分析"},
    "call_signal_ai":         {"en": "Running signal AI analysis",  "zh": "正在运行信号AI分析"},
    "call_attribution_ai":    {"en": "Running trade attribution",   "zh": "正在运行交易归因分析"},
}


def _get_ui_language(db_session) -> str:
    """Get UI language from SystemConfig, default to 'en'."""
    from database.models import SystemConfig
    config = db_session.query(SystemConfig).filter(
        SystemConfig.key == "ui_language"
    ).first()
    return config.value if config and config.value in ("en", "zh") else "en"


def _get_tool_label(tool_name: str, lang: str) -> str:
    """Get user-friendly tool label in the specified language."""
    labels = TOOL_LABELS.get(tool_name)
    if labels:
        return labels.get(lang, labels["en"])
    # Fallback: humanize the function name
    return tool_name.replace("_", " ").title()


# ============================================================================
# Telegram-specific endpoints
# ============================================================================

class TelegramConnectRequest(BaseModel):
    bot_token: str


@router.post("/telegram/connect")
async def connect_telegram_bot(
    request: TelegramConnectRequest,
    db: Session = Depends(get_db)
):
    """Validate token, save config, and start Long Polling for Telegram bot."""
    # Validate new token first
    result = await validate_telegram_token(request.bot_token)
    if not result["valid"]:
        raise HTTPException(status_code=400, detail=f"Invalid bot token: {result.get('error')}")

    # If rebinding: stop old polling and remove webhook
    old_token = get_decrypted_bot_token(db, "telegram")
    if old_token and old_token != request.bot_token:
        try:
            from services.telegram_bot_service import stop_telegram_polling
            await stop_telegram_polling()
            await remove_telegram_webhook(old_token)
        except Exception:
            pass  # Old token may be invalid, that's fine

    # Save config (creates or updates)
    save_bot_config(
        db=db,
        platform="telegram",
        bot_token=request.bot_token,
        bot_username=result.get("username"),
        bot_app_id=result.get("bot_id"),
    )

    # Start Long Polling mode (no HTTPS/public URL required)
    from services.telegram_bot_service import start_telegram_polling
    polling_result = await start_telegram_polling(request.bot_token)
    if not polling_result["success"]:
        update_bot_status(db, "telegram", "error", polling_result.get("error"))
        raise HTTPException(status_code=500, detail=f"Failed to start polling: {polling_result.get('error')}")

    update_bot_status(db, "telegram", "connected")

    # Register Telegram adapter
    from services.telegram_bot_service import get_telegram_adapter
    from services.bot_adapter import register_adapter
    adapter = get_telegram_adapter()
    await adapter.start(request.bot_token)
    register_adapter(adapter)

    # Create or get the shared Bot conversation (one per user, shared across platforms)
    from database.models import HyperAiConversation
    bot_conv = db.query(HyperAiConversation).filter(
        HyperAiConversation.is_bot_conversation == True
    ).first()
    if not bot_conv:
        bot_conv = HyperAiConversation(
            title="Hyper AI Bot",
            is_bot_conversation=True
        )
        db.add(bot_conv)
        db.commit()
        db.refresh(bot_conv)

    return {
        "success": True,
        "bot_username": result.get("username"),
        "mode": "polling",
        "conversation_id": bot_conv.id,
    }


@router.post("/telegram/disconnect")
async def disconnect_telegram_bot(db: Session = Depends(get_db)):
    """Stop polling and disconnect Telegram bot."""
    token = get_decrypted_bot_token(db, "telegram")
    if not token:
        raise HTTPException(status_code=404, detail="Telegram bot not configured")

    # Stop polling and remove webhook
    from services.telegram_bot_service import stop_telegram_polling
    await stop_telegram_polling()
    await remove_telegram_webhook(token)

    update_bot_status(db, "telegram", "disconnected")
    return {"success": True}


@router.post("/telegram/retry-webhook")
async def retry_telegram_connection(
    db: Session = Depends(get_db)
):
    """Retry connection for an already-configured Telegram bot."""
    token = get_decrypted_bot_token(db, "telegram")
    if not token:
        raise HTTPException(status_code=404, detail="Telegram bot not configured")

    # Start polling mode
    from services.telegram_bot_service import start_telegram_polling
    polling_result = await start_telegram_polling(token)
    if not polling_result["success"]:
        update_bot_status(db, "telegram", "error", polling_result.get("error"))
        raise HTTPException(status_code=500, detail=f"Failed to start polling: {polling_result.get('error')}")

    update_bot_status(db, "telegram", "connected")
    return {"success": True}


@router.post("/telegram/webhook")
async def telegram_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Receive incoming updates from Telegram.
    This is called by Telegram servers when a user sends a message to the bot.
    """
    try:
        update = await request.json()
    except Exception:
        return {"ok": True}  # Return ok to avoid Telegram retries

    # Extract message if present
    message = update.get("message") or update.get("edited_message")
    if not message:
        return {"ok": True}

    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "")
    user = message.get("from", {})

    if not chat_id or not text:
        return {"ok": True}

    # Get bot token
    token = get_decrypted_bot_token(db, "telegram")
    if not token:
        return {"ok": True}

    # Process message with Hyper AI (async, non-blocking)
    asyncio.create_task(
        _process_telegram_message(token, chat_id, text, user, db)
    )
    print(f"[TG-WEBHOOK] Dispatched task for chat_id={chat_id} text={text[:50]}", flush=True)

    return {"ok": True}


async def _process_telegram_message(
    token: str,
    chat_id: int,
    text: str,
    user: dict,
    db: Session
):
    """
    Process a Telegram message through Hyper AI and send response.
    Runs as a background task to avoid blocking the webhook response.
    Reply unicast: response only goes to the originating chat_id.
    """
    from services.hyper_ai_service import (
        get_or_create_conversation,
        stream_chat_response,
    )
    from database.models import HyperAiConversation, BotChatBinding
    from database.connection import SessionLocal
    from sqlalchemy import func

    # Use a new db session for async context
    db_session = SessionLocal()
    try:
        # Record chat binding for push broadcast
        binding = db_session.query(BotChatBinding).filter(
            BotChatBinding.platform == "telegram",
            BotChatBinding.chat_id == str(chat_id)
        ).first()
        if not binding:
            binding = BotChatBinding(
                platform="telegram",
                chat_id=str(chat_id),
                username=user.get("username"),
                display_name=user.get("first_name", "") + " " + user.get("last_name", "")
            )
            db_session.add(binding)
        else:
            binding.last_message_at = func.current_timestamp()
            binding.is_active = True
        db_session.commit()

        # Find the shared Bot conversation (shared across all platforms)
        conv = db_session.query(HyperAiConversation).filter(
            HyperAiConversation.is_bot_conversation == True
        ).first()

        if not conv:
            # Fallback: create one if not exists (shouldn't happen normally)
            conv = HyperAiConversation(
                title="Hyper AI Bot",
                is_bot_conversation=True
            )
            db_session.add(conv)
            db_session.commit()
            db_session.refresh(conv)

        print(f"[TG-PROCESS] Using conv id={conv.id}, processing text: {text[:50]}", flush=True)

        # Determine UI language for tool progress messages
        lang = _get_ui_language(db_session)

        # Run synchronous AI processing in a thread to avoid blocking event loop
        def process_ai_sync():
            """Synchronous AI processing - runs in thread pool."""
            events = []
            for event in stream_chat_response(db_session, conv.id, text):
                events.append(event)
            return events

        import asyncio
        loop = asyncio.get_event_loop()
        events = await loop.run_in_executor(None, process_ai_sync)

        # Process events and collect response
        full_response = ""
        tool_calls = []
        for event in events:
            event_type = None
            data_str = None
            for line in event.split("\n"):
                if line.startswith("event: "):
                    event_type = line[7:].strip()
                elif line.startswith("data: "):
                    data_str = line[6:]

            if not data_str:
                continue
            try:
                data = json.loads(data_str)
                if event_type == "tool_call" and data.get("name"):
                    tool_calls.append(data["name"])
                elif event_type == "content":
                    full_response += data.get("text", "")
                elif event_type == "error":
                    full_response = f"Error: {data.get('message', 'Unknown error')}"
            except json.JSONDecodeError:
                pass

        # Send tool call progress (combined into one message)
        if tool_calls:
            labels = [_get_tool_label(name, lang) for name in tool_calls[:5]]
            if len(tool_calls) > 5:
                labels.append(f"...+{len(tool_calls) - 5} more")
            progress_msg = "【🤖Hyper AI】" + " → ".join(labels)
            await send_telegram_message(token, chat_id, progress_msg)

        print(f"[TG-PROCESS] AI response length={len(full_response)}", flush=True)

        # Send response back to Telegram
        if full_response:
            result = await send_telegram_message(token, chat_id, full_response)
            print(f"[TG-PROCESS] Send result={result}", flush=True)

    except Exception as e:
        import logging
        print(f"[TG-PROCESS] ERROR: {type(e).__name__}: {e}", flush=True)
        logging.getLogger(__name__).error(f"Telegram message processing failed: {e}")
        # Try to send error message
        try:
            await send_telegram_message(token, chat_id, "Sorry, an error occurred while processing your message.")
        except Exception:
            pass
    finally:
        db_session.close()


# ============================================================================
# Discord-specific endpoints
# ============================================================================

class DiscordConnectRequest(BaseModel):
    bot_token: str


@router.post("/discord/connect")
async def connect_discord_bot(
    request: DiscordConnectRequest,
    db: Session = Depends(get_db)
):
    """
    Validate token, save config, and start Gateway client for Discord bot.
    Unlike Telegram (webhook-based), Discord uses persistent Gateway connection.
    """
    # Validate token first
    result = await validate_discord_token(request.bot_token)
    if not result["valid"]:
        raise HTTPException(status_code=400, detail=f"Invalid bot token: {result.get('error')}")

    # Save config (creates or updates)
    save_bot_config(
        db=db,
        platform="discord",
        bot_token=request.bot_token,
        bot_username=result.get("username"),
        bot_app_id=result.get("bot_id"),
    )

    update_bot_status(db, "discord", "connected")

    # Register Discord adapter
    from services.discord_bot_service import get_discord_adapter
    from services.bot_adapter import register_adapter
    adapter = get_discord_adapter()
    await adapter.start(request.bot_token)
    register_adapter(adapter)

    # Create or get the shared Bot conversation (one per user, shared across platforms)
    from database.models import HyperAiConversation
    bot_conv = db.query(HyperAiConversation).filter(
        HyperAiConversation.is_bot_conversation == True
    ).first()
    if not bot_conv:
        bot_conv = HyperAiConversation(
            title="Hyper AI Bot",
            is_bot_conversation=True
        )
        db.add(bot_conv)
        db.commit()
        db.refresh(bot_conv)

    # Start Gateway client in background
    asyncio.create_task(_start_discord_gateway_background(request.bot_token))

    return {
        "success": True,
        "bot_username": result.get("username"),
        "conversation_id": bot_conv.id,
    }


async def _start_discord_gateway_background(token: str):
    """Start Discord Gateway in background with message handler."""
    async def handle_discord_message(user_id: int, username: str, display_name: str, text: str) -> str:
        """Process Discord DM through Hyper AI."""
        return await _process_discord_message_internal(user_id, username, display_name, text)

    try:
        await start_discord_gateway(token, handle_discord_message)
    except Exception as e:
        print(f"[Discord] Gateway startup failed: {e}", flush=True)


async def _process_discord_message_internal(
    user_id: int,
    username: str,
    display_name: str,
    text: str
) -> str:
    """
    Process a Discord DM through Hyper AI and return response.
    Similar to _process_telegram_message but returns string instead of sending directly.
    """
    from services.hyper_ai_service import stream_chat_response
    from database.models import HyperAiConversation, BotChatBinding
    from database.connection import SessionLocal
    from sqlalchemy import func

    db_session = SessionLocal()
    try:
        # Record chat binding for push broadcast
        binding = db_session.query(BotChatBinding).filter(
            BotChatBinding.platform == "discord",
            BotChatBinding.chat_id == str(user_id)
        ).first()
        if not binding:
            binding = BotChatBinding(
                platform="discord",
                chat_id=str(user_id),
                username=username,
                display_name=display_name
            )
            db_session.add(binding)
        else:
            binding.last_message_at = func.current_timestamp()
            binding.is_active = True
        db_session.commit()

        # Find the shared Bot conversation
        conv = db_session.query(HyperAiConversation).filter(
            HyperAiConversation.is_bot_conversation == True
        ).first()

        if not conv:
            conv = HyperAiConversation(
                title="Hyper AI Bot",
                is_bot_conversation=True
            )
            db_session.add(conv)
            db_session.commit()
            db_session.refresh(conv)

        print(f"[Discord] Using conv id={conv.id}, processing text: {text[:50]}", flush=True)

        # Determine UI language for tool progress messages
        lang = _get_ui_language(db_session)

        # Stream AI response in a thread pool while sending tool progress in real-time.
        # See telegram_bot_service.py _process_polling_message for detailed explanation.
        import asyncio
        loop = asyncio.get_event_loop()

        def process_ai_sync():
            full_resp = ""
            for event in stream_chat_response(db_session, conv.id, text):
                event_type = None
                data_str = None
                for line in event.split("\n"):
                    if line.startswith("event: "):
                        event_type = line[7:].strip()
                    elif line.startswith("data: "):
                        data_str = line[6:]
                if not data_str:
                    continue
                try:
                    data = json.loads(data_str)
                    if event_type == "tool_call" and data.get("name"):
                        label = _get_tool_label(data["name"], lang)
                        msg = f"【🤖Hyper AI】{label}..."
                        asyncio.run_coroutine_threadsafe(
                            send_discord_message_via_client(user_id, msg), loop
                        )
                    elif event_type == "content":
                        full_resp += data.get("text", "")
                    elif event_type == "error":
                        full_resp = f"Error: {data.get('message', 'Unknown error')}"
                except json.JSONDecodeError:
                    pass
            return full_resp

        full_response = await loop.run_in_executor(None, process_ai_sync)

        print(f"[Discord] AI response length={len(full_response)}", flush=True)
        return full_response

    except Exception as e:
        print(f"[Discord] ERROR: {type(e).__name__}: {e}", flush=True)
        return "Sorry, an error occurred while processing your message."
    finally:
        db_session.close()


@router.post("/discord/disconnect")
async def disconnect_discord_bot(db: Session = Depends(get_db)):
    """Stop Gateway client and disconnect Discord bot."""
    token = get_decrypted_bot_token(db, "discord")
    if not token:
        raise HTTPException(status_code=404, detail="Discord bot not configured")

    await stop_discord_gateway()
    update_bot_status(db, "discord", "disconnected")
    return {"success": True}


@router.get("/discord/status")
def get_discord_status(db: Session = Depends(get_db)):
    """Get Discord bot connection status including Gateway state."""
    config = get_bot_config(db, "discord")
    gateway_running = is_discord_client_running()
    return {
        "config": config,
        "gateway_running": gateway_running,
    }
