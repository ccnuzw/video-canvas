import { Maximize2, Volume2, VolumeX } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";

import {
  DEFAULT_OVERLAY,
  MAX_FADE_MS,
  clipEnd,
  clipLength,
  findClip,
  trackBadge,
  updateClip,
} from "./model";
import { Group, Option, Options, SliderRow } from "./inspector-fields";
import { timecode } from "./preview/timecode";
import { restoreLength } from "./restore";
import type {
  EditorClip,
  EditorTimeline,
  OverlayParams,
  TextParams,
  TimelineEditorHost,
} from "./types";

/** 叠加画面的预设位置 */
const PRESETS: { label: string; overlay: Omit<OverlayParams, "opacity"> }[] = [
  { label: "铺满", overlay: { x: 50, y: 50, scale: 100 } },
  { label: "右上小窗", overlay: { x: 72, y: 22, scale: 42 } },
  { label: "左下小窗", overlay: { x: 28, y: 78, scale: 42 } },
  { label: "居中", overlay: { x: 50, y: 50, scale: 62 } },
];

const percent = (value: number) => `${value}%`;
const seconds = (value: number) => `${(value / 1000).toFixed(1)}s`;

/**
 * 选中片段的属性面板：声音、淡入淡出、叠加位置、字幕文字和样式、恢复原长，宿主还能追加内容（如换版本）。
 * 滑杆拖动期间走 onPreview（只更新预览），松手才走 onCommit，所以每次拖动在宿主的撤销栈里只多一步；
 * 文字输入同理，输入中 onPreview，失焦 onCommit。
 */
