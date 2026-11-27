import { Blend, Lock, Maximize2, MonitorPlay, Type, Volume2, VolumeX } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";

import {
  IconToggle,
  FieldRow,
  InspectorSection,
  NumberField,
  Segmented,
  SliderField,
  StatStrip,
} from "./inspector-fields";
import {
  DEFAULT_OVERLAY,
  MAX_FADE_MS,
  clipEnd,
  clipLength,
  findClip,
  trackBadge,
  updateClip,
} from "./model";
import { OverlayPresets } from "./overlay-presets";
import { timecode } from "./preview/timecode";
import { restoreLength } from "./restore";
import type {
  EditorClip,
  EditorTimeline,
  OverlayParams,
  TextParams,
  TextPos,
  TextStyle,
  TimelineEditorHost,
} from "./types";

/** 百分比的范围（0–100，步长 1） */
const PERCENT = { min: 0, max: 100, step: 1, scale: 1 };

/** 秒数显示（一位小数） */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** 改动的两种提交方式：拖动或输入中只更新预览，松手、失焦、点按钮才算一次修改 */
type Apply = (next: EditorTimeline) => void;

/**
 * 选中片段的属性面板：头部是轨道编号、片段名和「起点 / 时长 / 结束」信息条，
 * 下面按分区卡片排：宿主追加区（如版本）、声音、淡入淡出、画面（叠加）、文字，最后是恢复原长。
 * 滑杆拖动期间走 onPreview（只更新预览），松手才走 onCommit，每次拖动在宿主撤销栈里只多一步；
 * 数值框回车或失焦提交；文字输入中 onPreview，失焦 onCommit。
 */
export function Inspector({
  timeline,
  clipId,
  host,
  readOnly,
  ratio = "9/16",
  onPreview,
  onCommit,
}: {
  /** 当前时间线（包含拖动中的预览改动） */
  timeline: EditorTimeline;
  /** 选中的片段；没有为 null */
  clipId: string | null;
  host: TimelineEditorHost;
  readOnly: boolean;
  /** 项目画面比例（CSS aspect-ratio），叠加位置预设的小画面用 */
  ratio?: string;
  /** 拖动或输入中：只更新预览 */
  onPreview: Apply;
  /** 一次完整的修改：松手、失焦或点按钮 */
  onCommit: Apply;
}) {
  const found = clipId ? findClip(timeline, clipId) : null;
  if (!found) {
    return <p className="text-muted-foreground py-12 text-center text-[12.5px]">未选中片段</p>;
  }
  const { clip, track } = found;
  const disabled = readOnly || track.locked;
  const media = clip.type === "text" ? null : host.resolve(clip);
  const patch = (change: Partial<EditorClip> | ((c: EditorClip) => EditorClip)) =>
    updateClip(timeline, clip.id, change);
  const title =
    clip.type === "text" ? (clip.text?.style === "title" ? "标题" : "字幕") : (media?.label ?? "");
  const ctx = { clip, patch, disabled, onPreview, onCommit };

  return (
    <div className="flex flex-col gap-3 px-1 pt-1 pb-3">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold">
          <span className="bg-chrome-hover text-muted-foreground shrink-0 rounded-md px-1.5 py-px font-mono text-[10.5px]">
            {trackBadge(timeline, track)}
          </span>
          <span className="min-w-0 flex-1 truncate" title={title}>
            {title}
          </span>
          {track.locked && (
            <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[11px] font-normal">
              <Lock className="size-3" />
              轨道已锁定
            </span>
          )}
        </div>
        <StatStrip
          items={[
            { label: "起点", value: timecode(clip.startMs) },
            { label: "时长", value: seconds(clipLength(clip)) },
            { label: "结束", value: timecode(clipEnd(clip)) },
          ]}
        />
      </div>

      {host.inspectorExtra?.(clip)}
      {(clip.type === "video" || clip.type === "audio") && <SoundSection {...ctx} />}
      {clip.overlay && <OverlaySection {...ctx} overlay={clip.overlay} ratio={ratio} />}
      {clip.text && <TextSection {...ctx} text={clip.text} timeline={timeline} />}
      {clip.type !== "text" && <FadeSection {...ctx} />}

      {media && clip.type !== "text" && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCommit(restoreLength(timeline, clip.id, media.durationMs))}
          className="hover:bg-chrome-hover text-muted-foreground hover:text-foreground flex h-9 items-center justify-center gap-1.5 rounded-full text-[12.5px] transition-colors disabled:opacity-45 [&_svg]:size-3.5"
        >
          <Maximize2 />
          {clip.type === "image" ? "恢复默认 3 秒" : "恢复原长"}
        </button>
      )}
    </div>
  );
}

/** 各分区共用的输入 */
interface SectionProps {
  clip: EditorClip;
  /** 在当前时间线上改这一段，返回新时间线 */
  patch: (change: Partial<EditorClip> | ((c: EditorClip) => EditorClip)) => EditorTimeline;
  disabled: boolean;
  onPreview: Apply;
  onCommit: Apply;
}

