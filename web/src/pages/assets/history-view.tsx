import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  addToLibrary,
  hideGeneratedAsset,
  moveLibraryItem,
  removeLibraryItem,
} from "@/api/asset-library";
import type { AssetKind, GeneratedItemDto } from "@/api/asset-library/type";
import { AddToLibraryAction } from "@/components/assets/add-to-library-action";
import { AssetKindTabs } from "@/components/assets/asset-kind-tabs";
import { HistoryAssetCard } from "@/components/assets/asset-card";
import { AssetGridSkeleton, AssetMasonry, LoadMoreFooter } from "@/components/assets/asset-grid";
import { AssetPreview, type AssetPreviewEntry } from "@/components/assets/asset-preview";
import { AssetSearch } from "@/components/assets/asset-search";
import { AssetsToolbar } from "@/components/assets/assets-toolbar";
import { FilterMenu } from "@/components/assets/filter-menu";
import { FolderPickerDialog } from "@/components/assets/folder-picker-dialog";
import { EmptyMark } from "@/components/home/empty-mark";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useCanvasSourceMenu } from "@/hooks/use-canvas-source-menu";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useGeneratedAssets } from "@/hooks/use-generated-assets";
import {
  DEFAULT_GENERATED_FILTER,
  hasActiveFilter,
  sourceFromValue,
  type GeneratedFilter,
} from "@/utils/assets/generated-filter";
import {
  addGeneratedToLibrary,
  hideFromHistory,
  type HistoryApi,
  type LibraryApi,
} from "@/utils/assets/library-actions";
import { createScrollTopRunner } from "@/utils/assets/scroll-top";
import type { TimeRange } from "@/utils/assets/time-range";

/** 加入资产库用到的接口 */
const LIBRARY_API: LibraryApi = { addToLibrary, moveLibraryItem, removeLibraryItem };

/** 从生成历史删除用到的接口 */
const HISTORY_API: HistoryApi = { hideGeneratedAsset };

/** 时间下拉的选项 */
const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "all", label: "全部时间" },
  { value: "today", label: "今天" },
  { value: "week", label: "近 7 天" },
  { value: "month", label: "近 30 天" },
];

/** 排序下拉的选项 */
const ORDER_OPTIONS = [
  { value: "desc", label: "最新优先" },
  { value: "asc", label: "最早优先" },
];

/**
 * 资产页「生成历史」：首页对话与所有画布生成的素材，按图片 / 视频 / 音频分标签，
 * 可按来源、时间、排序、提示词筛选，滚动到底加载下一页。
 * 点卡片用灯箱预览；已在资产库的显示角标；其余可「加入资产库…」。
 * 「删除」先确认，再只从生成历史隐藏：素材文件、画布与对话里的引用、资产库里的那份都不受影响。
 * 筛选和搜索都在一条半透明工具条里，素材按真实画幅排成瀑布流。
 */
