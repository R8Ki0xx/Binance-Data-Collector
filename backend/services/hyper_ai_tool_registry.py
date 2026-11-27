"""
Hyper AI External Tool Registry

Generic registry for external tools that require user-provided API keys.
To add a new tool, just add an entry to EXTERNAL_TOOL_REGISTRY and
implement validate_<tool_name> + execute_<tool_name> functions.
"""

import json
import logging
from typing import Dict, Optional, Tuple

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# --- Tool Registry ---
# Each entry defines metadata + config schema for one external tool.
# Frontend reads this to dynamically render config UI.

EXTERNAL_TOOL_REGISTRY: Dict[str, dict] = {
    "tavily": {
        "display_name": "Tavily Web Search",
        "display_name_zh": "Tavily 联网搜索",
        "description": "Search the web for quant research, market news, and factor ideas.",
        "description_zh": "联网搜索量化研究、市场新闻和因子灵感。",
        "icon": "search",
        "config_fields": [
            {
                "key": "api_key",
                "type": "secret",
                "label": "API Key",
                "label_zh": "API 密钥",
                "required": True,
                "placeholder": "tvly-...",
            },
        ],
        "get_url": "https://tavily.com",
        "get_url_label": "Get API Key at tavily.com",
        "get_url_label_zh": "在 tavily.com 获取 API Key",
    },
}


# --- Config Helpers ---

def get_tool_configs(db: Session) -> dict:
    """Read tool_configs JSON from HyperAiProfile."""
    from database.models import HyperAiProfile
    profile = db.query(HyperAiProfile).first()
    if not profile or not profile.tool_configs:
        return {}
    try:
        return json.loads(profile.tool_configs)
    except (json.JSONDecodeError, TypeError):
        return {}


def save_tool_configs(db: Session, configs: dict):
    """Write tool_configs JSON to HyperAiProfile."""
    from database.models import HyperAiProfile
    profile = db.query(HyperAiProfile).first()
    if not profile:
        profile = HyperAiProfile()
        db.add(profile)
    profile.tool_configs = json.dumps(configs)
    db.commit()


def get_tool_api_key(db: Session, tool_name: str) -> Optional[str]:
    """Get decrypted API key for a tool. Returns None if not configured."""
    from utils.encryption import decrypt_private_key
    configs = get_tool_configs(db)
    tool_cfg = configs.get(tool_name, {})
    encrypted = tool_cfg.get("api_key_encrypted")
    if not encrypted:
        return None
    try:
        return decrypt_private_key(encrypted)
    except Exception:
        return None


def set_tool_api_key(db: Session, tool_name: str, api_key: str):
    """Encrypt and save API key for a tool."""
    from utils.encryption import encrypt_private_key
    configs = get_tool_configs(db)
    if tool_name not in configs:
        configs[tool_name] = {}
    configs[tool_name]["api_key_encrypted"] = encrypt_private_key(api_key)
    configs[tool_name]["enabled"] = True
    save_tool_configs(db, configs)


def remove_tool_config(db: Session, tool_name: str):
    """Remove configuration for a tool."""
    configs = get_tool_configs(db)
    if tool_name in configs:
        del configs[tool_name]
        save_tool_configs(db, configs)


# --- Validation Functions ---

async def validate_tavily(api_key: str) -> Tuple[bool, str]:
    """Validate Tavily API key by making a test search."""
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        client.search("test", max_results=1)
        return True, ""
    except Exception as e:
        err = str(e)
        if "401" in err or "Unauthorized" in err or "Invalid" in err:
            return False, "Invalid API key"
        return False, f"Validation failed: {err}"


# Map tool_name -> validation function
TOOL_VALIDATORS = {
    "tavily": validate_tavily,
}
