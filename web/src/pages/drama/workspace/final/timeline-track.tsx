import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  CircleMinus,
  CirclePlus,
  Clapperboard,
  Image as ImageIcon,
  Link,
  Maximize2,
  Pin,
  Redo2,
  Scan,
  Scissors,
  Trash2,
  TriangleAlert,
  Undo2,
  Volume2,
  VolumeX,
} from "lucide-react";

import type { Segment, TimelineClip } from "@/api/drama/type";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import {
  clipLength,
  clipStarts,
  insertIndexAt,
  totalMs,
  trimEdge,
  type ClipSource,
} from "@/utils/drama/timeline";

import { isTimelineDrag, readTimelineDrag, type TimelineDragPayload } from "./drag";
import type { TimelinePlayer } from "./use-timeline-player";
import { useThumbStrip } from "./use-thumb-strip";

/** 轨道左侧留白（像素），刻度 0 从这里开始 */
const PAD = 12;
/** 缩放范围：每秒多少像素 */
const MIN_PPS = 2;
const MAX_PPS = 160;
/** 轨道末尾留白（像素），方便把素材拖到最后 */
const TAIL = 48;
/** 缩略图一格的宽度（像素） */
const TILE = 48;
/** 刻度间隔候选（秒），取第一个间距不小于 64px 的 */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120];

const clampPps = (pps: number) => Math.min(MAX_PPS, Math.max(MIN_PPS, pps));
const toSlider = (pps: number) =>
  Math.round((Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 100);
const fromSlider = (value: number) => MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, value / 100);
const mmss = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** 指针拖动中的状态：拖边裁剪 / 拖段换位置 / 拖播放头 */
type Drag =
  | {
      mode: "trim";
      id: string;
      side: "start" | "end";
      x0: number;
      origin: TimelineClip;
      maxMs: number;
      draft: TimelineClip;
    }
  | { mode: "move"; id: string; from: number; x0: number; moving: boolean; insert: number | null }
  | { mode: "seek" };

/** 轨道的编辑回调 */
export type TrackActions = {
  select: (id: string | null) => void;
  /** 拖边松手：把这一段换成新的入出点 */
  commitTrim: (clip: TimelineClip) => void;
  move: (from: number, to: number) => void;
  drop: (index: number, payload: TimelineDragPayload) => void;
  split: () => void;
  trimLeft: () => void;
  trimRight: () => void;
  remove: (id?: string) => void;
  undo: () => void;
  redo: () => void;
  toggleTrackMute: () => void;
  toggleClipMute: (id: string) => void;
  restore: (id: string) => void;
  swap: (id: string, taskId: string | "follow") => void;
  goStudio: () => void;
};

/**
 * 成片剪辑台的单轨时间线：段首尾相接（磁吸），拖两边裁剪、长按拖动换位置、从素材面板拖入插入，
 * 点刻度尺或空白处定位播放头，右键段换版本、静音、恢复原长、删除。
 */
