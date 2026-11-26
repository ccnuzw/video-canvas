import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { emptyTimeline } from "@/components/timeline-editor/model";
import { mainItems } from "@/components/timeline-editor/player-plan";
import { Preview } from "@/components/timeline-editor/preview/preview";
import { timecode } from "@/components/timeline-editor/preview/timecode";
import type { PlayerApi } from "@/components/timeline-editor/use-player";

import { resolve, sampleTimeline } from "./fixtures";

const noop = () => {};

/** 不真播放的播放器替身 */
function player(over: Partial<PlayerApi> = {}): PlayerApi {
  return {
    handle: {
      time: () => 0,
      playing: () => false,
      duration: () => 5000,
      seek: noop,
      pause: noop,
      toggle: noop,
      subscribe: () => noop,
    },
    playing: false,
    mainIndex: 0,
    activeSlot: 0,
    items: [],
    mounted: [],
    version: 0,
    at: 0,
    bindVideo: () => noop,
    bindImage: noop,
    register: noop,
    ...over,
  };
}

describe("时码", () => {
  test("毫秒写成 分:秒.帧（30fps）", () => {
    expect(timecode(0)).toBe("00:00.00");
    expect(timecode(61_500)).toBe("01:01.15");
  });
});

describe("预览", () => {
  test("时间线完全为空：显示空状态和宿主的入口，没有播放控制", () => {
    const html = renderToStaticMarkup(
      <Preview
        timeline={emptyTimeline()}
        player={player()}
        ratio="9/16"
        readOnly={false}
        emptyTitle="这一集还没有片段"
        emptyAction={{ label: "去片场", run: noop }}
        onToggleMainMute={noop}
      />,
    );
    expect(html).toContain("这一集还没有片段");
    expect(html).toContain("去片场");
    expect(html).not.toContain('aria-label="播放"');
  });

  test("有内容：播放按钮、总时长、主轨静音、全屏；画面按比例", () => {
    const timeline = sampleTimeline();
    const html = renderToStaticMarkup(
      <Preview
        timeline={timeline}
        player={player({ items: mainItems(timeline, resolve) })}
        ratio="9/16"
        readOnly={false}
        onToggleMainMute={noop}
      />,
    );
    expect(html).toContain('aria-label="播放"');
    expect(html).toContain("/ 00:08.00");
    expect(html).toContain('aria-label="主轨静音"');
    expect(html).toContain('aria-label="全屏"');
    expect(html).toContain("aspect-ratio:9/16");
  });

  test("播放中按钮变暂停；主轨已静音显示取消；只读禁用静音按钮", () => {
    const timeline = sampleTimeline();
    timeline.tracks.find((t) => t.id === "main")!.muted = true;
    const html = renderToStaticMarkup(
      <Preview
        timeline={timeline}
        player={player({ playing: true, items: mainItems(timeline, resolve) })}
        ratio="9/16"
        readOnly
        onToggleMainMute={noop}
      />,
    );
    expect(html).toContain('aria-label="暂停"');
    expect(html).toContain('aria-label="取消主轨静音"');
    expect(html).toMatch(
      /aria-label="取消主轨静音"[^>]*disabled|disabled[^>]*aria-label="取消主轨静音"/,
    );
  });

  test("此刻有字幕就显示文字，标题用更大的字，没有字幕时不显示", () => {
    const timeline = sampleTimeline();
    const items = mainItems(timeline, resolve);
    const withText = renderToStaticMarkup(
      <Preview
        timeline={timeline}
        player={player({ items, at: 500 })}
        ratio="9/16"
        readOnly={false}
        onToggleMainMute={noop}
      />,
    );
    expect(withText).toContain("你好世界");
    expect(withText).toContain("font-size:4.6cqw");
    const later = renderToStaticMarkup(
      <Preview
        timeline={timeline}
        player={player({ items, at: 3000 })}
        ratio="9/16"
        readOnly={false}
        onToggleMainMute={noop}
      />,
    );
    expect(later).not.toContain("你好世界");
    timeline.tracks.find((t) => t.id === "text1")!.clips[0].text!.style = "title";
    const title = renderToStaticMarkup(
      <Preview
        timeline={timeline}
        player={player({ items, at: 500 })}
        ratio="9/16"
        readOnly={false}
        onToggleMainMute={noop}
      />,
    );
    expect(title).toContain("font-size:7.5cqw");
  });

  test("占位显示素材名和「暂无可用素材」，失效显示「素材已失效」", () => {
    const timeline = sampleTimeline();
    const main = timeline.tracks.find((t) => t.id === "main")!;
    main.clips[0] = { ...main.clips[0], ref: "ph1" };
    main.clips[1] = { ...main.clips[1], ref: "bad1" };
    const items = mainItems(timeline, resolve);
    const placeholder = renderToStaticMarkup(
      <Preview
        timeline={timeline}
        player={player({ items, mainIndex: 0 })}
        ratio="9/16"
        readOnly={false}
        onToggleMainMute={noop}
      />,
    );
    expect(placeholder).toContain("素材 ph1");
    expect(placeholder).toContain("暂无可用素材");
    const broken = renderToStaticMarkup(
      <Preview
        timeline={timeline}
        player={player({ items, mainIndex: 1 })}
        ratio="9/16"
        readOnly={false}
        onToggleMainMute={noop}
      />,
    );
    expect(broken).toContain("素材已失效");
  });

  test("窗口内的叠加画面和音频会渲染成元素，叠加初始隐藏并按位置摆放", () => {
    const timeline = sampleTimeline();
    const overlay = timeline.tracks.find((t) => t.id === "overlay1")!.clips[0];
    const html = renderToStaticMarkup(
      <Preview
        timeline={timeline}
        player={player({
          items: mainItems(timeline, resolve),
          mounted: [
            {
              id: "o1",
              kind: "video",
              url: "https://x/o1.mp4",
              trackId: "overlay1",
              trackKind: "overlay",
              trackMuted: false,
              hidden: false,
              clip: overlay,
            },
            {
              id: "v1",
              kind: "audio",
              url: "https://x/v1.mp3",
              trackId: "voice1",
              trackKind: "audio",
              trackMuted: false,
              hidden: false,
              clip: timeline.tracks.find((t) => t.id === "voice1")!.clips[0],
            },
          ],
        })}
        ratio="9/16"
        readOnly={false}
        onToggleMainMute={noop}
      />,
    );
    expect(html).toContain("https://x/o1.mp4");
    expect(html).toContain("left:30%");
    expect(html).toContain("width:50%");
    expect(html).toContain("visibility:hidden");
    expect(html).toContain("<audio");
  });
});
