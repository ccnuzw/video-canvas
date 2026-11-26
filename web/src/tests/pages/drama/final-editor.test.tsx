import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { Segment } from "@/api/drama/type";
import { FinalBar } from "@/pages/drama/workspace/final/final-bar";
import { segmentClip } from "@/utils/drama/timeline";

const segment = (id: string, seq: number): Segment =>
  ({
    id,
    episodeNo: 1,
    seq,
    seconds: 15,
    prompt: "",
    takes: [],
    chosenTaskId: "",
    status: "idle",
    revision: 1,
    updatedAt: "",
    adaptations: {},
  }) as unknown as Segment;

/** 一个主轨上的新增片段（待采用）：片场同步条目里的「变化后的段」 */
const clip = (id: string, segmentId: string) => segmentClip(segment(segmentId, 1), id);

const noop = () => {};

const barProps = {
  no: 1,
  title: "湖底沉箱",
  save: "saved" as const,
  sync: [],
  segments: [segment("s1", 0), segment("s2", 1)],
  exporting: null,
  exportReason: null,
  readOnly: false,
  onRetrySave: noop,
  onAckSync: noop,
  onUndoSync: noop,
  onExport: noop,
};

describe("成片顶栏", () => {
  test("只有标题和一个「导出」按钮：不显示统计、成片状态、下载和合成", () => {
    const html = renderToStaticMarkup(<FinalBar {...barProps} />);
    expect(html).toContain("第 1 集 · 湖底沉箱");
    expect(html).toContain("导出");
    for (const text of ["已采用", ">下载 mp4<", "合成第 1 集", "成片已过期", "片场更新"]) {
      expect(html).not.toContain(text);
    }
  });

  test("有同步变化时出现「片场更新 N」胶囊，不出横幅", () => {
    const html = renderToStaticMarkup(
      <FinalBar
        {...barProps}
        sync={[
          {
            change: { kind: "added", segmentId: "s2", seq: 1, clipId: "n1" },
            clip: clip("n1", "s2"),
          },
          { change: { kind: "removed", segmentId: "s9", seq: 2, clipId: "" }, clip: null },
        ]}
      />,
    );
    expect(html).toContain("片场更新 2");
  });

  test("不能导出时按钮禁用，原因只在悬停提示里", () => {
    const html = renderToStaticMarkup(
      <FinalBar {...barProps} exportReason="第 2 段的素材已失效，请换版本或删掉" />,
    );
    expect(html).toContain('title="第 2 段的素材已失效，请换版本或删掉"');
    expect(html).toContain("disabled");
  });

  test("导出进行中按钮上显示进度", () => {
    const html = renderToStaticMarkup(<FinalBar {...barProps} exporting="合成中 45%" />);
    expect(html).toContain("合成中 45%");
    expect(html).toContain("animate-spin");
  });

  test("保存失败给出重试", () => {
    expect(renderToStaticMarkup(<FinalBar {...barProps} save="error" />)).toContain(
      "时间线保存失败 · 重试",
    );
  });
});

describe("成片顶栏的同步条目", () => {
  const items = [
    {
      change: { kind: "added" as const, segmentId: "s2", seq: 1, clipId: "n1" },
      clip: clip("n1", "s2"),
    },
  ];

  test("编辑器还不支持定位时，条目只是文字，不能点", () => {
    const html = renderToStaticMarkup(<FinalBar {...barProps} sync={items} />);
    expect(html).toContain("片场更新 1");
  });

  test("导出进行中按钮禁用", () => {
    const html = renderToStaticMarkup(<FinalBar {...barProps} exporting="保存中…" />);
    expect(html).toContain("保存中…");
    expect(html).toContain("disabled");
  });
});
