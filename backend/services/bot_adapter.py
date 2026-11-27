"""Bot Adapter - Unified interface for multi-platform bot integration.

This module provides an adapter pattern for bot platforms (Telegram, Discord, WhatsApp, WeChat, etc.)
New platforms only need to implement the BotAdapter interface and register.
"""
from abc import ABC, abstractmethod
from typing import Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


class BotAdapter(ABC):
    """Abstract base class for bot platform adapters."""

    @property
    @abstractmethod
    def platform(self) -> str:
        """Return platform identifier (e.g., 'telegram', 'discord')."""
        pass

    @abstractmethod
    def is_ready(self) -> bool:
        """Check if the adapter is ready to send messages."""
        pass

    @abstractmethod
    async def send_message(self, chat_id: str, content: str) -> bool:
        """
        Send a message to a specific chat/user.

        Args:
            chat_id: Platform-specific chat/user identifier
            content: Message content to send

        Returns:
            True if message sent successfully, False otherwise
        """
        pass

    @abstractmethod
    async def start(self, token: str) -> bool:
        """
        Start the adapter with the given token.

        Args:
            token: Platform-specific bot token

        Returns:
            True if started successfully, False otherwise
        """
        pass

    @abstractmethod
    async def stop(self) -> None:
        """Stop the adapter and clean up resources."""
        pass


# Global adapter registry
_adapters: Dict[str, BotAdapter] = {}


def register_adapter(adapter: BotAdapter) -> None:
    """Register a bot adapter."""
    _adapters[adapter.platform] = adapter
    logger.info(f"Registered bot adapter: {adapter.platform}")


def unregister_adapter(platform: str) -> None:
    """Unregister a bot adapter."""
    if platform in _adapters:
        del _adapters[platform]
        logger.info(f"Unregistered bot adapter: {platform}")


def get_adapter(platform: str) -> Optional[BotAdapter]:
    """Get a registered adapter by platform name."""
    return _adapters.get(platform)


def get_all_adapters() -> List[BotAdapter]:
    """Get all registered adapters."""
    return list(_adapters.values())


def get_ready_adapters() -> List[BotAdapter]:
    """Get all adapters that are ready to send messages."""
    return [adapter for adapter in _adapters.values() if adapter.is_ready()]


def get_supported_platforms() -> List[str]:
    """Get list of all registered platform names."""
    return list(_adapters.keys())
