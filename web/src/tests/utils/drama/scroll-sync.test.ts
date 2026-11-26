import { describe, expect, test } from "bun:test";

import { syncedScrollTop } from "@/utils/drama/scroll-sync";

/** 原著对照：稿纸往下滚多少，原著栏就按比例滚多少，两边同时到顶、同时到底。 */
describe("syncedScrollTop", () => {
  // 稿纸高 3000，视口高 800：稿纸能滚的范围是 2200；原著栏内容高 1800、栏高 600：能滚 1200
  const base = { paperHeight: 3000, viewport: 800, paneScrollable: 1200 };

  test("稿纸顶部刚好在视口顶部：原著栏在最上面", () => {
    expect(syncedScrollTop({ ...base, viewTop: 0 })).toBe(0);
  });

  test("还没滚进稿纸（视口顶在稿纸上方）：原著栏在最上面", () => {
    expect(syncedScrollTop({ ...base, viewTop: -300 })).toBe(0);
  });

  test("滚到一半：原著栏也在一半", () => {
    expect(syncedScrollTop({ ...base, viewTop: 1100 })).toBe(600);
  });

  test("稿纸底部对齐视口底部：原著栏在最下面；滚过头也不超出", () => {
    expect(syncedScrollTop({ ...base, viewTop: 2200 })).toBe(1200);
    expect(syncedScrollTop({ ...base, viewTop: 2600 })).toBe(1200);
  });

  test("稿纸一屏就放得下（没有可滚的范围）或原著栏没有可滚的内容：不动", () => {
    expect(
      syncedScrollTop({ viewTop: 100, paperHeight: 700, viewport: 800, paneScrollable: 1200 }),
    ).toBe(0);
    expect(syncedScrollTop({ ...base, viewTop: 1100, paneScrollable: 0 })).toBe(0);
  });
});
