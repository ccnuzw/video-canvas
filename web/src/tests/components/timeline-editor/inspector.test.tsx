import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Inspector } from "@/components/timeline-editor/inspector";
import { parseField } from "@/components/timeline-editor/inspector-fields";

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

describe("属性面板的结构", () => {
  test("头部信息条把起点、时长、结束分成三格", () => {
    const html = render("v1");
    expect(html).toContain('aria-label="片段信息"');
    for (const label of ["起点", "时长", "结束"]) expect(html).toContain(`>${label}<`);
  });

  test("每类属性是一张带标题的分区卡片", () => {
    const html = render("o1");
    for (const title of ["画面", "淡入淡出"]) {
      expect(html).toContain(`role="group" aria-label="${title}"`);
    }
  });

  test("数值可以直接输入：音量、淡入淡出带单位的输入框", () => {
    const html = render("v1");
    expect(html).toMatch(/<input[^>]*aria-label="音量"[^>]*value="100"/);
    expect(html).toMatch(/<input[^>]*aria-label="淡入"/);
    expect(html).toContain(">%<");
    expect(html).toContain(">s<");
  });

  test("静音是声音卡片头上的开关，状态在 aria-pressed 上", () => {
    expect(render("v1")).toMatch(/aria-label="静音此段"[^>]*aria-pressed="false"/);
  });

  test("叠加位置用横向、纵向两个输入框，预设是带位置示意的小画面", () => {
    const html = render("o1");
    expect(html).toMatch(/<input[^>]*aria-label="横向位置"/);
    expect(html).toMatch(/<input[^>]*aria-label="纵向位置"/);
    expect(html).toMatch(/aria-label="铺满"/);
  });

  test("字幕的样式和位置是分段单选", () => {
    const html = render("s1");
    expect(html).toMatch(/role="radiogroup" aria-label="样式"/);
    expect(html).toMatch(/role="radiogroup" aria-label="位置"/);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>字幕</);
  });
});

describe("数值输入的换算", () => {
  test("输入框里的文字换算回数值：按单位倍数、夹到范围、按步长取整，看不懂就不改", () => {
    expect(parseField("150", { min: 0, max: 200, step: 1, scale: 1 })).toBe(150);
    expect(parseField("999", { min: 0, max: 200, step: 1, scale: 1 })).toBe(200);
    expect(parseField("1.26", { min: 0, max: 3000, step: 100, scale: 1000 })).toBe(1300);
    expect(parseField(" 0.5s ", { min: 0, max: 3000, step: 100, scale: 1000 })).toBe(500);
    expect(parseField("abc", { min: 0, max: 200, step: 1, scale: 1 })).toBeNull();
    expect(parseField("", { min: 0, max: 200, step: 1, scale: 1 })).toBeNull();
  });
});
