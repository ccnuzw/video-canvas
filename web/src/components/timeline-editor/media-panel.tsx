import { Loader2, Plus } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { MediaTile } from "./media-tile";
import type { MediaItem, MediaTab } from "./types";

/** 筛选：全部或某一类素材 */
type Filter = "all" | MediaItem["type"];

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "image", label: "图片" },
  { value: "audio", label: "音频" },
];

/** 卡片按宽度自动排列，每张至少 120px */
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2.5";

/**
 * 编辑器左侧的素材面板：宿主给几个标签，每个标签是若干组卡片。
 * 卡片可以拖到时间线，也可以点「+」；可导入的标签有「导入」按钮并接受拖入文件。
 */
export function MediaPanel({
  tabs,
  ratio,
  readOnly,
  onAdd,
  onTabSelect,
  onImport,
  onRetryImport,
}: {
  /** 宿主给的标签 */
  tabs: readonly MediaTab[];
  /** 项目画面比例（CSS aspect-ratio，如「9/16」），比例为 project 的卡片用它 */
  ratio: string;
  readOnly: boolean;
  /** 点卡片上的「+」 */
  onAdd: (item: MediaItem) => void;
  /** 切到某个标签 */
  onTabSelect?: (tabId: string) => void;
  /** 导入本地文件；不传则没有导入入口 */
  onImport?: (files: File[]) => void;
  /** 重试上传失败的素材 */
  onRetryImport?: (itemId: string) => void;
}) {
  const [tabId, setTabId] = useState(tabs[0]?.id ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const fileInput = useRef<HTMLInputElement>(null);
  const tab = tabs.find((item) => item.id === tabId) ?? tabs[0];
  const canImport = !!tab?.importable && !!onImport && !readOnly;

  const sections = (tab?.sections ?? [])
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => filter === "all" || item.type === filter),
    }))
    .filter((section) => section.items.length > 0);

  const pick = (files: FileList | null) => {
    const picked = Array.from(files ?? []);
    if (picked.length > 0) onImport?.(picked);
  };

  return (
    <aside aria-label="素材" className="flex size-full min-h-0 flex-col">
      <div role="tablist" className="flex gap-1 px-3 pt-2 pb-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab?.id === item.id}
            onClick={() => {
              setTabId(item.id);
              onTabSelect?.(item.id);
            }}
            className={cn(
              "h-8 rounded-full px-3 text-[13px] font-medium transition-colors",
              tab?.id === item.id
                ? "bg-chrome-hover ring-chrome-border text-foreground ring-1"
                : "text-muted-foreground hover:bg-chrome-hover hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab?.filterable && (
        <div className="flex items-center gap-3 px-4 pb-2 text-[12.5px]">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={cn(
                "border-b-2 pb-0.5",
                filter === item.value
                  ? "text-foreground border-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {item.label}
            </button>
          ))}
          <span className="flex-1" />
          {canImport && (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="hover:bg-chrome-hover ring-chrome-border flex h-7 items-center gap-1 rounded-full px-2.5 ring-1"
            >
              <Plus className="size-3.5" />
              导入
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="video/*,image/*,audio/*"
            multiple
            hidden
            onChange={(event) => {
              pick(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        onDragOver={(event) => {
          if (canImport && event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!canImport || event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          pick(event.dataTransfer.files);
        }}
      >
        {tab?.loading ? (
          <div className="text-muted-foreground grid place-items-center py-10">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : sections.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-[12.5px]">
            {tab?.emptyText ?? ""}
          </p>
        ) : (
          sections.map((section, index) => (
            <section key={section.title ?? index} className="mb-3">
              {section.title && (
                <h4 className="text-muted-foreground mx-0.5 mb-1.5 text-xs font-medium">
                  {section.title}
                </h4>
              )}
              <div className={GRID}>
                {section.items.map((item) => (
                  <MediaTile
                    key={item.id}
                    item={item}
                    ratio={ratio}
                    readOnly={readOnly}
                    onAdd={onAdd}
                    onRetry={onRetryImport}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
