import { useCallback, useEffect, useRef, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { toast } from "sonner";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

import { findClip, mainTrack, updateTrack } from "./model";
import { Inspector } from "./inspector";
import { MediaPanel } from "./media-panel";
import { placeMedia } from "./place";
import { Preview } from "./preview/preview";
import { TimelinePanel } from "./timeline/timeline-panel";
import type {
  DraggedMedia,
  DropTarget,
  EditorTimeline,
  MediaItem,
  TimelineEditorProps,
} from "./types";
import { usePlayer } from "./use-player";

/** 分栏拖动条：透明的 12px 宽，留出卡片间距；悬停 / 拖动时中间亮一条主色细线 */
const HANDLE_COLUMN =
  "w-3 bg-transparent after:!w-3 before:absolute before:inset-y-2 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:rounded-full before:transition-colors hover:before:bg-primary/60 data-[separator=active]:before:bg-primary";
const HANDLE_ROW =
  "!h-3 !w-full bg-transparent after:!h-3 before:absolute before:inset-x-2 before:top-1/2 before:h-0.5 before:-translate-y-1/2 before:rounded-full before:transition-colors hover:before:bg-primary/60 data-[separator=active]:before:bg-primary";

/** 左上面板的两个页：素材 / 属性 */
type Mode = "media" | "props";

/** 拖动属性滑杆时的临时时间线：只给预览看，松手才交给宿主；base 变了就作废 */
type Draft = { base: EditorTimeline; value: EditorTimeline };

/** 解析画面比例：「x:y」得到宽高，认不出来按 9:16 */
function parseRatio(ratio: string): [number, number] {
  if (!/^\d+:\d+$/.test(ratio)) return [9, 16];
  const [w, h] = ratio.split(":").map(Number);
  return w > 0 && h > 0 ? [w, h] : [9, 16];
}

/**
 * 多轨时间线编辑器：素材 / 属性面板 + 预览 + 时间线。
 * 竖屏比例预览放右侧整列，左边上素材（或属性）下时间线；横屏上面素材 + 预览、下面时间线；各分栏的边都能拖，尺寸每人记住。
 * 时间线受控：宿主传 timeline，改动通过 onChange 交回去，撤销和保存都归宿主；顶栏、导出等也由宿主放在编辑器外面。
 */
export function TimelineEditor({
  timeline,
  onChange,
  history,
  host,
  readOnly,
  ratio,
  focus,
  layoutId,
}: TimelineEditorProps) {
  const [rw, rh] = parseRatio(ratio);
  const portrait = rh > rw;
  const aspect = `${rw}/${rh}`;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("media");
  const [draft, setDraft] = useState<Draft | null>(null);
  const shown = draft && draft.base === timeline ? draft.value : timeline;
  const activeId = selectedId && findClip(shown, selectedId) ? selectedId : null;
  const player = usePlayer(shown, host.resolve);

  // 异步放置素材时要用最新的时间线
  const timelineRef = useRef(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const portraitCols = useDefaultLayout({
    id: `${layoutId}-portrait-cols`,
    panelIds: ["edit", "preview"],
  });
  const portraitRows = useDefaultLayout({
    id: `${layoutId}-portrait-rows`,
    panelIds: ["media", "track"],
  });
  const landscapeRows = useDefaultLayout({
    id: `${layoutId}-landscape-rows`,
    panelIds: ["top", "track"],
  });
  const landscapeCols = useDefaultLayout({
    id: `${layoutId}-landscape-cols`,
    panelIds: ["media", "preview"],
  });

  /** 选中片段会自动切到属性；取消选中不强制切回素材 */
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setMode("props");
  }, []);

  // 宿主要求定位到某个片段：选中它并切到属性（渲染期更新状态，nonce 变了才触发），播放头在下面的 effect 里移动
  const [handledFocus, setHandledFocus] = useState(focus?.nonce ?? null);
  if (focus && focus.nonce !== handledFocus) {
    setHandledFocus(focus.nonce);
    setSelectedId(focus.clipId);
    setMode("props");
  }
  const seekedFocus = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || seekedFocus.current === focus.nonce) return;
    seekedFocus.current = focus.nonce;
    const found = findClip(timelineRef.current, focus.clipId);
    if (!found) return;
    player.handle.pause();
    player.handle.seek(found.clip.startMs);
  }, [focus, player.handle]);

  /** 一次完整的修改交给宿主，临时预览作废 */
  const commit = useCallback(
    (next: EditorTimeline) => {
      setDraft(null);
      if (next !== timelineRef.current) onChange(next);
    },
    [onChange],
  );

  /** 把拖入或点「+」的素材做成片段并放进时间线；放不下就提示原因 */
  const addMedia = useCallback(
    async (item: DraggedMedia, target: DropTarget | null) => {
      if (readOnly) return;
      const clip = await host.createClip(item.payload);
      if (!clip) return;
      const placed = placeMedia(timelineRef.current, clip, target, player.handle.time());
      if ("error" in placed) {
        toast.warning(placed.error);
        return;
      }
      commit(placed.timeline);
      select(placed.selectId);
    },
    [readOnly, host, player.handle, commit, select],
  );

  const onAdd = useCallback(
    (item: MediaItem) => void addMedia({ type: item.type, payload: item.payload }, null),
    [addMedia],
  );

  const toggleMainMute = () => {
    const main = mainTrack(timeline);
    commit(updateTrack(timeline, main.id, { muted: !main.muted }));
  };

  const left = (
    <section
      aria-label="素材与属性"
      className="bg-chrome ring-chrome-border flex size-full min-h-0 flex-col rounded-2xl ring-1 ring-inset [corner-shape:squircle]"
    >
      <div className="px-3 pt-3">
        <div role="tablist" className="bg-chrome-hover inline-flex gap-0.5 rounded-full p-0.5">
          {(
            [
              ["media", "素材"],
              ["props", "属性"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "h-7 rounded-full px-3.5 text-[12.5px] transition-colors",
                mode === value
                  ? "bg-background text-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === "media" ? (
        <MediaPanel
          tabs={host.tabs}
          ratio={aspect}
          readOnly={readOnly}
          onAdd={onAdd}
          onTabSelect={host.onTabSelect}
          onImport={host.onImport}
          onRetryImport={host.onRetryImport}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
          <Inspector
            timeline={shown}
            clipId={activeId}
            host={host}
            readOnly={readOnly}
            onPreview={(next) => setDraft({ base: timeline, value: next })}
            onCommit={commit}
          />
        </div>
      )}
    </section>
  );

  const preview = (
    <Preview
      timeline={shown}
      player={player}
      ratio={aspect}
      readOnly={readOnly}
      emptyAction={host.emptyAction}
      onToggleMainMute={toggleMainMute}
    />
  );

  const track = (
    <TimelinePanel
      timeline={shown}
      host={host}
      selectedId={activeId}
      onSelect={select}
      player={player.handle}
      readOnly={readOnly}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
      onChange={commit}
      onUndo={history.undo}
      onRedo={history.redo}
      onDropMedia={(item, target) => void addMedia(item, target)}
      onError={(message) => toast.warning(message)}
    />
  );

  return portrait ? (
    // 竖屏：预览在右侧整列，左侧上素材、下时间线；两条边都能拖
    <ResizablePanelGroup
      orientation="horizontal"
      className="size-full min-h-0"
      defaultLayout={portraitCols.defaultLayout}
      onLayoutChanged={portraitCols.onLayoutChanged}
    >
      <ResizablePanel id="edit" minSize={480}>
        <ResizablePanelGroup
          orientation="vertical"
          defaultLayout={portraitRows.defaultLayout}
          onLayoutChanged={portraitRows.onLayoutChanged}
        >
          <ResizablePanel id="media" minSize={160}>
            {left}
          </ResizablePanel>
          <ResizableHandle className={HANDLE_ROW} />
          <ResizablePanel id="track" defaultSize={232} minSize={180} maxSize="70%">
            {track}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle className={HANDLE_COLUMN} />
      <ResizablePanel id="preview" defaultSize={400} minSize={260} maxSize="60%">
        {preview}
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : (
    // 横屏：上面素材 + 预览，下面时间线；两条边都能拖
    <ResizablePanelGroup
      orientation="vertical"
      className="size-full min-h-0"
      defaultLayout={landscapeRows.defaultLayout}
      onLayoutChanged={landscapeRows.onLayoutChanged}
    >
      <ResizablePanel id="top" minSize={240}>
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={landscapeCols.defaultLayout}
          onLayoutChanged={landscapeCols.onLayoutChanged}
        >
          <ResizablePanel id="media" defaultSize={300} minSize={220} maxSize="50%">
            {left}
          </ResizablePanel>
          <ResizableHandle className={HANDLE_COLUMN} />
          <ResizablePanel id="preview" minSize={320}>
            {preview}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle className={HANDLE_ROW} />
      <ResizablePanel id="track" defaultSize={232} minSize={180} maxSize="60%">
        {track}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
