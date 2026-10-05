/** Copies only after a user action, without granting clipboard reads or renderer permissions. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // The packaged sandbox denies Clipboard API permission; explicit selection-copy still works.
    const focused = document.activeElement;
    const selection = document.getSelection();
    const ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, index) =>
          selection.getRangeAt(index).cloneRange(),
        )
      : [];
    const temporary = document.createElement('textarea');
    temporary.value = text;
    temporary.readOnly = true;
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    temporary.style.pointerEvents = 'none';
    document.body.append(temporary);
    try {
      temporary.select();
      if (!document.execCommand('copy')) throw new Error('Copy was unavailable');
    } finally {
      temporary.remove();
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
      selection?.removeAllRanges();
      for (const range of ranges) selection?.addRange(range);
    }
  }
}