export function TimelineTrack({
  clips,
  sources,
  segments,
  selected,
  syncIds,
  player,
  muted,
  readOnly,
  canUndo,
  canRedo,
  actions,
}: {
  clips: readonly TimelineClip[];
  sources: readonly ClipSource[];
  segments: readonly Segment[];
  selected: string | null;
  /** 片场同步改过的段（蓝色标记） */
  syncIds: ReadonlySet<string>;
  player: TimelinePlayer;
  muted: boolean;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  actions: TrackActions;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(14);
  const [fit, setFit] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  /** 可见区域宽度（像素），由 ResizeObserver 维护 */
  const [viewport, setViewport] = useState(900);
  /** 事件处理里读最新缩放用；渲染只读 state */
  const ppsRef = useRef(pps);
  useLayoutEffect(() => {
    ppsRef.current = pps;
  }, [pps]);

  // 拖边时用草稿段画，松手才写进清单（一步撤销）
  const shown =
    drag?.mode === "trim" ? clips.map((clip) => (clip.id === drag.id ? drag.draft : clip)) : clips;
  const starts = clipStarts(shown);
  const total = totalMs(shown);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewport(el.clientWidth);
    const observer = new ResizeObserver(() => setViewport(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 适配宽度：整条时间线正好铺满可见区域；剪辑后总长变了也跟着适配，手动缩放过就不再自动
  const clipsTotal = totalMs(clips);
  useLayoutEffect(() => {
    if (fit) setPps(clampPps((viewport - PAD - TAIL) / Math.max(clipsTotal / 1000, 8)));
  }, [fit, viewport, clipsTotal]);

  // 播放头不走 React 渲染：订阅播放器时钟直接改位置；播放时滚动跟随
  useEffect(() => {
    const update = () => {
      const x = PAD + (player.time() / 1000) * ppsRef.current;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      const el = scrollRef.current;
      if (el && player.playing && (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft)) {
        el.scrollLeft = Math.max(0, x - 80);
      }
    };
    update();
    return player.subscribe(update);
  }, [player, pps]);

  /** 缩放时以播放头为锚：记下播放头在可见区域里的位置，缩放后滚到让它停在原处，画面不跳 */
  const anchor = useRef<{ t: number; x: number } | null>(null);
  const zoom = (next: number) => {
    const el = scrollRef.current;
    const t = player.time();
    if (el) anchor.current = { t, x: PAD + (t / 1000) * ppsRef.current - el.scrollLeft };
    setFit(false);
    setPps(clampPps(next));
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const at = anchor.current;
    anchor.current = null;
    if (el && at) el.scrollLeft = Math.max(0, PAD + (at.t / 1000) * pps - at.x);
  }, [pps]);

  /** 指针位置对应的时间线毫秒 */
  const timeAt = (clientX: number) => {
    const rect = innerRef.current?.getBoundingClientRect();
    return rect ? ((clientX - rect.left - PAD) / ppsRef.current) * 1000 : 0;
  };

  const setDragBoth = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    if (current.mode === "seek") return player.seek(timeAt(event.clientX));
    if (current.mode === "trim") {
      const delta = ((event.clientX - current.x0) / ppsRef.current) * 1000;
      setDragBoth({
        ...current,
        draft: trimEdge(current.origin, current.side, delta, current.maxMs),
      });
      return;
    }
    if (!current.moving && Math.abs(event.clientX - current.x0) < 5) return;
    setDragBoth({ ...current, moving: true, insert: insertIndexAt(clips, timeAt(event.clientX)) });
  };

  const onPointerUp = () => {
    const current = dragRef.current;
    setDragBoth(null);
    if (!current) return;
    if (
      current.mode === "trim" &&
      (current.draft.inMs !== current.origin.inMs || current.draft.outMs !== current.origin.outMs)
    ) {
      actions.commitTrim(current.draft);
    }
    if (current.mode === "move" && current.moving && current.insert !== null)
      actions.move(current.from, current.insert);
  };

  const startSeek = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    player.pause();
    player.seek(timeAt(event.clientX));
    setDragBoth({ mode: "seek" });
  };

  const startClip = (event: React.PointerEvent, index: number, side: "start" | "end" | null) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const clip = clips[index];
    actions.select(clip.id);
    if (readOnly) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (side) {
      const maxMs = sources[index]?.durationMs ?? clip.outMs;
      setDragBoth({
        mode: "trim",
        id: clip.id,
        side,
        x0: event.clientX,
        origin: clip,
        maxMs,
        draft: clip,
      });
    } else {
      setDragBoth({
        mode: "move",
        id: clip.id,
        from: index,
        x0: event.clientX,
        moving: false,
        insert: null,
      });
    }
  };

  const step = STEPS.find((s) => s * pps >= 64) ?? 120;
  // 适配宽度时正好铺满不溢出；放大后才出现滚动
  const widthPx = Math.max(PAD + (total / 1000) * pps + TAIL, viewport);
  const ticks: number[] = [];
  for (let s = 0; s <= (widthPx - PAD) / pps; s += step) ticks.push(s);
  const insertMark = drag?.mode === "move" && drag.moving ? drag.insert : dropAt;
  const insertX =
    insertMark === null
      ? null
      : PAD + ((insertMark >= shown.length ? total : starts[insertMark]) / 1000) * pps;

  const menuIndex = clips.findIndex((clip) => clip.id === menuId);
  const menuClip = clips[menuIndex];
  const menuSource = sources[menuIndex];
  const menuSegment =
    menuClip?.kind === "segment" ? segments.find((s) => s.id === menuClip.segmentId) : undefined;

  return (
    <section
      aria-label="时间线"
      className="bg-chrome ring-chrome-border flex size-full min-h-0 flex-col rounded-2xl ring-1 ring-inset [corner-shape:squircle]"
    >
      <div className="border-chrome-border flex items-center gap-0.5 border-b px-2.5 py-1.5">
        <ToolButton
          label="撤销"
          shortcut="⌘Z"
          disabled={readOnly || !canUndo}
          onClick={actions.undo}
        >
          <Undo2 />
        </ToolButton>
        <ToolButton
          label="重做"
          shortcut="⇧⌘Z"
          disabled={readOnly || !canRedo}
          onClick={actions.redo}
        >
          <Redo2 />
        </ToolButton>
        <span className="bg-chrome-border mx-1.5 h-4.5 w-px" />
        <ToolButton label="拆分" shortcut="S" disabled={readOnly} onClick={actions.split}>
          <Scissors />
        </ToolButton>
        <ToolButton
          label="删掉播放头左边"
          shortcut="Q"
          disabled={readOnly}
          onClick={actions.trimLeft}
        >
          <ArrowLeftToLine />
        </ToolButton>
        <ToolButton
          label="删掉播放头右边"
          shortcut="W"
          disabled={readOnly}
          onClick={actions.trimRight}
        >
          <ArrowRightToLine />
        </ToolButton>
        <ToolButton
          label="删除"
          shortcut="Delete"
          disabled={readOnly || !selected}
          onClick={() => actions.remove()}
        >
          <Trash2 />
        </ToolButton>
        <span className="flex-1" />
        <ToolButton label="缩小" onClick={() => zoom(pps / 1.4)}>
          <CircleMinus />
        </ToolButton>
        <input
          type="range"
          min={0}
          max={100}
          value={toSlider(pps)}
          aria-label="缩放"
          onChange={(event) => zoom(fromSlider(Number(event.target.value)))}
          className="accent-foreground w-28"
        />
        <ToolButton label="放大" onClick={() => zoom(pps * 1.4)}>
          <CirclePlus />
        </ToolButton>
        <ToolButton label="适配宽度" onClick={() => setFit(true)}>
          <Scan />
        </ToolButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-12 shrink-0 flex-col items-center pt-[42px]">
          <ToolButton
            label={muted ? "取消整轨静音" : "整轨静音"}
            disabled={readOnly}
            onClick={actions.toggleTrackMute}
            active={muted}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </ToolButton>
        </div>
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div
                ref={scrollRef}
                className="relative min-w-0 flex-1 overflow-x-scroll overflow-y-hidden"
                onWheel={(event) => {
                  if (!event.metaKey && !event.ctrlKey) return;
                  event.preventDefault();
                  zoom(pps * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
                }}
                onContextMenu={(event) => {
                  const id =
                    (event.target as HTMLElement).closest<HTMLElement>("[data-clip]")?.dataset
                      .clip ?? null;
                  if (!id || readOnly) {
                    event.preventDefault();
                    event.stopPropagation();
                    setMenuId(null);
                    return;
                  }
                  setMenuId(id);
                  actions.select(id);
                }}
              />
            }
          >
            <div
              ref={innerRef}
              style={{ width: widthPx }}
              className="relative h-full"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDragOver={(event) => {
                if (readOnly || !isTimelineDrag(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDropAt(insertIndexAt(clips, timeAt(event.clientX)));
              }}
              onDragLeave={() => setDropAt(null)}
              onDrop={(event) => {
                const payload = readTimelineDrag(event);
                const at = insertIndexAt(clips, timeAt(event.clientX));
                setDropAt(null);
                if (!payload || readOnly) return;
                event.preventDefault();
                actions.drop(at, payload);
              }}
            >
              <div
                className="border-chrome-border/60 relative h-7 cursor-pointer border-b"
                onPointerDown={startSeek}
              >
                {ticks.map((s) => (
                  <span
                    key={s}
                    style={{ left: PAD + s * pps }}
                    className="text-muted-foreground absolute top-0 h-full border-l border-current/30 pt-1.5 pl-1 font-mono text-[10.5px]"
                  >
                    {mmss(s)}
                  </span>
                ))}
              </div>
              <div className="absolute inset-x-0 top-7 bottom-0" onPointerDown={startSeek}>
                <div
                  style={{ left: PAD, width: Math.max((total / 1000) * pps, 40) }}
                  className="bg-chrome-hover absolute top-2 h-[76px] rounded-[10px]"
                />
                {shown.map((clip, index) => (
                  <ClipBlock
                    key={clip.id}
                    clip={clip}
                    source={sources[index]}
                    left={PAD + (starts[index] / 1000) * pps}
                    pps={pps}
                    selected={selected === clip.id}
                    synced={syncIds.has(clip.id)}
                    dragging={drag?.mode === "move" && drag.moving && drag.id === clip.id}
                    trimming={drag?.mode === "trim" && drag.id === clip.id}
                    readOnly={readOnly}
                    onPointerDown={(event, side) => startClip(event, index, side)}
                  />
                ))}
                {clips.length === 0 && (
                  <span
                    style={{ left: PAD + 12 }}
                    className="text-muted-foreground absolute top-9 text-xs"
                  >
                    还没有片段
                  </span>
                )}
              </div>
              {insertX !== null && (
                <div
                  style={{ left: insertX }}
                  className="bg-primary absolute top-8 z-10 h-[84px] w-[3px] -translate-x-1/2 rounded-full shadow-[0_0_10px] shadow-primary"
                />
              )}
              <div
                ref={playheadRef}
                className="pointer-events-none absolute inset-y-0 left-0 z-20 w-0"
              >
                <span className="bg-foreground absolute inset-y-0 -left-px w-0.5" />
                <span className="bg-foreground absolute top-0.5 -left-1.5 h-3.5 w-3 rounded-[3px_3px_6px_6px]" />
              </div>
            </div>
          </ContextMenuTrigger>
          {menuClip && menuSource && (
            <ContextMenuContent className="min-w-52">
              {menuSegment && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Link />
                    换版本
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="min-w-48">
                    <ContextMenuLabel>{menuSource.label}</ContextMenuLabel>
                    <ContextMenuItem onClick={() => actions.swap(menuClip.id, "follow")}>
                      跟随采用{!menuClip.pinned && " ✓"}
                    </ContextMenuItem>
                    {menuSegment.takes.map((take, index) =>
                      take.status === "succeeded" && take.asset ? (
                        <ContextMenuItem
                          key={take.taskId}
                          onClick={() => actions.swap(menuClip.id, take.taskId)}
                        >
                          版本 {index + 1}
                          {take.asset.durationMs
                            ? ` · ${Math.round(take.asset.durationMs / 1000)}s`
                            : ""}
                          {take.taskId === menuSegment.chosenTaskId && (
                            <span className="text-status-success ml-auto text-xs">采用</span>
                          )}
                          {menuClip.pinned && menuClip.taskId === take.taskId && " ✓"}
                        </ContextMenuItem>
                      ) : null,
                    )}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}
              {menuSegment && <ContextMenuSeparator />}
              <ContextMenuItem
                disabled={menuSource.kind === "placeholder"}
                onClick={() => actions.toggleClipMute(menuClip.id)}
              >
                {menuClip.muted ? <Volume2 /> : <VolumeX />}
                {menuClip.muted ? "取消静音" : "静音此段"}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={menuSource.kind === "placeholder" || menuSource.kind === "broken"}
                onClick={() => actions.restore(menuClip.id)}
              >
                <Maximize2 />
                {menuSource.kind === "image" ? "恢复默认 3 秒" : "恢复原长"}
              </ContextMenuItem>
              {menuSource.kind === "placeholder" && (
                <ContextMenuItem onClick={actions.goStudio}>
                  <Clapperboard />
                  去片场生成
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => actions.remove(menuClip.id)}>
                <Trash2 />
                删除
              </ContextMenuItem>
            </ContextMenuContent>
          )}
        </ContextMenu>
      </div>
    </section>
  );
}

/** 工具条上的图标按钮 */
function ToolButton({
  label,
  shortcut,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label}（${shortcut}）` : label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-foreground hover:bg-chrome-hover grid size-8 place-items-center rounded-full disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4",
        active && "text-primary",
      )}
    >
      {children}
    </button>
  );
}

/** 时间线上的一段 */
function ClipBlock({
  clip,
  source,
  left,
  pps,
  selected,
  synced,
  dragging,
  trimming,
  readOnly,
  onPointerDown,
}: {
  clip: TimelineClip;
  source: ClipSource;
  left: number;
  pps: number;
  selected: boolean;
  synced: boolean;
  dragging: boolean;
  trimming: boolean;
  readOnly: boolean;
  onPointerDown: (event: React.PointerEvent, side: "start" | "end" | null) => void;
}) {
  const width = Math.max((clipLength(clip) / 1000) * pps - 2, 6);
  const frames = useThumbStrip(source.kind === "video" ? source.url : null, source.durationMs);
  const tiles = source.kind === "video" ? Math.max(1, Math.ceil(width / TILE)) : 0;
  const editable = !readOnly && (source.kind === "video" || source.kind === "image");
  const placeholder = source.kind === "placeholder";
  const broken = source.kind === "broken";

  return (
    <div
      data-clip={clip.id}
      style={{ left, width }}
      onPointerDown={(event) => onPointerDown(event, null)}
      className={cn(
        "group absolute top-2 h-[76px] overflow-hidden rounded-[9px] border-2 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.25)]",
        readOnly ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        selected
          ? "border-primary"
          : synced
            ? "border-sky-400"
            : broken
              ? "border-destructive"
              : "border-transparent",
        placeholder &&
          "bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_8px,transparent_8px_16px)]",
        dragging && "opacity-35",
      )}
    >
      {source.kind === "video" && (
        <div className={cn("absolute inset-0 flex bg-neutral-800", broken && "grayscale")}>
          {Array.from({ length: tiles }, (_, k) => {
            const second = (clip.inMs + ((k + 0.5) * TILE * 1000) / pps) / 1000;
            const frame = frames[Math.min(frames.length - 1, Math.max(0, Math.floor(second)))];
            return frame ? (
              <img
                key={k}
                src={frame}
                alt=""
                draggable={false}
                className="h-full w-12 shrink-0 object-cover"
              />
            ) : (
              <span
                key={k}
                className="h-full w-12 shrink-0 border-r border-black/30 bg-neutral-700"
              />
            );
          })}
        </div>
      )}
      {source.kind === "image" && source.url && (
        <div
          style={{ backgroundImage: `url("${source.url}")` }}
          className="absolute inset-0 bg-neutral-800 bg-[length:auto_100%] bg-repeat-x"
        />
      )}
      {broken && <div className="bg-destructive/15 absolute inset-0" />}
      <span
        className={cn(
          "absolute top-1 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 truncate text-[11px] [&_svg]:size-3",
          placeholder
            ? "text-muted-foreground"
            : "text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]",
        )}
      >
        {clip.pinned && <Pin />}
        {source.kind === "image" && <ImageIcon />}
        {source.label}
        {source.version !== null && ` · 版本 ${source.version}`}
        {placeholder && " · 待采用"}
      </span>
      <span
        className={cn(
          "absolute bottom-1 left-1.5 font-mono text-[10.5px]",
          placeholder
            ? "text-muted-foreground"
            : "text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]",
        )}
      >
        {(clipLength(clip) / 1000).toFixed(1)}s
      </span>
      <span className="absolute right-1.5 bottom-1 flex gap-1 text-white [&_svg]:size-3">
        {clip.muted && <VolumeX />}
        {broken && <TriangleAlert />}
      </span>
      {synced && (
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-sky-400 ring-2 ring-black/30" />
      )}
      {trimming && (
        <span className="bg-foreground text-background absolute top-1/2 left-1/2 -translate-1/2 rounded-full px-2 py-0.5 font-mono text-[11px]">
          {(clipLength(clip) / 1000).toFixed(1)}s
        </span>
      )}
      {editable &&
        (["start", "end"] as const).map((side) => (
          <span
            key={side}
            onPointerDown={(event) => onPointerDown(event, side)}
            className={cn(
              "absolute inset-y-0 z-10 w-2.5 cursor-ew-resize after:absolute after:inset-y-5 after:left-[3px] after:w-1 after:rounded-full after:bg-white",
              side === "start" ? "left-0" : "right-0",
              selected ? "bg-primary block" : "hidden bg-white/30 group-hover:block",
            )}
          />
        ))}
    </div>
  );
}
