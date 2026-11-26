import { useState } from "react";
import { Reorder, useDragControls } from "motion/react";
import { GripVertical, Pencil, Plus } from "lucide-react";

import type { DramaPresetAdminItem, DramaPresetKind } from "@/api/admin/drama-preset/type";
import { GLASS_PANEL } from "@/components/admin-ui/glass";
import { Tag } from "@/components/admin-ui/tag";
import { DramaPoster } from "@/components/drama/poster";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { KIND_LABEL } from "@/utils/admin/drama-preset";

/** 卡片网格：媒体区按 16:10，最少 228px 一列，宽屏自动加列 */
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(228px,1fr))] gap-4";

/** 卡片封面可打开编辑。画风显示预览图，题材用渐变底和首字。 */
function PresetMedia({
  item,
  busy,
  onEdit,
}: {
  item: DramaPresetAdminItem;
  busy: boolean;
  onEdit: () => void;
}) {
  const glyph = Array.from(item.name)[0] ?? "·";
  return (
    <div className="bg-muted relative aspect-16/10 overflow-hidden">
      <DramaPoster seed={item.key} className="absolute inset-0">
        <span
          aria-hidden="true"
          className="text-foreground/15 absolute inset-0 grid select-none place-items-center text-6xl font-semibold tracking-tight"
        >
          {glyph}
        </span>
        {item.preview_url && (
          <img
            src={item.preview_url}
            alt=""
            width={640}
            height={400}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </DramaPoster>
      {/* 停用不该只是名字变灰：整块媒体压暗，一眼能扫出哪些不在开拍设置里 */}
      {!item.enabled && <div className="bg-background/55 absolute inset-0" />}
      <button
        type="button"
        aria-label={`编辑${KIND_LABEL[item.kind]} ${item.name}`}
        title="编辑"
        disabled={busy}
        onClick={onEdit}
        className="focus-visible:ring-ring absolute inset-0 cursor-pointer hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none disabled:cursor-default"
      />
    </div>
  );
}

/**
 * 一张预设卡：媒体区（预览图 / 题材渐变 + 首字）、名称与启用开关、key、画风描述两行、底部引用数与编辑删除。
 *
 * 排序手柄压在媒体区左上角，hover 或键盘聚焦才浮出来（触屏没有 hover，常显），
 * 免得 12 张卡上挂 12 个手柄把画面弄乱。
 * 卡片上没有删除：预设是给创作端用的目录，下架靠停用，历史上被引用过的条目不能凭空消失。
 */
function PresetCard({
  item,
  busy,
  onDragEnd,
  onToggle,
  onEdit,
}: {
  item: DramaPresetAdminItem;
  busy: boolean;
  onDragEnd: () => void;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const controls = useDragControls();
  const used = item.project_count > 0;

  return (
    <Reorder.Item
      value={item}
      as="div"
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02, zIndex: 20 }}
      className={cn(
        GLASS_PANEL,
        "group/card relative flex flex-col overflow-hidden rounded-2xl [corner-shape:squircle]",
        busy && "pointer-events-none opacity-50",
      )}
    >
      <PresetMedia item={item} busy={busy} onEdit={onEdit} />

      <div className="absolute top-2 left-2 opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:opacity-100">
        <button
          type="button"
          aria-label="拖动排序"
          title="拖动排序"
          onPointerDown={(event) => controls.start(event)}
          className="bg-chrome/85 ring-chrome-border text-muted-foreground hover:text-foreground grid size-7 cursor-grab touch-none place-items-center rounded-full ring-1 backdrop-blur-md active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
      </div>

      {!item.enabled && (
        <Tag tone="warning" className="absolute top-2 right-2 backdrop-blur-md">
          已停用
        </Tag>
      )}

      <div className="flex min-w-0 flex-col gap-1.5 px-3.5 pt-3 pb-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("truncate text-sm font-semibold", !item.enabled && "opacity-60")}>
            {item.name}
          </p>
          <Switch
            size="sm"
            checked={item.enabled}
            disabled={busy}
            title={item.enabled ? "已启用" : "未启用"}
            aria-label="启用"
            className="mt-0.5 shrink-0"
            onCheckedChange={onToggle}
          />
        </div>
        <Tag mono className="max-w-full self-start">
          <span className="truncate">{item.key}</span>
        </Tag>
        {item.prompt && (
          <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
            {item.prompt}
          </p>
        )}
      </div>

      {/* mt-auto：同一行的卡片会被拉到一样高，把底部压到最低，引用数那一行齐平 */}
      <div className="border-chrome-border/60 mt-auto flex items-center justify-between gap-2 border-t py-1 pr-1.5 pl-3.5">
        <span className="text-muted-foreground truncate text-xs tabular-nums">
          {used ? `${item.project_count} 部短剧在用` : "暂无短剧使用"}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="编辑" title="编辑" onClick={onEdit}>
          <Pencil />
        </Button>
      </div>
    </Reorder.Item>
  );
}

/**
 * 预设卡片网格（motion 的 Reorder，axis="xy" 才支持换行网格）：拖动时只改本地顺序，松手才提交；
 * 服务端的列表变了（新增、删除、重新拉取）就以服务端为准。
 * 末尾那张虚线的「新建」卡也是网格里的一格，跟着卡片的尺寸走，不再单独占一行工具条。
 */
export function PresetGrid({
  items,
  kind,
  busyIds,
  onReorder,
  onToggle,
  onEdit,
  onNew,
}: {
  items: DramaPresetAdminItem[];
  kind: DramaPresetKind;
  busyIds: ReadonlySet<number>;
  onReorder: (items: DramaPresetAdminItem[]) => void;
  onToggle: (item: DramaPresetAdminItem) => void;
  onEdit: (item: DramaPresetAdminItem) => void;
  onNew: () => void;
}) {
  const [local, setLocal] = useState(items);
  const [prevItems, setPrevItems] = useState(items);

  /** 服务端的列表变了就重置本地顺序（在渲染里同步，不在 effect 里，免得闪一帧旧顺序） */
  if (items !== prevItems) {
    setPrevItems(items);
    setLocal(items);
  }

  /** 松手：顺序真的变了才提交 */
  const commit = () => {
    const changed = local.some((item, index) => item.id !== items[index]?.id);
    if (changed) onReorder(local);
  };

  return (
    <Reorder.Group as="div" axis="xy" values={local} onReorder={setLocal} className={GRID}>
      {local.map((item) => (
        <PresetCard
          key={item.id}
          item={item}
          busy={busyIds.has(item.id)}
          onDragEnd={commit}
          onToggle={() => onToggle(item)}
          onEdit={() => onEdit(item)}
        />
      ))}
      <button
        type="button"
        onClick={onNew}
        className="text-muted-foreground hover:text-foreground hover:bg-chrome-hover ring-chrome-border focus-visible:ring-ring/50 flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl ring-1 transition-[background-color,color] duration-150 ring-inset focus-visible:ring-2 focus-visible:outline-none [corner-shape:squircle]"
      >
        <Plus className="size-5" />
        <span className="text-sm font-medium">新建{KIND_LABEL[kind]}</span>
      </button>
    </Reorder.Group>
  );
}

/** 加载中的骨架：按卡片比例铺几块，别让页面在拿到数据前是空的 */
export function PresetGridSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className={cn(
            GLASS_PANEL,
            "aspect-[4/3] animate-pulse rounded-2xl [corner-shape:squircle]",
          )}
        />
      ))}
    </div>
  );
}
