"""Message Formatter - Convert Markdown for Telegram and Discord.

Telegram: Markdown → HTML (Telegram supports limited HTML subset)
Discord: Tables → Code blocks (Discord supports most Markdown natively)

Based on OpenClaw's approach but simplified for Python.
"""
import re
import html
from typing import List

try:
    import mistune
    HAS_MISTUNE = True
except ImportError:
    HAS_MISTUNE = False


# =============================================================================
# Telegram HTML Renderer (using mistune)
# =============================================================================

class TelegramHTMLRenderer(mistune.HTMLRenderer if HAS_MISTUNE else object):
    """
    Custom mistune renderer that outputs Telegram-compatible HTML.
    Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">, <blockquote>
    """

    def text(self, text: str) -> str:
        return html.escape(text)

    def emphasis(self, text: str) -> str:
        return f'<i>{text}</i>'

    def strong(self, text: str) -> str:
        return f'<b>{text}</b>'

    def strikethrough(self, text: str) -> str:
        return f'<s>{text}</s>'

    def codespan(self, text: str) -> str:
        return f'<code>{html.escape(text)}</code>'

    def block_code(self, code: str, info: str = None) -> str:
        escaped = html.escape(code.rstrip())
        return f'<pre>{escaped}</pre>\n'

    def link(self, text: str, url: str, title: str = None) -> str:
        safe_url = html.escape(url, quote=True)
        return f'<a href="{safe_url}">{text}</a>'

    def image(self, text: str, url: str, title: str = None) -> str:
        # Telegram doesn't support images in HTML, just show the alt text
        return f'[{text}]'

    def heading(self, text: str, level: int, **attrs) -> str:
        # Telegram doesn't support headings, convert to bold
        return f'<b>{text}</b>\n\n'

    def paragraph(self, text: str) -> str:
        return f'{text}\n\n'

    def block_quote(self, text: str) -> str:
        return f'<blockquote>{text.strip()}</blockquote>\n'

    def list(self, text: str, ordered: bool, **attrs) -> str:
        # Telegram doesn't have list tags, keep as text
        return text

    def list_item(self, text: str, **attrs) -> str:
        return f'• {text.strip()}\n'

    def thematic_break(self) -> str:
        return '—' * 20 + '\n\n'

    def linebreak(self) -> str:
        return '\n'

    def newline(self) -> str:
        return ''

    def table(self, text: str) -> str:
        # Telegram doesn't support tables, wrap in <pre>
        return f'<pre>{text}</pre>\n'

    def table_head(self, text: str) -> str:
        return text

    def table_body(self, text: str) -> str:
        return text

    def table_row(self, text: str) -> str:
        return text + '\n'

    def table_cell(self, text: str, align: str = None, head: bool = False) -> str:
        # Strip HTML tags from cell content for plain text table
        clean_text = re.sub(r'<[^>]+>', '', text)
        return f'| {clean_text} '


def _clean_markdown_in_text(text: str) -> str:
    """
    Clean markdown formatting from text.
    """
    # Remove bold **text**
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    # Remove italic *text*
    text = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'\1', text)
    # Remove inline code `text`
    text = re.sub(r'`([^`]+)`', r'\1', text)
    # Remove strikethrough ~~text~~
    text = re.sub(r'~~([^~]+)~~', r'\1', text)
    # Remove links [text](url) -> text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    return text


def _render_table_as_code(table_lines: List[str]) -> str:
    """
    Render markdown table as properly aligned ASCII table.
    Similar to OpenClaw's renderTableAsCode approach.
    """
    if not table_lines:
        return ''

    # Parse table into rows of cells
    rows = []
    for line in table_lines:
        # Skip separator lines (|---|---|) - require | on both sides
        if re.match(r'^\|[\s:|-]+\|$', line.strip()):
            continue

        # Split by | and clean
        cells = []
        parts = line.split('|')
        for part in parts:
            cell = part.strip()
            if cell:  # Skip empty parts from leading/trailing |
                # Clean markdown formatting
                cell = _clean_markdown_in_text(cell)
                cells.append(cell)
        if cells:
            rows.append(cells)

    if not rows:
        return ''

    # Calculate column widths
    col_count = max(len(row) for row in rows)
    widths = [0] * col_count
    for row in rows:
        for i, cell in enumerate(row):
            if i < col_count:
                widths[i] = max(widths[i], len(cell))

    # Ensure minimum width of 3 for divider
    widths = [max(w, 3) for w in widths]

    # Build formatted table
    result = []
    for row_idx, row in enumerate(rows):
        line = '|'
        for i in range(col_count):
            cell = row[i] if i < len(row) else ''
            padding = widths[i] - len(cell)
            line += f' {cell}{" " * padding} |'
        result.append(line)

        # Add divider after header (first row)
        if row_idx == 0:
            divider = '|'
            for w in widths:
                divider += f' {"-" * w} |'
            result.append(divider)

    return '\n'.join(result)


