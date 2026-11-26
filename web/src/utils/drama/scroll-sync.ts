/**
 * 原著对照的滚动同步：稿纸往下滚，原著栏按比例跟着滚，两边同时到顶、同时到底。
 * 原文和剧本没有逐段对应，按比例是最稳的近似。
 * @param viewTop 视口顶边在稿纸里的位置（视口顶 − 稿纸顶，像素；还没滚进稿纸时为负）
 * @param paperHeight 稿纸高度
 * @param viewport 视口高度
 * @param paneScrollable 原著栏能滚的距离（内容高 − 栏高）
 * @returns 原著栏该滚到的 scrollTop
 */
export function syncedScrollTop({
  viewTop,
  paperHeight,
  viewport,
  paneScrollable,
}: {
  viewTop: number;
  paperHeight: number;
  viewport: number;
  paneScrollable: number;
}): number {
  const range = paperHeight - viewport;
  if (range <= 0 || paneScrollable <= 0) return 0;
  const progress = Math.min(1, Math.max(0, viewTop / range));
  return Math.round(progress * paneScrollable);
}
