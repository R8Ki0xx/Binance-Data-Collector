"""
Telegram Bot Service - Handle Telegram bot lifecycle and message routing.

Architecture:
- Uses python-telegram-bot library (async)
- Uses Long Polling mode (no public HTTPS required, works on localhost)
- Routes messages to Hyper AI service for processing
- Sends AI responses back to Telegram chat
"""
import asyncio
import logging
import re
from typing import Optional

from sqlalchemy.orm import Session

from database.connection import SessionLocal
from database.models import BotConfig, HyperAiConversation
from services.bot_service import get_decrypted_bot_token, update_bot_status

logger = logging.getLogger(__name__)

# Global bot application instance
_telegram_app = None
_polling_task = None
_polling_stop_event = None


def _get_telegram_bot():
    """Lazy import telegram to avoid startup errors if not installed."""
    try:
        from telegram import Bot
        return Bot
    except ImportError:
        logger.warning("python-telegram-bot not installed")
        return None


async def validate_telegram_token(token: str) -> dict:
    """Validate a Telegram bot token by calling getMe."""
    Bot = _get_telegram_bot()
    if not Bot:
        return {"valid": False, "error": "python-telegram-bot not installed"}

    try:
        bot = Bot(token=token)
        me = await bot.get_me()
        return {
            "valid": True,
            "username": me.username,
            "bot_id": str(me.id),
        }
    except Exception as e:
        return {"valid": False, "error": str(e)}


async def setup_telegram_webhook(token: str, webhook_url: str) -> dict:
    """Set webhook URL for the Telegram bot. (Legacy - kept for compatibility)"""
    Bot = _get_telegram_bot()
    if not Bot:
        return {"success": False, "error": "python-telegram-bot not installed"}

    try:
        bot = Bot(token=token)
        await bot.set_webhook(url=webhook_url)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def remove_telegram_webhook(token: str) -> dict:
    """Remove webhook for the Telegram bot."""
    Bot = _get_telegram_bot()
    if not Bot:
        return {"success": False, "error": "python-telegram-bot not installed"}

    try:
        bot = Bot(token=token)
        await bot.delete_webhook(drop_pending_updates=True)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _strip_markdown(text: str) -> str:
    """Strip Markdown formatting to produce clean plain text."""
    text = re.sub(r'```[\s\S]*?```', lambda m: m.group(0).strip('`').strip(), text)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'__(.+?)__', r'\1', text)
    text = re.sub(r'(?<!\w)\*(.+?)\*(?!\w)', r'\1', text)
    text = re.sub(r'(?<!\w)_(.+?)_(?!\w)', r'\1', text)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    return text


async def _send_single_message(bot, chat_id: int, text: str, use_html: bool = False):
    """Send a single message with HTML or fallback to plain text."""
    try:
        if use_html:
            await bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")
        else:
            await bot.send_message(chat_id=chat_id, text=text, parse_mode="Markdown")
    except Exception as e:
        logger.warning(f"[Telegram] HTML/Markdown parse failed, falling back to plain text: {e}")
        print(f"[Telegram] Parse failed: {e}, text preview: {text[:200]}", flush=True)
        plain = _strip_markdown(text)
        await bot.send_message(chat_id=chat_id, text=plain)


async def send_telegram_message(token: str, chat_id: int, text: str) -> bool:
    """Send a message to a Telegram chat with proper formatting."""
    Bot = _get_telegram_bot()
    if not Bot:
        return False

    try:
        from services.message_formatter import format_for_telegram
        bot = Bot(token=token)

        # Convert Markdown to Telegram HTML and chunk
        chunks = format_for_telegram(text)
        print(f"[Telegram] Sending {len(chunks)} chunks, first chunk preview: {chunks[0][:150] if chunks else 'empty'}...", flush=True)

        for i, chunk in enumerate(chunks):
            print(f"[Telegram] Sending chunk {i+1}/{len(chunks)}, length={len(chunk)}", flush=True)
            await _send_single_message(bot, chat_id, chunk, use_html=True)

        return True
    except Exception as e:
        logger.error(f"Failed to send Telegram message: {e}")
        print(f"[Telegram] Send error: {e}", flush=True)
        return False


