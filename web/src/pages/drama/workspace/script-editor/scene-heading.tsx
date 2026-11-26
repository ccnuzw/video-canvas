import { useState } from "react";
import { Check, Trash2 } from "lucide-react";

import type { ScriptIntExt } from "@/api/drama/type";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { EditorScene } from "@/utils/drama/script-doc";
import { FLIP_COLLISION } from "./popup-flip";

/** 内外景选项；再点一次已选中的项清空 */
const INT_EXT: { value: ScriptIntExt; label: string }[] = [
  { value: "interior", label: "内" },
  { value: "exterior", label: "外" },
  { value: "interior_exterior", label: "内外" },
];

const INT_EXT_TEXT: Record<ScriptIntExt, string> = {
  "": "",
  interior: "内",
  exterior: "外",
  interior_exterior: "内外",
};

/**
 * 只读的场次标题（剧本已锁定）：只显示有值的时间、内外景、地点和短标题，不出现下拉和占位词。
 * @param scene 这一场
 * @param label 场号
 * @param locationName 地点正式名，没选是 null
 */
function ReadOnlyHeading({
  scene,
  label,
  locationName,
}: {
  scene: EditorScene;
  label: string;
  locationName: string | null;
}) {
  return (
    <div data-scene-heading={scene.key} className={ROW}>
      <span className={NO}>{label}</span>
      {scene.timeLabel && <span>{scene.timeLabel}</span>}
      {INT_EXT_TEXT[scene.intExt] && <span>{INT_EXT_TEXT[scene.intExt]}</span>}
      {locationName && <span>{locationName}</span>}
      {scene.title && <span className={TITLE}>{scene.title}</span>}
    </div>
  );
}

/** 时间选项；后端接受任意文本，这里给常用的几个 */
const TIMES = ["日", "夜", "清晨", "黄昏", "傍晚", "深夜"];

/**
 * 场次标题里的小菜单（时间、内外景）：和人物 / 地点选择同一套半透明弹层，不用浏览器原生下拉。
 * @param label 读屏名称，也是没选时按钮上的字
 * @param value 当前值，空串表示没选
 * @param display 按钮上显示的取值文字，空串时显示 label
 * @param options 选项；当前值不在里面时（解析出来的自定义时间）补在最前
 * @param onChange 选中某一项；再点一次已选中的项清空
 */
function HeadingMenu({
  label,
  value,
  display,
  options,
  onChange,
}: {
  label: string;
  value: string;
  display: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const all =
    value && !options.some((o) => o.value === value)
      ? [{ value, label: value }, ...options]
      : options;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className={cn(PILL, !value && "text-muted-foreground font-normal")}
      >
        {display || label}
      </PopoverTrigger>
      <PopoverContent
        collisionAvoidance={FLIP_COLLISION}
        align="start"
        sideOffset={6}
        className="bg-chrome ring-chrome-border max-h-(--available-height) w-36 gap-0.5 overflow-y-auto rounded-2xl p-1.5 shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150"
      >
        <div role="menu" aria-label={label} className="grid gap-0.5">
          {all.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => {
                onChange(o.value === value ? "" : o.value);
                setOpen(false);
              }}
              className={cn(
                "hover:bg-chrome-hover focus-visible:bg-chrome-hover flex min-h-9 w-full items-center justify-between gap-2 rounded-xl px-2.5 text-left text-[13px] outline-none",
                o.value === value && "bg-chrome-hover font-medium",
              )}
            >
              {o.label}
              {o.value === value && <Check className="size-3.5 opacity-70" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 稿纸上的场次标题：一行纯文字，场号、时间、内外景、地点用空白隔开，短标题靠右 */
const ROW =
  "group mb-3.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1 font-bold tracking-[0.06em]";
const NO = "text-status-warning min-w-8 font-mono text-[13px] font-semibold tracking-normal";
const TITLE = "text-muted-foreground ml-auto font-sans text-[12.5px] font-normal tracking-normal";
/** 可点的字：平时就是标题文字，悬停或聚焦时出现虚线下划线 */
const PILL =
  "cursor-pointer border-b border-dashed border-transparent leading-normal outline-none transition-colors duration-150 hover:border-current/30 focus-visible:border-current/50";

/**
 * 场次标题：场号 + 时间 + 内外景 + 地点。场号由顺序推出；地点来自地点表，点开选择或新建。
 * @param scene 这一场
 * @param label 场号，如 "3-1"
 * @param locationName 地点正式名，没选是 null
 * @param unconfirmed 地点还是待确认状态
 * @param editable 是否可编辑
 * @param canDelete 是否允许删除这一场（至少保留一场）
 * @param onChange 改内外景、时间
 * @param onPickLocation 打开地点选择，anchor 是被点的按钮
 * @param onDelete 删除这一场
 */
export function SceneHeading({
  scene,
  label,
  locationName,
  unconfirmed,
  editable,
  canDelete,
  onChange,
  onPickLocation,
  onDelete,
}: {
  scene: EditorScene;
  label: string;
  locationName: string | null;
  unconfirmed: boolean;
  editable: boolean;
  canDelete: boolean;
  onChange: (patch: Partial<EditorScene>) => void;
  onPickLocation: (anchor: HTMLElement) => void;
  onDelete: () => void;
}) {
  if (!editable) return <ReadOnlyHeading scene={scene} label={label} locationName={locationName} />;
  return (
    <div data-scene-heading={scene.key} className={ROW}>
      <span className={NO}>{label}</span>
      <HeadingMenu
        label="时间"
        value={scene.timeLabel}
        display={scene.timeLabel}
        options={TIMES.map((t) => ({ value: t, label: t }))}
        onChange={(timeLabel) => onChange({ timeLabel })}
      />
      <HeadingMenu
        label="内外景"
        value={scene.intExt}
        display={INT_EXT_TEXT[scene.intExt]}
        options={INT_EXT}
        onChange={(v) => onChange({ intExt: v as ScriptIntExt })}
      />
      <button
        type="button"
        onClick={(e) => onPickLocation(e.currentTarget)}
        className={cn(PILL, !locationName && "text-muted-foreground font-normal")}
      >
        {locationName ?? "地点"}
      </button>
      {unconfirmed && (
        <span className="bg-status-info size-1.5 self-center rounded-full" title="待确认" />
      )}
      {scene.title ? <span className={TITLE}>{scene.title}</span> : <span className="ml-auto" />}
      {canDelete && (
        <button
          type="button"
          title="删除这一场"
          onClick={onDelete}
          className="text-muted-foreground hover:bg-chrome-hover hover:text-destructive -my-1 grid size-7 place-items-center self-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}
