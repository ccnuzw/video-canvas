import { useRef, useState } from "react";

import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";

import { currentMediaDrag, endMediaDrag, isMediaDrag } from "../drag";
import {
  addTrack,
  clipEnd,
  findClip,
  mainTrack,
  removeTrack,
  snapTargets,
  timelineEnd,
  trackBadge,
  updateTrack,
} from "../model";
import { SNAP_PX } from "../types";
import type {
  EditError,
  EditorTimeline,
  TimelineEditorHost,
  TimelinePanelProps,
  TrackKind,
} from "../types";
import { ClipMenuContent } from "./clip-menu";
import { dropTargetFor, type DropMark } from "./drag-logic";
import {
  addSubtitle,
  muteCommand,
  removeSelection,
  replaceTrackClips,
  restoreCommand,
  splitCommand,
  trimCommand,
} from "./edit-actions";
import {
  HEAD_WIDTH,
  RULER_HEIGHT,
  SCROLLBAR_GUTTER,
  formatClock,
  msToX,
  rulerTicks,
} from "./layout";
import { useMarquee } from "./marquee";
import { TimelineScrollbar } from "./scrollbar";
import { Toolbar } from "./toolbar";
import { TrackRow } from "./track-row";
import type { TrackToggle } from "./track-header";
import { useTimelineDrag, type Ghost } from "./use-timeline-drag";
import { useTimelineShortcuts } from "./use-timeline-shortcuts";
import { useTimelineView } from "./use-timeline-view";

/** 编辑命令的结果：成功带新时间线，失败带原因 */
type Result = { timeline: EditorTimeline } | EditError;

