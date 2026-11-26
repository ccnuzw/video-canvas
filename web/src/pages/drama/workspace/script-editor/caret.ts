/**
 * 光标在可编辑元素文字里的偏移（按 UTF-16 码元，和字符串下标一致）
 * @param el 可编辑元素
 */
export function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return range.toString().length;
}

/**
 * 判断选区是不是一个光标（没有选中文字）
 */
export function isCollapsed(): boolean {
  return window.getSelection()?.isCollapsed ?? true;
}

/**
 * 把光标放进可编辑元素
 * @param el 可编辑元素
 * @param offset 字符偏移；"end" 表示行尾
 */
export function setCaret(el: HTMLElement, offset: number | "end"): void {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const text = el.firstChild;
  if (!text) {
    range.setStart(el, 0);
  } else {
    const length = (text as Text).length;
    range.setStart(text, offset === "end" ? length : Math.min(offset, length));
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}
