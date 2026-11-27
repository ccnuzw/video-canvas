import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ExportPanel } from "@/pages/drama/workspace/final/export-dialog";
import type { ExportPhase, ExportSummary } from "@/pages/drama/workspace/final/export-flow";

const noop = () => {};
const summary: ExportSummary = {
  durationMs: 20000,
  main: 2,
  overlay: 1,
  audio: 2,
  text: 1,
  skipped: ["片段 02"],
  posterUrl: "/thumb/a.jpg",
};
const render = (phase: ExportPhase, over: Partial<Parameters<typeof ExportPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <ExportPanel
      phase={phase}
      composeProgress={40}
      summary={summary}
      fileName="闯入者-第1集.mp4"
      ratio="9:16"
      fresh={false}
      spec={{ shortSide: 1080, fps: 30, quality: "high" }}
      onSpecChange={noop}
      onStart={noop}
      onRetry={noop}
      onDownload={noop}
      onClose={noop}
      {...over}
    />,
  );

describe("导出弹窗：导出单", () => {
  test("列出文件名、时长、比例、格式、包含的内容和封面", () => {
    const html = render({ kind: "idle" });
    for (const text of [
      "闯入者-第1集.mp4",
      "00:20",
      "9:16",
      "MP4",
      "H.264",
      "主轨 2 段",
      "叠加 1 段",
      "音频 2 段",
      "字幕 1 条",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('src="/thumb/a.jpg"');
  });

  test("有会被跳过的待采用片段时提前提示", () => {
    expect(render({ kind: "idle" })).toContain("片段 02");
    expect(render({ kind: "idle" }, { summary: { ...summary, skipped: [] } })).not.toContain(
      "跳过",
    );
  });

  test("主按钮始终是「导出」；成片已是最新时标明直接下载、不重新合成", () => {
    const normal = render({ kind: "idle" });
    expect(normal).toMatch(/<button[^>]*>.*?导出<\/button>/s);
    expect(normal).not.toContain("开始导出");
    expect(normal).not.toContain("与上次导出一致");
    const fresh = render({ kind: "idle" }, { fresh: true });
    expect(fresh).toContain("与上次导出一致");
    expect(fresh).not.toContain(">下载<");
  });

  test("导出设置：分辨率、帧率、画质三组单选，当前规格选中，分辨率旁显示像素尺寸", () => {
    const html = render({ kind: "idle" });
    expect(html).toContain('aria-label="导出设置"');
    for (const group of ["分辨率", "帧率", "画质"]) {
      expect(html).toContain(`role="radiogroup" aria-label="${group}"`);
    }
    for (const option of ["720P", "1080P", "2K", "24", "25", "30", "标准", "高", "极高"]) {
      expect(html).toContain(`>${option}<`);
    }
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>1080P</);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>30</);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>高</);
    expect(html).toContain("1080 × 1920");
  });
});

describe("导出弹窗：进度和结果", () => {
  test("进行中：三步进度、总进度条和百分比，可以转到后台", () => {
    const html = render({ kind: "composing" });
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="41"/);
    expect(html).toContain("41%");
    for (const step of ["保存时间线", "合成视频", "下载成片"]) expect(html).toContain(step);
    expect(html).toContain('data-state="done"');
    expect(html).toContain('data-state="active"');
    expect(html).toContain("后台运行");
    expect(html).not.toContain("开始导出");
  });

  test("完成：显示完成和文件名，可以再次下载", () => {
    const html = render({ kind: "done", url: "/final.mp4" });
    expect(html).toContain("导出完成");
    expect(html).toContain("闯入者-第1集.mp4");
    expect(html).toContain("再次下载");
  });

  test("失败：显示原因，失败的那一步标出来，可以重试", () => {
    const html = render({ kind: "failed", at: "composing", message: "转码失败：素材无法解码" });
    expect(html).toContain("转码失败：素材无法解码");
    expect(html).toContain('data-state="failed"');
    expect(html).toContain("重试");
  });
});
