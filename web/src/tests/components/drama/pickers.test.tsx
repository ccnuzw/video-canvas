import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { mapStyles } from "@/api/drama";
import type { BackendDramaStyles, DramaStyles } from "@/api/drama/type";
import { StyleGrid } from "@/components/drama/pickers";
import { CUSTOM_STYLE_KEY } from "@/utils/drama/options";

/**
 * 内置画风清单（styles.json 现为迁移种子与空表兜底，见 docs/design/短剧预设后台/短剧预设后台.md）。
 * 这里只用它校验「随前端发布的静态预览图确实存在」，画风的可选清单以后台返回为准。
 */
const seed: BackendDramaStyles = JSON.parse(
  readFileSync(
    new URL("../../../../../backend/internal/drama/styles.json", import.meta.url),
    "utf8",
  ),
);

const renderGrid = (styles: DramaStyles["styles"], value = "with_pic") =>
  renderToStaticMarkup(
    <StyleGrid
      styles={styles}
      value={value}
      custom=""
      onPick={() => {}}
      onCustomChange={() => {}}
    />,
  );

describe("画风选择器预览图", () => {
  test("有预览地址的渲染图片，没有的保留渐变占位", () => {
    const styles: DramaStyles["styles"] = [
      {
        key: "with_pic",
        name: "有图风格",
        prompt: "有图的描述",
        previewUrl: "/drama-styles/with_pic.webp",
      },
      { key: "no_pic", name: "无图风格", prompt: "无图的描述", previewUrl: "" },
    ];
    const html = renderGrid(styles);

    // 有图：只渲染这一张，地址直接用后台给的，不再按 key 拼路径
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('src="/drama-styles/with_pic.webp"');
    expect(html).toContain('alt="有图风格风格预览"');

    // 没图的仍要能选：占位、名称、提示词、选中态都在
    expect(html).toContain('data-slot="drama-poster"');
    expect(html).toContain("无图风格");
    expect(html).toContain('title="有图的描述"');
    expect(html).toContain('title="无图的描述"');
    expect(html).toMatch(/aria-pressed="true"[^>]*title="有图的描述"/);
  });

  test("后台新上传的预览图用平台预览路由，映射层不会丢地址", () => {
    const mapped = mapStyles({
      genres: null,
      styles: [
        { key: "new_style", name: "新风格", prompt: "描述" },
        {
          key: "uploaded",
          name: "上传过图的",
          prompt: "描述",
          preview_url: "/api/v1/drama-presets/previews/abcd1234.webp",
        },
      ],
    });
    expect(mapped.styles[0].previewUrl).toBe("");
    expect(mapped.styles[1].previewUrl).toBe("/api/v1/drama-presets/previews/abcd1234.webp");
  });

  test("内置静态预览都是实际存在的 WebP 图片，适合缩略图加载", async () => {
    for (const style of seed.styles ?? []) {
      const file = Bun.file(
        new URL(`../../../../public/drama-styles/${style.key}.webp`, import.meta.url),
      );
      expect(await file.exists()).toBe(true);
      const bytes = new Uint8Array(await file.arrayBuffer());
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
      expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WEBP");
      expect(bytes.length).toBeLessThan(200_000);
    }
  });

  test("后台新建但还没配图的画风不请求图片，自定义仍显示描述框", () => {
    const html = renderGrid(
      [{ key: "future_style", name: "未来画风", prompt: "新的画风描述", previewUrl: "" }],
      CUSTOM_STYLE_KEY,
    );
    expect(html).not.toContain("<img ");
    expect(html).toContain('data-slot="drama-poster"');
    expect(html).toContain("未来画风");
    expect(html).toContain("自定义");
    expect(html).toContain("<textarea");
  });
});
