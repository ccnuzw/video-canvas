import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Inspector } from "@/components/timeline-editor/inspector";

import { host, sampleTimeline } from "./fixtures";

const noop = () => {};

const render = (clipId: string | null, over: { readOnly?: boolean; lock?: string } = {}) => {
  const timeline = sampleTimeline();
  if (over.lock) timeline.tracks.find((t) => t.id === over.lock)!.locked = true;
  return renderToStaticMarkup(
    <Inspector
      timeline={timeline}
      clipId={clipId}
      host={host({ inspectorExtra: () => <div>宿主追加区</div> })}
      readOnly={over.readOnly ?? false}
      onPreview={noop}
      onCommit={noop}
    />,
  );
};

describe("属性面板", () => {
  test("没有选中显示提示", () => {
    expect(render(null)).toContain("未选中片段");
    expect(render("nope")).toContain("未选中片段");
  });

  test("音频片段：轨道编号、声音、淡入淡出、恢复原长，没有叠加和文字区", () => {
    const html = render("v1");
    expect(html).toContain("A1");
    expect(html).toContain("声音");
    expect(html).toContain("静音此段");
    expect(html).toContain("淡入淡出");
    expect(html).toContain("恢复原长");
    expect(html).not.toContain("右上小窗");
    expect(html).not.toContain("样式");
    expect(html).toContain("宿主追加区");
  });

  test("叠加片段：位置预设和四个滑杆，当前预设之外不高亮铺满", () => {
    const html = render("o1");
    for (const text of ["铺满", "右上小窗", "左下小窗", "居中", "横向", "纵向", "缩放", "不透明"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("V2");
  });

  test("字幕片段：文字框带当前文字，样式和位置可选，没有声音和淡入淡出", () => {
    const html = render("s1");
    expect(html).toContain("你好世界");
    expect(html).toContain("字幕");
    expect(html).toContain("标题");
    expect(html).toContain("顶部");
    expect(html).not.toContain("声音");
    expect(html).not.toContain("淡入淡出");
    expect(html).not.toContain("恢复原长");
  });

  test("主轨视频显示 V1；只读或所在轨锁定时全部禁用", () => {
    expect(render("a")).toContain("V1");
    const readOnly = render("v1", { readOnly: true });
    expect(readOnly).not.toMatch(
      /<button(?![^>]*disabled)[^>]*>\s*(<svg[^>]*>.*?<\/svg>)?静音此段/s,
    );
    expect(readOnly).toContain("disabled");
    const locked = render("v1", { lock: "voice1" });
    expect(locked).toContain("轨道已锁定");
    expect(locked).toContain("disabled");
  });
});
