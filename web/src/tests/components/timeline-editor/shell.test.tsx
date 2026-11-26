import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TimelineEditor } from "@/components/timeline-editor";

import { host, sampleTimeline } from "./fixtures";

const noop = () => {};

/** react-resizable-panels 默认把分栏尺寸存进 localStorage，测试环境没有，放一个内存版 */
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  },
});

const render = (ratio: string) =>
  renderToStaticMarkup(
    <TimelineEditor
      timeline={sampleTimeline()}
      onChange={noop}
      history={{ canUndo: false, canRedo: false, undo: noop, redo: noop }}
      host={host()}
      readOnly={false}
      ratio={ratio}
      layoutId="test"
    />,
  );

describe("编辑器外壳", () => {
  test("竖屏和横屏都能渲染：素材 / 属性切换、素材标签、预览、时间线工具条", () => {
    for (const ratio of ["9:16", "16:9", "乱写"]) {
      const html = render(ratio);
      expect(html).toContain("素材");
      expect(html).toContain("属性");
      expect(html).toContain("片段 01 · 15s");
      expect(html).toContain('aria-label="预览"');
    }
  });

  test("默认显示素材页，没选中片段时不渲染属性内容", () => {
    const html = render("9:16");
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain("未选中片段");
  });
});