/** 声音：音量；静音开关在卡片头 */
function SoundSection({ clip, patch, disabled, onPreview, onCommit }: SectionProps) {
  return (
    <InspectorSection
      icon={<Volume2 />}
      title="声音"
      action={
        <IconToggle
          label={clip.muted ? "取消静音" : "静音此段"}
          pressed={clip.muted}
          disabled={disabled}
          onClick={() => onCommit(patch({ muted: !clip.muted }))}
        >
          {clip.muted ? <VolumeX /> : <Volume2 />}
        </IconToggle>
      }
    >
      <SliderField
        label="音量"
        value={clip.volume}
        range={{ min: 0, max: 200, step: 1, scale: 1 }}
        unit="%"
        disabled={disabled || clip.muted}
        onPreview={(v) => onPreview(patch({ volume: v }))}
        onCommit={(v) => onCommit(patch({ volume: v }))}
      />
    </InspectorSection>
  );
}

/** 淡入淡出：各自最长 3 秒，且不超过片段长度 */
function FadeSection({ clip, patch, disabled, onPreview, onCommit }: SectionProps) {
  const range = { min: 0, max: Math.min(MAX_FADE_MS, clipLength(clip)), step: 100, scale: 1000 };
  const row = (label: string, key: "fadeInMs" | "fadeOutMs") => (
    <SliderField
      label={label}
      value={clip[key]}
      range={range}
      unit="s"
      decimals={1}
      disabled={disabled}
      onPreview={(v) => onPreview(patch({ [key]: v }))}
      onCommit={(v) => onCommit(patch({ [key]: v }))}
    />
  );
  return (
    <InspectorSection icon={<Blend />} title="淡入淡出">
      {row("淡入", "fadeInMs")}
      {row("淡出", "fadeOutMs")}
    </InspectorSection>
  );
}

/** 画面（叠加轨）：位置预设、横纵位置、缩放、不透明度 */
function OverlaySection({
  overlay,
  ratio,
  patch,
  disabled,
  onPreview,
  onCommit,
}: SectionProps & { overlay: OverlayParams; ratio: string }) {
  const set = (change: Partial<OverlayParams>) =>
    patch((c) => ({ ...c, overlay: { ...(c.overlay ?? DEFAULT_OVERLAY), ...change } }));
  return (
    <InspectorSection icon={<MonitorPlay />} title="画面">
      <OverlayPresets
        overlay={overlay}
        ratio={ratio}
        disabled={disabled}
        onPick={(preset) => onCommit(set(preset))}
      />
      <FieldRow label="位置">
        <NumberField
          label="横向位置"
          prefix="X"
          value={overlay.x}
          range={PERCENT}
          unit="%"
          disabled={disabled}
          onCommit={(v) => onCommit(set({ x: v }))}
          className="w-auto flex-1"
        />
        <NumberField
          label="纵向位置"
          prefix="Y"
          value={overlay.y}
          range={PERCENT}
          unit="%"
          disabled={disabled}
          onCommit={(v) => onCommit(set({ y: v }))}
          className="w-auto flex-1"
        />
      </FieldRow>
      <SliderField
        label="缩放"
        value={overlay.scale}
        range={{ ...PERCENT, min: 10 }}
        unit="%"
        disabled={disabled}
        onPreview={(v) => onPreview(set({ scale: v }))}
        onCommit={(v) => onCommit(set({ scale: v }))}
      />
      <SliderField
        label="不透明度"
        value={overlay.opacity}
        range={PERCENT}
        unit="%"
        disabled={disabled}
        onPreview={(v) => onPreview(set({ opacity: v }))}
        onCommit={(v) => onCommit(set({ opacity: v }))}
      />
    </InspectorSection>
  );
}

/** 文字（字幕轨）：内容、样式、位置、字号 */
function TextSection({
  text,
  timeline,
  patch,
  disabled,
  onPreview,
  onCommit,
}: SectionProps & { text: TextParams; timeline: EditorTimeline }) {
  const set = (change: Partial<TextParams>) =>
    patch((c) => (c.text ? { ...c, text: { ...c.text, ...change } } : c));
  return (
    <InspectorSection icon={<Type />} title="文字">
      <Textarea
        aria-label="文字内容"
        value={text.text}
        disabled={disabled}
        rows={3}
        onChange={(event) => onPreview(set({ text: event.target.value }))}
        onBlur={() => onCommit(timeline)}
        className="bg-chrome-hover border-chrome-border rounded-xl text-[13px]"
      />
      <FieldRow label="样式">
        <Segmented<TextStyle>
          label="样式"
          value={text.style}
          options={[
            { value: "subtitle", label: "字幕" },
            { value: "title", label: "标题" },
          ]}
          disabled={disabled}
          onChange={(style) => onCommit(set({ style }))}
        />
      </FieldRow>
      <FieldRow label="位置">
        <Segmented<TextPos>
          label="位置"
          value={text.pos}
          options={[
            { value: "top", label: "顶部" },
            { value: "middle", label: "中间" },
            { value: "bottom", label: "底部" },
          ]}
          disabled={disabled}
          onChange={(pos) => onCommit(set({ pos }))}
        />
      </FieldRow>
      <SliderField
        label="字号"
        value={text.size}
        range={{ min: 60, max: 180, step: 5, scale: 1 }}
        unit="%"
        disabled={disabled}
        onPreview={(v) => onPreview(set({ size: v }))}
        onCommit={(v) => onCommit(set({ size: v }))}
      />
    </InspectorSection>
  );
}
