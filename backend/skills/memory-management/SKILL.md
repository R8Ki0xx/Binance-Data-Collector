---
name: memory-management
shortcut: memory
description: This skill should be used when the user wants to view, update, correct, or delete their stored memories. Trigger phrases include "show my memories", "update memory", "fix memory", "delete memory", "what do you remember about me", "correct this memory", "remove that memory".
description_zh: 当用户要求查看、更新、修正或删除已存储的记忆时使用此技能。
---

# Memory Management

Help users view and manage their long-term memories stored in the system.

## Workflow

### Phase 1: Show Current Memories

1. List all active memories using the memory panel data (already visible in the UI sidebar)
2. Present memories grouped by category with their importance scores
3. Ask the user what they want to do: view details, update, or remove specific memories

[CHECKPOINT] Present current memories and wait for user instructions.

### Phase 2: Execute Memory Changes

Based on user request:

**To UPDATE a memory:**
- Call `save_memory` with the corrected content in the same category
- The intelligent dedup system will automatically detect the overlap with the old memory and merge/replace it
- Confirm the update to the user

**To ADD a new memory:**
- Call `save_memory` with the new content and appropriate category
- The dedup system will check for duplicates automatically

**To CORRECT inaccurate information:**
- Call `save_memory` with the accurate version
- The dedup system will replace the old inaccurate version

[CHECKPOINT] Confirm changes and show updated memory state.

## Important Notes

- Memories are automatically deduplicated using LLM comparison
- When updating, you don't need to delete the old memory first — just save the corrected version
- The system supports categories: preference, decision, lesson, insight, context
- Maximum 50 active memories; lowest importance ones are evicted when limit is reached
- user_info category (from onboarding) is managed separately and excluded from dedup
