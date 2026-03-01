/**
 * Splits long text into Telegram-safe chunks (max 4096 chars).
 * Prefers splitting at paragraph breaks, then line breaks, then sentence boundaries.
 */

const TELEGRAM_MAX = 4096;
// Leave room for formatting overhead
const SAFE_MAX = TELEGRAM_MAX - 50;

export function chunkMessage(text: string): string[] {
  if (text.length <= SAFE_MAX) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= SAFE_MAX) {
      chunks.push(remaining);
      break;
    }

    let splitAt = findSplitPoint(remaining, SAFE_MAX);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}

function findSplitPoint(text: string, maxLen: number): number {
  const slice = text.slice(0, maxLen);

  // Try double newline (paragraph break)
  const paraBreak = slice.lastIndexOf('\n\n');
  if (paraBreak > maxLen * 0.3) return paraBreak + 2;

  // Try single newline
  const lineBreak = slice.lastIndexOf('\n');
  if (lineBreak > maxLen * 0.3) return lineBreak + 1;

  // Try sentence boundary (. ! ?)
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? ')
  );
  if (sentenceEnd > maxLen * 0.3) return sentenceEnd + 2;

  // Try space
  const space = slice.lastIndexOf(' ');
  if (space > maxLen * 0.3) return space + 1;

  // Hard cut as last resort
  return maxLen;
}

/**
 * Formats a tool use event into a compact status line.
 */
export function formatToolUse(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return `Reading ${input.file_path || 'file'}...`;
    case 'Write':
      return `Writing ${input.file_path || 'file'}...`;
    case 'Edit':
      return `Editing ${input.file_path || 'file'}...`;
    case 'Bash':
      return `Running: ${truncate(String(input.command || ''), 80)}`;
    case 'Glob':
      return `Searching for ${input.pattern || 'files'}...`;
    case 'Grep':
      return `Searching for "${truncate(String(input.pattern || ''), 40)}"...`;
    case 'WebSearch':
      return `Searching web: ${truncate(String(input.query || ''), 60)}`;
    case 'WebFetch':
      return `Fetching ${truncate(String(input.url || ''), 60)}...`;
    default:
      return `Using ${toolName}...`;
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