/** 两个落点是不是同一个，避免拖动时每次 dragover 都重绘 */
const sameMark = (a: DropMark | null, b: DropMark | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * 多轨时间线面板：工具条、刻度尺和播放头、左侧固定的轨道头、按时间摆放的片段。
 * 所有编辑都走 model 的纯函数，成功后 onChange 一次，失败 onError 提示；撤销历史和保存由宿主负责。
 */
export function TimelinePanel(props: TimelinePanelProps) {
  const { timeline, host, selectedIds, onSelect, player, readOnly, onChange, onError } = props;
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const multiSelected = selectedIds.length > 1;
  const selectOne = (id: string | null) => onSelect(id ? [id] : []);
  const [snapOn, setSnapOn] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dropMark, setDropMark] = useState<DropMark | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const view = useTimelineView(scrollRef, playheadRef, knobRef, player, timelineEnd(timeline));
  const { pps } = view;
  const marquee = useMarquee(scrollRef, timeline.tracks, pps, onSelect, (clientX) => {
    onSelect([]);
    player.pause();
    player.seek(view.timeAt(clientX));
  });
  const highlighted = new Set(marquee.previewIds ?? selectedIds);
  const drag = useTimelineDrag({
    timeline,
    host,
    player,
    readOnly,
    pps,
    snapOn,
    onChange,
    onError,
    onSelect: selectOne,
    timeAt: view.timeAt,
    laneAt: view.laneAt,
  });
  const shown = drag.shown;

  /** 应用一个编辑结果：失败提示原因，成功交给宿主，并让调用方做后续（选中、移动播放头） */
  const apply = <T extends Result>(result: T | EditError, after?: (ok: T) => void) => {
    if ("error" in result) return onError(result.error);
    onChange(result.timeline);
    after?.(result);
  };

  const split = () => {
    if (multiSelected || marquee.box) return;
    apply(splitCommand(timeline, host.resolve, selectedId, player.time()), (r) =>
      selectOne(r.selectId),
    );
  };
  const trim = (side: "left" | "right") => {
    if (multiSelected || marquee.box) return;
    apply(trimCommand(timeline, host.resolve, selectedId, player.time(), side), (r) =>
      player.seek(r.playhead),
    );
  };
  const remove = (ids: readonly string[]) => {
    if (!marquee.box) apply(removeSelection(timeline, ids), () => onSelect([]));
  };
  const toggleSnap = () => setSnapOn((on) => !on);

  const addTrackOf = (kind: Exclude<TrackKind, "main">) => apply(addTrack(timeline, kind));
  const toggleTrack = (trackId: string, toggle: TrackToggle) => {
    const track = timeline.tracks.find((item) => item.id === trackId);
    if (track) onChange(updateTrack(timeline, trackId, { [toggle]: !track[toggle] }));
  };
  const deleteTrack = (trackId: string) => {
    onChange(removeTrack(timeline, trackId));
    onSelect(selectedIds.filter((id) => findClip(timeline, id)?.track.id !== trackId));
  };
  const addSub = (trackId: string) =>
    apply(addSubtitle(timeline, trackId, player.time()), (r) => selectOne(r.selectId));
  const generate = (trackId: string) => {
    const clips = host.generateSubtitles?.() ?? [];
    if (clips.length === 0) return onError("没有可生成的台词");
    const next = replaceTrackClips(timeline, trackId, clips);
    if ("error" in next) onError(next.error);
    else onChange(next);
  };

  useTimelineShortcuts({
    readOnly,
    hasSelection: selectedIds.length > 0,
    toggle: player.toggle,
    split,
    trimLeft: () => trim("left"),
    trimRight: () => trim("right"),
    remove: () => remove(selectedIds),
    toggleSnap,
    undo: props.onUndo,
    redo: props.onRedo,
    deselect: () => {
      marquee.cancel();
      onSelect([]);
    },
  });

  /** 素材拖在时间线上时指针下的落点 */
  const markAt = (clientX: number, clientY: number): DropMark | null => {
    const media = currentMediaDrag();
    if (!media || readOnly) return null;
    const targets = snapTargets(timeline, player.time());
    return dropTargetFor(
      timeline,
      media.type,
      view.laneAt(clientY),
      view.timeAt(clientX),
      targets,
      (SNAP_PX / pps) * 1000,
    );
  };

  const main = mainTrack(timeline);
  // 黄色插入线只给从素材面板拖进主轨用；拖时间线上的片段时其余片段直接让位
  const insertIndex = dropMark?.kind === "main" ? dropMark.index : null;
  const insertX =
    insertIndex === null
      ? null
      : msToX(
          insertIndex >= main.clips.length
            ? main.clips.at(-1)
              ? clipEnd(main.clips.at(-1)!)
              : 0
            : main.clips[insertIndex].startMs,
          pps,
        );
  const snapAt = drag.snapAt ?? (dropMark?.kind === "track" ? dropMark.snapAt : null);

  const menuFound = menuId ? findClip(timeline, menuId) : null;
  const menuMedia =
    menuFound && menuFound.clip.type !== "text" ? host.resolve(menuFound.clip) : null;
  const trackCounts = {
    overlay: timeline.tracks.filter((t) => t.kind === "overlay").length,
    text: timeline.tracks.filter((t) => t.kind === "text").length,
    audio: timeline.tracks.filter((t) => t.kind === "audio").length,
  };

  return (
    <section
      aria-label="时间线"
      className="bg-chrome ring-chrome-border flex size-full min-h-0 flex-col rounded-2xl ring-1 ring-inset select-none [corner-shape:squircle]"
    >
      <Toolbar
        readOnly={readOnly}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        hasSelection={selectedIds.length > 0}
        multiSelected={multiSelected}
        snapOn={snapOn}
        pps={pps}
        minPps={view.minPps}
        trackCounts={trackCounts}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onSplit={split}
        onTrimLeft={() => trim("left")}
        onTrimRight={() => trim("right")}
        onRemove={() => remove(selectedIds)}
        onAddTrack={addTrackOf}
        onToggleSnap={toggleSnap}
        onZoom={view.zoomTo}
        onFit={view.fitNow}
      />
      {/* 原生滚动条隐藏，换成只在轨道内容区里的自绘细滚动条：一直显示，缩放时不会一闪一闪 */}
      <div className="relative min-h-0 min-w-0 flex-1">
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div
                ref={scrollRef}
                className="relative size-full overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                onContextMenu={(event) => {
                  const id = (event.target as HTMLElement).closest<HTMLElement>("[data-clip]")
                    ?.dataset.clip;
                  const found = id ? findClip(timeline, id) : null;
                  if (!found || readOnly || found.track.locked) {
                    event.preventDefault();
                    event.stopPropagation();
                    setMenuId(null);
                    return;
                  }
                  setMenuId(found.clip.id);
                  selectOne(found.clip.id);
                }}
              />
            }
          >
            <div
              style={{ width: HEAD_WIDTH + view.width, paddingBottom: SCROLLBAR_GUTTER }}
              className="relative min-h-full"
              onPointerMove={marquee.onPointerMove}
              onPointerUp={marquee.onPointerUp}
              onPointerCancel={marquee.onPointerCancel}
              onLostPointerCapture={marquee.onPointerCancel}
              onDragOver={(event) => {
                if (readOnly || !isMediaDrag(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                const next = markAt(event.clientX, event.clientY);
                setDropMark((prev) => (sameMark(prev, next) ? prev : next));
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setDropMark(null);
              }}
              onDrop={(event) => {
                const media = currentMediaDrag();
                const mark = markAt(event.clientX, event.clientY);
                setDropMark(null);
                endMediaDrag();
                if (!media || readOnly || !mark) return;
                event.preventDefault();
                if (mark.kind === "main") return props.onDropMedia(media, mark);
                if (!mark.ok) return onError("这里已有片段，换个位置");
                props.onDropMedia(media, {
                  kind: "track",
                  trackId: mark.trackId,
                  startMs: mark.startMs,
                });
              }}
            >
              <div
                style={{ height: RULER_HEIGHT }}
                className="border-chrome-border/60 sticky top-0 z-40 flex border-b"
              >
                <div
                  style={{ width: HEAD_WIDTH }}
                  className="bg-chrome border-chrome-border sticky left-0 z-10 shrink-0 border-r backdrop-blur-xl"
                />
                <div
                  style={{ width: view.width }}
                  onPointerDown={drag.startSeek}
                  className="bg-chrome relative shrink-0 cursor-pointer backdrop-blur-xl"
                >
                  {rulerTicks(view.width, pps).map((s) => (
                    <span
                      key={s}
                      style={{ left: msToX(s * 1000, pps) }}
                      className="text-muted-foreground absolute top-0 h-full border-l border-current/30 pt-1.5 pl-1 font-mono text-[10.5px]"
                    >
                      {formatClock(s)}
                    </span>
                  ))}
                  <div ref={knobRef} className="pointer-events-none absolute top-0 left-0 z-10">
                    <span className="bg-foreground absolute top-0.5 -left-1.5 h-3.5 w-3 rounded-[3px_3px_6px_6px]" />
                  </div>
                </div>
              </div>
              {shown.tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  badge={trackBadge(shown, track)}
                  host={host}
                  pps={pps}
                  width={view.width}
                  selectedIds={highlighted}
                  activeId={marquee.box ? null : selectedId}
                  readOnly={readOnly}
                  drag={drag.drag}
                  insertX={track.kind === "main" ? insertX : null}
                  dropBox={
                    dropMark?.kind === "track" && dropMark.trackId === track.id
                      ? { startMs: dropMark.startMs, ok: dropMark.ok }
                      : null
                  }
                  onClipPointerDown={drag.startClip}
                  onLanePointerDown={(event) => {
                    if (event.button !== 0 || (event.target as Element).closest("button")) return;
                    if (event.pointerType === "touch") {
                      onSelect([]);
                      drag.startSeek(event);
                    } else if (!drag.drag) marquee.start(event);
                  }}
                  onToggle={toggleTrack}
                  onAddSubtitle={addSub}
                  onGenerate={generate}
                  onRemove={deleteTrack}
                />
              ))}
              {marquee.box && (
                <div
                  aria-hidden
                  style={marquee.box}
                  className="border-primary/70 bg-primary/15 pointer-events-none absolute z-20 border"
                />
              )}
              {snapAt !== null && (
                <div
                  style={{ left: HEAD_WIDTH + msToX(snapAt, pps), top: RULER_HEIGHT }}
                  className="pointer-events-none absolute bottom-0 z-[45] w-0 border-l border-dashed border-sky-400"
                />
              )}
              <div
                ref={playheadRef}
                className="pointer-events-none absolute inset-y-0 left-0 z-50 w-0"
              >
                <span className="bg-foreground absolute inset-y-0 -left-px w-0.5" />
              </div>
            </div>
          </ContextMenuTrigger>
          {menuFound && (
            <ClipMenuContent
              clip={menuFound.clip}
              media={menuMedia}
              host={host}
              onMute={() => apply(muteCommand(timeline, menuFound.clip.id))}
              onRestore={() => apply(restoreCommand(timeline, host.resolve, menuFound.clip.id))}
              onRemove={() => remove([menuFound.clip.id])}
            />
          )}
        </ContextMenu>
        <TimelineScrollbar
          scrollRef={scrollRef}
          axis="x"
          className="bottom-1.5 h-1.5"
          style={{ left: HEAD_WIDTH + 8, right: 16 }}
        />
        <TimelineScrollbar
          scrollRef={scrollRef}
          axis="y"
          className="right-1.5 w-1.5"
          style={{ top: RULER_HEIGHT + 4, bottom: 16 }}
        />
      </div>
      {drag.ghost && <ClipGhost ghost={drag.ghost} timeline={timeline} host={host} />}
    </section>
  );
}

/** 片段拖进主轨时跟着指针走的影子：半透明的主色块加片段名字，落点处另有虚线占位槽 */
function ClipGhost({
  ghost,
  timeline,
  host,
}: {
  ghost: Ghost;
  timeline: EditorTimeline;
  host: TimelineEditorHost;
}) {
  const clip = findClip(timeline, ghost.id)?.clip;
  const label = !clip
    ? ""
    : clip.type === "text"
      ? (clip.text?.text ?? "")
      : host.resolve(clip).label;
  return (
    <div
      aria-hidden
      style={{ left: ghost.x, top: ghost.y, width: ghost.width, height: ghost.height }}
      className="bg-primary/25 ring-primary pointer-events-none fixed z-[60] overflow-hidden rounded-lg px-1.5 py-0.5 text-[11px] text-white shadow-lg ring-2 backdrop-blur-sm [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]"
    >
      <span className="block truncate">{label}</span>
    </div>
  );
}