def _convert_tables_to_pre(text: str) -> str:
    """
    Pre-process: Convert markdown tables to fenced code blocks with proper alignment.
    Skips content already inside code blocks to avoid double-wrapping.
    """
    if '|' not in text:
        return text

    lines = text.split('\n')
    result = []
    table_lines = []
    in_table = False
    in_code_block = False

    for line in lines:
        stripped = line.strip()

        # Track code block state - skip everything inside
        if stripped.startswith('```'):
            in_code_block = not in_code_block
            if in_table and table_lines:
                formatted_table = _render_table_as_code(table_lines)
                if formatted_table:
                    result.append('```')
                    result.append(formatted_table)
                    result.append('```')
                table_lines = []
                in_table = False
            result.append(line)
            continue

        if in_code_block:
            result.append(line)
            continue

        # Detect table line: must contain | and start or end with |
        # This avoids matching --- (thematic breaks) as table separators
        is_table = (
            '|' in stripped
            and (stripped.startswith('|') or stripped.endswith('|'))
            and len(stripped) > 1
        )

        if is_table:
            table_lines.append(line)
            in_table = True
        else:
            if in_table and table_lines:
                formatted_table = _render_table_as_code(table_lines)
                if formatted_table:
                    result.append('```')
                    result.append(formatted_table)
                    result.append('```')
                table_lines = []
                in_table = False
            result.append(line)

    # Handle trailing table
    if table_lines:
        formatted_table = _render_table_as_code(table_lines)
        if formatted_table:
            result.append('```')
            result.append(formatted_table)
            result.append('```')

    return '\n'.join(result)


def markdown_to_telegram_html(text: str) -> str:
    """
    Convert standard Markdown to Telegram-compatible HTML.
    Uses mistune for proper parsing if available, falls back to regex.
    """
    if not text:
        return text

    try:
        # Pre-process: convert tables to code blocks with proper alignment
        text = _convert_tables_to_pre(text)

        # Thematic breaks (---) are handled by mistune's thematic_break() renderer

        if HAS_MISTUNE:
            renderer = TelegramHTMLRenderer()
            md = mistune.create_markdown(renderer=renderer)
            result = md(text)
            # Clean up extra newlines
            result = re.sub(r'\n{3,}', '\n\n', result)
            return result.strip()
        else:
            # Fallback to regex-based conversion
            return _markdown_to_html_fallback(text)
    except Exception as e:
        # On any error, return escaped plain text
        print(f'[MessageFormatter] Error converting to HTML: {e}', flush=True)
        return html.escape(text)


def _markdown_to_html_fallback(text: str) -> str:
    """
    Fallback regex-based markdown to HTML conversion.
    Used when mistune is not available.
    """
    # Escape HTML first
    result = html.escape(text)

    # Code blocks (``` ... ```)
    result = re.sub(
        r'```(\w*)\n([\s\S]*?)```',
        lambda m: f'<pre>{m.group(2).strip()}</pre>',
        result
    )

    # Inline code
    result = re.sub(r'`([^`]+)`', r'<code>\1</code>', result)

    # Headings (# ## ###) -> bold
    result = re.sub(r'^#{1,6}\s+(.+)$', r'<b>\1</b>', result, flags=re.MULTILINE)

    # Bold (**text** or __text__)
    result = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', result)
    result = re.sub(r'__(.+?)__', r'<b>\1</b>', result)

    # Italic (*text* or _text_)
    result = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<i>\1</i>', result)
    result = re.sub(r'(?<!_)_([^_]+)_(?!_)', r'<i>\1</i>', result)

    # Strikethrough
    result = re.sub(r'~~(.+?)~~', r'<s>\1</s>', result)

    # Links [text](url)
    result = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', result)

    return result