async def restore_telegram_webhook():
    """Restore Telegram bot on startup using Long Polling mode."""
    db = SessionLocal()
    try:
        config = db.query(BotConfig).filter(
            BotConfig.platform == "telegram",
            BotConfig.status == "connected"
        ).first()
        if not config or not config.bot_token_encrypted:
            return

        from services.bot_service import get_decrypted_bot_token
        token = get_decrypted_bot_token(db, "telegram")
        if not token:
            return

        # Start polling mode instead of webhook
        result = await start_telegram_polling(token)
        if result["success"]:
            print(f"[startup] Telegram polling started for @{config.bot_username}", flush=True)
        else:
            print(f"[startup] Telegram polling failed: {result.get('error')}", flush=True)
            from services.bot_service import update_bot_status
            update_bot_status(db, "telegram", "error", result.get("error"))
    except Exception as e:
        print(f"[startup] Telegram restore error: {e}", flush=True)
    finally:
        db.close()


async def start_telegram_polling(token: str) -> dict:
    """
    Start Long Polling mode for Telegram bot.
    This allows the bot to work without public HTTPS/webhook.
    """
    global _polling_task, _polling_stop_event

    # Stop existing polling if any
    await stop_telegram_polling()

    try:
        from telegram import Update
        from telegram.ext import Application, MessageHandler, filters
    except ImportError:
        return {"success": False, "error": "python-telegram-bot not installed"}

    try:
        # First remove any existing webhook
        await remove_telegram_webhook(token)

        # Create stop event
        _polling_stop_event = asyncio.Event()

        # Start polling in background task
        _polling_task = asyncio.create_task(_run_polling_loop(token))

        print(f"[Telegram] Polling started", flush=True)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def stop_telegram_polling():
    """Stop the polling loop."""
    global _polling_task, _polling_stop_event

    if _polling_stop_event:
        _polling_stop_event.set()

    if _polling_task:
        _polling_task.cancel()
        try:
            await _polling_task
        except asyncio.CancelledError:
            pass
        _polling_task = None

    _polling_stop_event = None
    print(f"[Telegram] Polling stopped", flush=True)


async def _run_polling_loop(token: str):
    """
    Long polling loop - fetches updates from Telegram API.
    """
    global _polling_stop_event

    Bot = _get_telegram_bot()
    if not Bot:
        return

    bot = Bot(token=token)
    offset = 0

    print(f"[Telegram] Polling loop started", flush=True)

    while not (_polling_stop_event and _polling_stop_event.is_set()):
        try:
            updates = await bot.get_updates(
                offset=offset,
                timeout=30,
                allowed_updates=["message"]
            )

            for update in updates:
                offset = update.update_id + 1

                # Process message
                message = update.message
                if message and message.text:
                    chat_id = message.chat.id
                    text = message.text
                    user = {
                        "id": message.from_user.id if message.from_user else None,
                        "username": message.from_user.username if message.from_user else None,
                        "first_name": message.from_user.first_name if message.from_user else "",
                        "last_name": message.from_user.last_name if message.from_user else "",
                    }

                    print(f"[TG-POLL] Received from {chat_id}: {text[:50]}", flush=True)

                    # Process message async (don't block polling)
                    asyncio.create_task(
                        _process_polling_message(token, chat_id, text, user)
                    )

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Telegram] Polling error: {e}", flush=True)
            # Wait before retry on error
            await asyncio.sleep(5)

    print(f"[Telegram] Polling loop ended", flush=True)


