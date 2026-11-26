import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MediaPanel } from "@/components/timeline-editor/media-panel";

import { item, tab } from "./fixtures";

const noop = () => {};

const render = (props: Partial<Parameters<typeof MediaPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <MediaPanel
      tabs={[tab()]}
      ratio="9/16"
      readOnly={false}
      onAdd={noop}
      onImport={noop}
      {...props}
    />,
  );

describe("素材面板", () => {
  test("渲染标签、分组标题、卡片名字和副标题、角标", () => {
    const html = render();
    expect(html).toContain("片段");
    expect(html).toContain("片段 01 · 15s");
    expect(html).toContain("卡片 a");
    expect(html).toContain("视频 · 6s");
    expect(html).toContain("已采用");
    expect(html).toContain('aria-label="加到时间线"');
  });

  test("在时间线上的卡片底色更淡，不加「在轨上」角标", () => {
    const html = render();
    expect(html).toContain("bg-muted/35");
    expect(html).not.toContain("在轨上");
  });

  test("可筛选的标签显示全部 / 视频 / 图片 / 音频，不可筛选的不显示", () => {
    expect(render()).toContain("音频");
    expect(render({ tabs: [tab({ filterable: false })] })).not.toContain("音频</button>");
  });

  test("可导入的标签有「导入」按钮；只读或宿主没给导入时没有", () => {
    expect(render()).toContain("导入");
    expect(render({ readOnly: true })).not.toContain("导入");
    expect(render({ onImport: undefined })).not.toContain("导入");
    expect(render({ tabs: [tab({ importable: false })] })).not.toContain("导入");
  });

  test("只读时卡片不能拖也没有「+」", () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain('aria-label="加到时间线"');
    expect(html).toContain('draggable="false"');
  });

  test("上传中显示进度，失败显示重试，这两种卡片没有「+」", () => {
    const html = render({
      tabs: [
        tab({
          sections: [
            {
              title: null,
              items: [
                item("u", { status: "uploading", progress: 42 }),
                item("f", { status: "failed" }),
              ],
            },
          ],
        }),
      ],
    });
    expect(html).toContain("42%");
    expect(html).toContain("上传失败，点此重试");
    expect(html).not.toContain('aria-label="加到时间线"');
  });

  test("没有内容显示宿主给的空状态文字；读取中不显示卡片", () => {
    expect(render({ tabs: [tab({ sections: [] })] })).toContain("这里还没有素材");
    const loading = render({ tabs: [tab({ loading: true })] });
    expect(loading).not.toContain("卡片 a");
    expect(loading).toContain("animate-spin");
  });

  test("卡片比例：project 沿用项目比例，square 是方形", () => {
    const tabWith = (aspect: "project" | "square") =>
      tab({ sections: [{ title: null, items: [item("x", { aspect })] }] });
    expect(render({ tabs: [tabWith("project")], ratio: "16/9" })).toContain("aspect-ratio:16/9");
    expect(render({ tabs: [tabWith("square")], ratio: "16/9" })).toContain("aspect-ratio:1 / 1");
  });

  test("有缩略图用缩略图，没有按类型显示图标", () => {
    const html = render({
      tabs: [
        tab({
          sections: [
            {
              title: null,
              items: [item("p", { thumbUrl: "https://x/p.jpg" }), item("q", { type: "audio" })],
            },
          ],
        }),
      ],
    });
    expect(html).toContain("https://x/p.jpg");
    expect(html).toContain("lucide-audio-lines");
  });
});