def chunk_telegram_html(html_text: str, max_chars: int = 4096) -> List[str]:
    """
    Split HTML text into chunks that fit Telegram's message limit.
    Tries to break at paragraph boundaries and ensures tags are balanced.
    """
    if not html_text or len(html_text) <= max_chars:
        return [html_text] if html_text else []

    chunks = []
    remaining = html_text

    while remaining:
        if len(remaining) <= max_chars:
            chunks.append(remaining)
            break

        # Find a good break point
        break_point = _find_break_point(remaining, max_chars)
        chunk = remaining[:break_point]
        remaining = remaining[break_point:].lstrip()

        # Balance tags
        chunk = _balance_html_tags(chunk)
        if chunk.strip():
            chunks.append(chunk)

    return chunks


def _find_break_point(text: str, max_chars: int) -> int:
    """Find a good break point within max_chars."""
    search = text[:max_chars]

    # Prefer paragraph break
    idx = search.rfind('\n\n')
    if idx > max_chars // 2:
        return idx + 2

    # Then single newline
    idx = search.rfind('\n')
    if idx > max_chars // 2:
        return idx + 1

    # Then space
    idx = search.rfind(' ')
    if idx > max_chars // 2:
        return idx + 1

    # Hard cut, avoid cutting inside a tag
    idx = max_chars
    while idx > 0 and text[idx - 1] == '<':
        idx -= 1
    return idx if idx > 0 else max_chars


def _balance_html_tags(text: str) -> str:
    """Ensure all opened HTML tags are closed."""
    tag_pattern = re.compile(r'<(/?)([a-z]+)[^>]*>', re.IGNORECASE)
    valid_tags = {'b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote'}
    open_tags = []

    for match in tag_pattern.finditer(text):
        is_close = match.group(1) == '/'
        tag = match.group(2).lower()
        if tag in valid_tags:
            if is_close:
                if open_tags and open_tags[-1] == tag:
                    open_tags.pop()
            else:
                open_tags.append(tag)

    # Close unclosed tags
    for tag in reversed(open_tags):
        text += f'</{tag}>'

    return text


# =============================================================================
# Discord: Table → Code Block Conversion
# =============================================================================

def convert_tables_for_discord(text: str) -> str:
    """
    Convert Markdown tables to code blocks for Discord.
    Discord doesn't support table syntax.
    """
    if not text or '|' not in text:
        return text

    try:
        return _convert_tables_to_pre(text)
    except Exception as e:
        print(f'[MessageFormatter] Error converting tables: {e}', flush=True)
        return text


def chunk_discord_text(text: str, max_chars: int = 2000, max_lines: int = 25) -> List[str]:
    """
    Split text into chunks for Discord.
    Handles code block boundaries properly.
    """
    if not text:
        return []

    if len(text) <= max_chars and text.count('\n') < max_lines:
        return [text]

    chunks = []
    lines = text.split('\n')
    current = []
    current_len = 0
    in_code = False
    code_lang = ''

    for line in lines:
        line_len = len(line) + 1

        # Track code block state
        if line.startswith('```'):
            if not in_code:
                in_code = True
                code_lang = line[3:].strip()
            else:
                in_code = False
                code_lang = ''

        # Check if need new chunk
        would_exceed = current_len + line_len > max_chars or len(current) >= max_lines

        if would_exceed and current:
            chunk = '\n'.join(current)
            if in_code:
                chunk += '\n```'
            chunks.append(chunk)

            current = []
            current_len = 0
            if in_code:
                opener = f'```{code_lang}' if code_lang else '```'
                current.append(opener)
                current_len = len(opener) + 1

        current.append(line)
        current_len += line_len

    if current:
        chunks.append('\n'.join(current))

    return chunks


# =============================================================================
# Unified Interface
# =============================================================================

def format_for_telegram(text: str) -> List[str]:
    """
    Format text for Telegram: convert Markdown to HTML and chunk.
    Returns list of message chunks ready to send with parse_mode='HTML'.
    """
    try:
        html_text = markdown_to_telegram_html(text)
        return chunk_telegram_html(html_text, max_chars=4096)
    except Exception as e:
        print(f'[MessageFormatter] Telegram format error: {e}', flush=True)
        # Return escaped plain text on error
        return chunk_telegram_html(html.escape(text), max_chars=4096)


def format_for_discord(text: str) -> List[str]:
    """
    Format text for Discord: convert tables to code blocks and chunk.
    Returns list of message chunks ready to send.
    """
    try:
        formatted = convert_tables_for_discord(text)
        return chunk_discord_text(formatted, max_chars=2000)
    except Exception as e:
        print(f'[MessageFormatter] Discord format error: {e}', flush=True)
        return chunk_discord_text(text, max_chars=2000)