async def _process_polling_message(token: str, chat_id: int, text: str, user: dict):
    """
    Process a message received via polling.
    Reuses the same logic as webhook processing.
    """
    from services.hyper_ai_service import stream_chat_response
    from database.models import HyperAiConversation, BotChatBinding, SystemConfig
    from database.connection import SessionLocal
    from sqlalchemy import func
    import json

    # Tool labels for progress messages
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

    def get_tool_label(tool_name: str, lang: str) -> str:
        labels = TOOL_LABELS.get(tool_name)
        if labels:
            return labels.get(lang, labels["en"])
        return tool_name.replace("_", " ").title()

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
                display_name=(user.get("first_name", "") + " " + user.get("last_name", "")).strip()
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

        print(f"[TG-POLL] Processing with conv id={conv.id}", flush=True)

        # Get UI language for tool progress messages
        lang_config = db_session.query(SystemConfig).filter(
            SystemConfig.key == "ui_language"
        ).first()
        lang = lang_config.value if lang_config and lang_config.value in ("en", "zh") else "en"

        # Stream AI response in a thread pool while sending tool progress in real-time.
        #
        # Why run_in_executor + run_coroutine_threadsafe:
        #   stream_chat_response() is a synchronous generator that blocks while
        #   waiting for LLM responses. Running it directly in the async event loop
        #   would block all other coroutines (e.g. Telegram polling, Discord gateway).
        #   So we run the generator in a thread via run_in_executor.
        #
        #   But we still want to send tool_call progress messages to the user
        #   *immediately* as they happen (not batched at the end), so inside the
        #   thread we use run_coroutine_threadsafe to schedule the async send back
        #   onto the event loop without waiting for the entire stream to finish.
        #
        # History: commit 32525bf (2026-03-02) moved processing into run_in_executor
        # but collected all events first then sent progress at the end, which broke
        # real-time progress. This version restores real-time sending.
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
                        label = get_tool_label(data["name"], lang)
                        msg = f"【🤖Hyper AI】{label}..."
                        asyncio.run_coroutine_threadsafe(
                            send_telegram_message(token, chat_id, msg), loop
                        )
                    elif event_type == "content":
                        full_resp += data.get("text", "")
                    elif event_type == "error":
                        full_resp = f"Error: {data.get('message', 'Unknown error')}"
                except json.JSONDecodeError:
                    pass
            return full_resp

        full_response = await loop.run_in_executor(None, process_ai_sync)

        print(f"[TG-POLL] AI response length={len(full_response)}", flush=True)

        if full_response:
            await send_telegram_message(token, chat_id, full_response)

    except Exception as e:
        print(f"[TG-POLL] ERROR: {type(e).__name__}: {e}", flush=True)
    finally:
        db_session.close()


# ============================================================================
# Telegram Bot Adapter (implements BotAdapter interface)
# ============================================================================
class TelegramAdapter:
    """Telegram bot adapter implementing the unified BotAdapter interface."""

    def __init__(self):
        self._token: Optional[str] = None
        self._ready: bool = False

    @property
    def platform(self) -> str:
        return "telegram"

    def is_ready(self) -> bool:
        return self._ready and self._token is not None

    async def send_message(self, chat_id: str, content: str) -> bool:
        """Send message to Telegram chat."""
        if not self._token:
            return False
        return await send_telegram_message(self._token, int(chat_id), content)

    async def start(self, token: str) -> bool:
        """Start the adapter with the given token."""
        self._token = token
        self._ready = True
        logger.info(f"[TelegramAdapter] Started")
        return True

    async def stop(self) -> None:
        """Stop the adapter."""
        self._ready = False
        self._token = None
        logger.info(f"[TelegramAdapter] Stopped")


# Global adapter instance
_telegram_adapter: Optional[TelegramAdapter] = None


def get_telegram_adapter() -> TelegramAdapter:
    """Get or create the global Telegram adapter instance."""
    global _telegram_adapter
    if _telegram_adapter is None:
        _telegram_adapter = TelegramAdapter()
    return _telegram_adapter