export function HistoryView() {
  const [kind, setKind] = useState<AssetKind>("image");
  /** 标签上选中的类型：点了立刻高亮，列表等页面平滑滚回顶部后再换（kind） */
  const [tabKind, setTabKind] = useState<AssetKind>("image");
  /** 换类型、换筛选：先平滑滚回顶部，到顶再换列表 */
  const [scrollTopThen] = useState(() => createScrollTopRunner());
  const [source, setSource] = useState(DEFAULT_GENERATED_FILTER.source);
  const [range, setRange] = useState<TimeRange>("all");
  const [order, setOrder] = useState<GeneratedFilter["order"]>("desc");
  /** 输入框里的原文；防抖后才进筛选，不然每敲一个字都发请求 */
  const [input, setInput] = useState("");
  const q = useDebouncedValue(input);
  const filter = useMemo<GeneratedFilter>(
    () => ({ source, range, order, q }),
    [source, range, order, q],
  );

  const { list, state } = useGeneratedAssets(kind, filter);
  const { items } = state;
  const filtered = hasActiveFilter(filter);

  const sourceMenu = useCanvasSourceMenu(source);

  /** 「加入资产库…」目标条目；null 表示选择器关着 */
  const [adding, setAdding] = useState<GeneratedItemDto | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** 等待确认删除的条目；null 表示确认框关着 */
  const [deleting, setDeleting] = useState<GeneratedItemDto | null>(null);

  const entries = useMemo<AssetPreviewEntry[]>(
    () =>
      items.map((item) => ({
        id: item.asset.id,
        asset: item.asset,
        label: item.prompt || item.asset.fileName || "生成结果",
      })),
    [items],
  );

  /** 加入资产库；失败（请求层已弹提示）抛出，让选择器保持打开 */
  const add = async (item: GeneratedItemDto, folderId: string | null, name?: string) => {
    const result = await addGeneratedToLibrary(list, item, folderId, LIBRARY_API, name);
    if (!result) throw new Error("add to library failed");
    toast.success("已加入资产库");
  };

  const confirmDelete = async () => {
    const target = deleting;
    if (!target) return;
    setDeleting(null);
    if (await hideFromHistory(list, target.asset.id, HISTORY_API)) toast.success("已删除");
  };

  const clearFilters = () => {
    setSource(DEFAULT_GENERATED_FILTER.source);
    setRange("all");
    setInput("");
  };

  return (
    <>
      <AssetsToolbar className="mt-6 mb-7">
        <AssetKindTabs
          value={tabKind}
          onChange={(next) => {
            setTabKind(next);
            scrollTopThen(() => setKind(next));
          }}
        />
        <span aria-hidden className="bg-chrome-border mx-1 h-4 w-px shrink-0" />
        <FilterMenu
          label="来源"
          value={sourceMenu.value}
          defaultValue="all"
          groups={sourceMenu.groups}
          onChange={(value) => scrollTopThen(() => setSource(sourceFromValue(value)))}
          onOpenChange={sourceMenu.onOpenChange}
          footer={sourceMenu.footer}
        />
        <FilterMenu
          label="时间"
          value={range}
          defaultValue="all"
          groups={[{ options: RANGE_OPTIONS }]}
          onChange={(value) => scrollTopThen(() => setRange(value as TimeRange))}
        />
        <FilterMenu
          label="排序"
          value={order}
          defaultValue="desc"
          groups={[{ options: ORDER_OPTIONS }]}
          onChange={(value) => scrollTopThen(() => setOrder(value as GeneratedFilter["order"]))}
        />
        <div className="ml-auto">
          <AssetSearch value={input} onChange={setInput} placeholder="搜索提示词" />
        </div>
      </AssetsToolbar>

      {state.status === "loading" ? (
        <AssetGridSkeleton />
      ) : state.status === "error" ? (
        <EmptyMark
          title="加载失败"
          hint={
            <Button variant="outline" size="sm" onClick={list.retry}>
              重试
            </Button>
          }
        />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyMark
            title="没有符合条件的素材"
            hint={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                清除筛选
              </Button>
            }
          />
        ) : (
          <EmptyMark title="暂无相关资产" hint="在「创作」里生成的内容会出现在这里" />
        )
      ) : (
        <>
          <AssetMasonry>
            {items.map((item) => (
              <HistoryAssetCard
                key={item.asset.id}
                item={item}
                natural
                onPreview={() => setPreviewId(item.asset.id)}
                onAddToLibrary={() => setAdding(item)}
                onOpenCanvas={(id) => window.open(`/canvas/${id}`, "_blank", "noopener")}
                onDelete={() => setDeleting(item)}
              />
            ))}
          </AssetMasonry>
          <LoadMoreFooter
            hasMore={state.nextCursor !== ""}
            loading={state.loadingMore}
            failed={state.moreFailed}
            onLoadMore={list.loadMore}
          />
        </>
      )}

      <FolderPickerDialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        title="加入资产库"
        confirmLabel="加入"
        assetName={adding?.asset.fileName ?? ""}
        onConfirm={(folderId, name) => (adding ? add(adding, folderId, name) : Promise.resolve())}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>从生成历史删除？</AlertDialogTitle>
            <AlertDialogDescription>
              只是不再显示在生成历史里；画布、对话和个人资产库中的这份素材不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AssetPreview
        entries={entries}
        targetId={previewId}
        onTargetChange={setPreviewId}
        onClose={() => setPreviewId(null)}
        renderAction={(asset) => {
          const item = items.find((entry) => entry.asset.id === asset.id);
          return item ? (
            <AddToLibraryAction
              inLibrary={item.libraryItemId !== null}
              onAdd={(folderId) => add(item, folderId)}
            />
          ) : null;
        }}
      />
    </>
  );
}
