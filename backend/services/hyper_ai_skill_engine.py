"""
Hyper AI Skill Engine

Manages the Skill system for Hyper AI. Skills are modular, file-based
knowledge packages (SKILL.md files) that provide domain-specific workflow
guidance to the AI. Inspired by Claude Code's Plugin/Skill architecture.

Architecture:
- Skills are stored as files in backend/skills/<skill-name>/SKILL.md
- Each SKILL.md has YAML frontmatter (name, description) + Markdown body
- The engine scans the skills directory, reads metadata, and provides:
  1. Metadata list for system prompt injection (lightweight, ~30 words each)
  2. Full SKILL.md content loading on demand (via load_skill tool)
  3. Reference document loading on demand (via load_skill_reference tool)

Progressive Disclosure (matching Claude Code's 3-level loading):
  Level 1: Metadata (name + description) — always in system prompt (~100 words total)
  Level 2: SKILL.md body — loaded when AI determines task matches a skill
  Level 3: references/ files — loaded as needed within a skill's workflow

User Control:
- Users can enable/disable individual skills via the frontend
- Disabled skills are excluded from the metadata list in system prompt
- Enabled state stored in HyperAiProfile.enabled_skills (JSON array)
- NULL enabled_skills = all skills enabled (default)
"""

import os
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Skills directory path (relative to backend/)
SKILLS_DIR = Path(__file__).parent.parent / "skills"


def _parse_frontmatter(content: str) -> tuple[dict, str]:
    """
    Parse YAML frontmatter from a SKILL.md file.

    Returns (metadata_dict, body_text).
    Frontmatter is delimited by --- lines at the top of the file.
    """
    if not content.startswith("---"):
        return {}, content

    lines = content.split("\n")
    end_idx = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break

    if end_idx == -1:
        return {}, content

    # Parse simple YAML key: value pairs from frontmatter
    metadata = {}
    for line in lines[1:end_idx]:
        line = line.strip()
        if ":" in line:
            key, _, value = line.partition(":")
            metadata[key.strip()] = value.strip()

    body = "\n".join(lines[end_idx + 1:]).strip()
    return metadata, body


def scan_all_skills() -> list[dict]:
    """
    Scan the skills directory and return metadata for all available skills.

    Returns a list of dicts, each containing:
    - name: skill identifier (directory name)
    - description: trigger condition description from frontmatter
    - path: absolute path to the skill directory

    This is called once during conversation initialization to build
    the metadata list for system prompt injection.
    """
    skills = []

    if not SKILLS_DIR.exists():
        logger.warning(f"Skills directory not found: {SKILLS_DIR}")
        return skills

    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue

        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            logger.warning(f"Skill directory missing SKILL.md: {skill_dir.name}")
            continue

        try:
            content = skill_md.read_text(encoding="utf-8")
            metadata, _ = _parse_frontmatter(content)

            if "name" not in metadata or "description" not in metadata:
                logger.warning(f"Skill {skill_dir.name} missing required frontmatter fields")
                continue

            skills.append({
                "name": metadata["name"],
                "shortcut": metadata.get("shortcut", ""),
                "description": metadata["description"],
                "description_zh": metadata.get("description_zh", ""),
                "path": str(skill_dir),
            })
        except Exception as e:
            logger.error(f"Error reading skill {skill_dir.name}: {e}")

    return skills


def get_enabled_skills(all_skills: list[dict], enabled_skills_json: Optional[str]) -> list[dict]:
    """
    Filter skills based on user's enabled_skills setting.

    Args:
        all_skills: full list from scan_all_skills()
        enabled_skills_json: HyperAiProfile.enabled_skills value (JSON string or None)

    Returns:
        Filtered list of enabled skills.
        If enabled_skills_json is None, all skills are enabled (default behavior).
    """
    if enabled_skills_json is None:
        return all_skills

    try:
        enabled_names = json.loads(enabled_skills_json)
        if not isinstance(enabled_names, list):
            logger.warning("enabled_skills is not a JSON array, returning all skills")
            return all_skills
        return [s for s in all_skills if s["name"] in enabled_names]
    except (json.JSONDecodeError, TypeError):
        logger.warning("Failed to parse enabled_skills JSON, returning all skills")
        return all_skills


def build_skills_metadata_prompt(enabled_skills: list[dict]) -> str:
    """
    Build the skills metadata section for injection into the system prompt.

    This is the Level 1 (always-present) information — just name + description
    for each enabled skill, so the AI knows what skills are available and when
    to load them via the load_skill tool.

    Returns a formatted string ready to append to the system prompt.
    """
    if not enabled_skills:
        return ""

    lines = [
        "## Available Skills",
        "",
        "You have the following skills available. When a user's request matches",
        "a skill's description, use `load_skill` to load the full workflow guide.",
        "Do NOT load a skill for general questions — only when the user explicitly",
        "asks you to PERFORM the described task.",
        "",
    ]

    for skill in enabled_skills:
        lines.append(f"- **{skill['name']}**: {skill['description']}")

    return "\n".join(lines)


def load_skill(skill_name: str) -> dict:
    """
    Load the full SKILL.md content for a given skill (Level 2 loading).

    Called by the load_skill tool when AI determines a task matches a skill.
    Returns the complete Markdown body (without frontmatter) that contains
    the step-by-step workflow with CHECKPOINT markers.

    Returns:
        {"success": True, "skill_name": str, "content": str} on success
        {"success": False, "error": str} on failure
    """
    skill_dir = SKILLS_DIR / skill_name
    skill_md = skill_dir / "SKILL.md"

    if not skill_md.exists():
        return {"success": False, "error": f"Skill '{skill_name}' not found"}

    try:
        content = skill_md.read_text(encoding="utf-8")
        _, body = _parse_frontmatter(content)

        # List available references so AI knows what it can load later
        refs_dir = skill_dir / "references"
        available_refs = []
        if refs_dir.exists():
            available_refs = [f.name for f in refs_dir.iterdir() if f.is_file()]

        result = {
            "success": True,
            "skill_name": skill_name,
            "content": body,
        }
        if available_refs:
            result["available_references"] = available_refs

        return result
    except Exception as e:
        return {"success": False, "error": f"Error loading skill '{skill_name}': {e}"}


def load_skill_reference(skill_name: str, reference_file: str) -> dict:
    """
    Load a reference document from a skill's references/ directory (Level 3 loading).

    Called by the load_skill_reference tool when AI needs additional context
    while executing a skill's workflow.

    Args:
        skill_name: the skill identifier
        reference_file: filename within the skill's references/ directory

    Returns:
        {"success": True, "skill_name": str, "file": str, "content": str} on success
        {"success": False, "error": str} on failure
    """
    ref_path = SKILLS_DIR / skill_name / "references" / reference_file

    # Security: prevent path traversal
    try:
        ref_path = ref_path.resolve()
        skills_resolved = SKILLS_DIR.resolve()
        if not str(ref_path).startswith(str(skills_resolved)):
            return {"success": False, "error": "Invalid reference path"}
    except Exception:
        return {"success": False, "error": "Invalid reference path"}

    if not ref_path.exists():
        return {"success": False, "error": f"Reference '{reference_file}' not found in skill '{skill_name}'"}

    try:
        content = ref_path.read_text(encoding="utf-8")
        return {
            "success": True,
            "skill_name": skill_name,
            "file": reference_file,
            "content": content,
        }
    except Exception as e:
        return {"success": False, "error": f"Error loading reference: {e}"}