export function Inspector({
  timeline,
  clipId,
  host,
  readOnly,
  onPreview,
  onCommit,
}: {
  /** 当前时间线（包含拖动中的预览改动） */
  timeline: EditorTimeline;
  /** 选中的片段；没有为 null */
  clipId: string | null;
  host: TimelineEditorHost;
  readOnly: boolean;
  /** 拖动或输入中：只更新预览 */
  onPreview: (next: EditorTimeline) => void;
  /** 一次完整的修改：松手、失焦或点按钮 */
  onCommit: (next: EditorTimeline) => void;
}) {
  const found = clipId ? findClip(timeline, clipId) : null;
  if (!found) {
    return <p className="text-muted-foreground py-12 text-center text-[12.5px]">未选中片段</p>;
  }
  const { clip, track } = found;
  const disabled = readOnly || track.locked;
  const media = clip.type === "text" ? null : host.resolve(clip);
  const length = clipLength(clip);
  const patch = (change: Partial<EditorClip> | ((c: EditorClip) => EditorClip)) =>
    updateClip(timeline, clip.id, change);
  const setOverlay = (change: Partial<OverlayParams>) =>
    patch((c) => ({ ...c, overlay: { ...(c.overlay ?? DEFAULT_OVERLAY), ...change } }));
  const setText = (change: Partial<TextParams>) =>
    patch((c) => (c.text ? { ...c, text: { ...c.text, ...change } } : c));
  const slider = (
    label: string,
    value: number,
    range: [number, number, number],
    format: (value: number) => string,
    apply: (value: number) => EditorTimeline,
  ) => (
    <SliderRow
      label={label}
      value={value}
      min={range[0]}
      max={range[1]}
      step={range[2]}
      format={format}
      disabled={disabled}
      onPreview={(next) => onPreview(apply(next))}
      onCommit={(next) => onCommit(apply(next))}
    />
  );

  const hasSound = clip.type === "video" || clip.type === "audio";
  const overlay = clip.overlay;
  const text = clip.text;
  const title =
    clip.type === "text" ? (text?.style === "title" ? "标题" : "字幕") : (media?.label ?? "");

  return (
    <div className="flex flex-col gap-5 px-1 pt-1 pb-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold">
          <span className="bg-chrome-hover text-muted-foreground rounded-md px-1.5 py-px font-mono text-[10.5px]">
            {trackBadge(timeline, track)}
          </span>
          <span className="truncate" title={title}>
            {title}
          </span>
        </div>
        <div className="text-muted-foreground font-mono text-[11.5px]">
          起点 {timecode(clip.startMs)} · 时长 {seconds(length)} · 结束 {timecode(clipEnd(clip))}
          {track.locked && " · 轨道已锁定"}
        </div>
      </div>

      {host.inspectorExtra?.(clip)}

      {hasSound && (
        <Group title="声音">
          {slider("音量", clip.volume, [0, 200, 1], percent, (v) => patch({ volume: v }))}
          <Options>
            <Option
              disabled={disabled}
              on={clip.muted}
              onClick={() => onCommit(patch({ muted: !clip.muted }))}
            >
              {clip.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
              {clip.muted ? "已静音" : "静音此段"}
            </Option>
          </Options>
        </Group>
      )}

      {overlay && (
        <Group title="画面">
          <Options>
            {PRESETS.map((preset) => (
              <Option
                key={preset.label}
                disabled={disabled}
                on={
                  overlay.x === preset.overlay.x &&
                  overlay.y === preset.overlay.y &&
                  overlay.scale === preset.overlay.scale
                }
                onClick={() => onCommit(setOverlay(preset.overlay))}
              >
                {preset.label}
              </Option>
            ))}
          </Options>
          {slider("横向", overlay.x, [0, 100, 1], percent, (v) => setOverlay({ x: v }))}
          {slider("纵向", overlay.y, [0, 100, 1], percent, (v) => setOverlay({ y: v }))}
          {slider("缩放", overlay.scale, [10, 100, 1], percent, (v) => setOverlay({ scale: v }))}
          {slider("不透明", overlay.opacity, [0, 100, 1], percent, (v) =>
            setOverlay({ opacity: v }),
          )}
        </Group>
      )}

      {text && (
        <>
          <Group title="文字">
            <Textarea
              value={text.text}
              disabled={disabled}
              rows={3}
              onChange={(event) => onPreview(setText({ text: event.target.value }))}
              onBlur={() => onCommit(timeline)}
              className="bg-chrome-hover border-chrome-border rounded-2xl"
            />
          </Group>
          <Group title="样式">
            <Options>
              <Option
                disabled={disabled}
                on={text.style === "subtitle"}
                onClick={() => onCommit(setText({ style: "subtitle" }))}
              >
                字幕
              </Option>
              <Option
                disabled={disabled}
                on={text.style === "title"}
                onClick={() => onCommit(setText({ style: "title" }))}
              >
                标题
              </Option>
            </Options>
          </Group>
          <Group title="位置">
            <Options>
              {(["top", "middle", "bottom"] as const).map((pos) => (
                <Option
                  key={pos}
                  disabled={disabled}
                  on={text.pos === pos}
                  onClick={() => onCommit(setText({ pos }))}
                >
                  {pos === "top" ? "顶部" : pos === "middle" ? "中间" : "底部"}
                </Option>
              ))}
            </Options>
            {slider("字号", text.size, [60, 180, 5], percent, (v) => setText({ size: v }))}
          </Group>
        </>
      )}

      {clip.type !== "text" && (
        <Group title="淡入淡出">
          {slider("淡入", clip.fadeInMs, [0, Math.min(MAX_FADE_MS, length), 100], seconds, (v) =>
            patch({ fadeInMs: v }),
          )}
          {slider("淡出", clip.fadeOutMs, [0, Math.min(MAX_FADE_MS, length), 100], seconds, (v) =>
            patch({ fadeOutMs: v }),
          )}
        </Group>
      )}

      {media && clip.type !== "text" && (
        <Options>
          <Option
            disabled={disabled}
            onClick={() => onCommit(restoreLength(timeline, clip.id, media.durationMs))}
          >
            <Maximize2 className="size-3.5" />
            {clip.type === "image" ? "恢复默认 3 秒" : "恢复原长"}
          </Option>
        </Options>
      )}
    </div>
  );
}
