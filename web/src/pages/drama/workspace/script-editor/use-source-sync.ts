import { useCallback, useEffect, type RefObject } from "react";

import { syncedScrollTop } from "@/utils/drama/scroll-sync";

/** 往上找最近的竖向滚动容器 */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * 原著对照时让原著栏跟着稿纸滚：页面往下滚，原著栏按比例滚到对应位置（见 syncedScrollTop）。
 * 只做稿纸 → 原著栏这一个方向，原著栏自己也能单独滚，下次页面滚动时再对齐。
 * @param enabled 原著对照是否打开
 * @param paperRef 稿纸
 * @param paneRef 原著栏
 * @returns 立即对齐一次的函数（原文读完、内容高度变了时调用）
 */
export function useSourceSync(
  enabled: boolean,
  paperRef: RefObject<HTMLElement | null>,
  paneRef: RefObject<HTMLElement | null>,
): () => void {
  const sync = useCallback(() => {
    const paper = paperRef.current;
    const pane = paneRef.current;
    const scroller = scrollParent(paper);
    if (!paper || !pane || !scroller) return;
    pane.scrollTop = syncedScrollTop({
      viewTop: scroller.getBoundingClientRect().top - paper.getBoundingClientRect().top,
      paperHeight: paper.offsetHeight,
      viewport: scroller.clientHeight,
      paneScrollable: pane.scrollHeight - pane.clientHeight,
    });
  }, [paperRef, paneRef]);

  useEffect(() => {
    const scroller = enabled ? scrollParent(paperRef.current) : null;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [enabled, paperRef, sync]);

  return sync;
}
