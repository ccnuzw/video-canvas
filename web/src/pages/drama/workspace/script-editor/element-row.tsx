import { memo } from "react";

import type { ScriptElementType } from "@/api/drama/type";
import { cn } from "@/lib/utils";
import type { EditorElement } from "@/utils/drama/script-doc";

import { EditableText } from "./editable-text";

/** 各类型空行时的占位提示 */
const PLACEHOLDER: Partial<Record<ScriptElementType, string>> = {
  action: "动作",
  parenthetical: "语气或同时发生的动作",
  dialogue: "台词",
  transition: "切至：",
  subtitle: "字幕内容",
  shot: "空镜画面",
  note: "备注，只有你看得到",
};

/**
 * 各类型文字的版式（参考 reveric 的剧本版式，左对齐）：动作前悬挂 △，括号灰色缩进，
 * 对白缩进并带 └ 引线，转场靠右，字幕居中加粗。△ 和 └ 是行外的装饰元素，不在这里。
 */
const TEXT_CLASS: Partial<Record<ScriptElementType, string>> = {
  action: "my-1 pl-[22px]",
  parenthetical:
    "pl-11 text-[14.5px] text-muted-foreground not-empty:before:content-['（'] not-empty:after:content-['）']",
  dialogue: "pl-11",
  transition: "mt-3 text-right text-[14px] font-bold tracking-[0.2em] text-muted-foreground",
  subtitle: "my-3 text-center font-bold tracking-[0.2em] text-muted-foreground",
  shot: "pl-[22px] not-empty:before:font-sans not-empty:before:text-[13px] not-empty:before:text-muted-foreground not-empty:before:content-['空镜　']",
  note: "my-1.5 rounded-none border-l-2 border-[oklch(0.76_0.12_305/0.3)] pl-3.5 font-sans text-[13px] leading-[1.8] text-[oklch(0.76_0.12_305)]",
};

/** 行外的装饰：动作、空镜前悬挂的 △；对白前的 └ 折角引线。不是正文，不可选中 */
function Decor({ type }: { type: ScriptElementType }) {
  if (type === "action" || type === "shot") {
    return (
      <span
        aria-hidden
        className="text-muted-foreground/60 pointer-events-none absolute top-[0.9em] left-0 text-[11px] leading-none select-none"
      >
        △
      </span>
    );
  }
  if (type === "dialogue") {
    return (
      <span
        aria-hidden
        className="border-border pointer-events-none absolute top-[0.7em] left-[22px] h-[9px] w-2.5 rounded-bl-[3px] border-b border-l select-none"
      />
    );
  }
  return null;
}

/**
 * 剧本里的一行。角色行是人物选择按钮而不是文字，所以对白永远挂在说话人下面；
 * 闪回标记是分隔线。组件按行记忆，只有这一行变了才重绘。
 * @param el 这一行
 * @param sceneKey 所在场次的 key
 * @param editable 是否可编辑
 * @param characterName 角色行选中的人物正式名，没选是 null
 * @param unconfirmed 这个人物还是待确认状态
 * @param highlighted 高亮（点人物时亮出他的全部台词）
 * @param invalid 保存校验没过的行
 * @param onText 文字变化
 * @param onPick 打开人物选择，anchor 是被点的按钮
 * @param onExtension 切换画外音标记
 */
export const ElementRow = memo(function ElementRow({
  el,
  sceneKey,
  editable,
  characterName,
  unconfirmed,
  highlighted,
  invalid,
  onText,
  onPick,
  onExtension,
}: {
  el: EditorElement;
  sceneKey: string;
  editable: boolean;
  characterName: string | null;
  unconfirmed: boolean;
  highlighted: boolean;
  invalid: boolean;
  onText: (sceneKey: string, elKey: string, text: string) => void;
  onPick: (sceneKey: string, elKey: string, anchor: HTMLElement) => void;
  onExtension: (sceneKey: string, elKey: string) => void;
}) {
  const wrap = cn(
    // 光标所在的行左侧亮一根细的定位线
    "relative rounded-md transition-colors after:pointer-events-none after:absolute after:inset-y-0.5 after:-left-5 after:w-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity focus-within:after:opacity-100 max-sm:after:-left-3",
    highlighted && "bg-status-warning/15",
    invalid && "bg-destructive/10 ring-destructive ring-1",
  );
  const common = { "data-el": el.key, "data-scene": sceneKey };

  if (el.type === "character") {
    return (
      <div {...common} className={cn(wrap, "mt-5 flex items-baseline gap-1")}>
        <button
          type="button"
          data-pick
          disabled={!editable}
          onClick={(e) => onPick(sceneKey, el.key, e.currentTarget)}
          className={cn(
            "hover:bg-chrome-hover focus-visible:bg-chrome-hover -ml-1.5 rounded-md px-1.5 font-bold outline-none disabled:cursor-default disabled:hover:bg-transparent",
            !characterName && "text-muted-foreground/70 font-normal",
          )}
        >
          {characterName ?? "选择人物"}
        </button>
        <span aria-hidden className="-ml-1 font-bold select-none">
          ：
        </span>
        {unconfirmed && (
          <span className="bg-status-info size-1.5 self-center rounded-full" title="待确认" />
        )}
        {(editable || el.extension) && (
          <button
            type="button"
            disabled={!editable}
            title="画外音 / 内心独白"
            onClick={() => onExtension(sceneKey, el.key)}
            className={cn(
              "rounded-full px-1.5 font-mono text-[11px] disabled:cursor-default",
              el.extension
                ? "bg-status-warning/15 text-status-warning"
                : "text-muted-foreground/60 hover:bg-chrome-hover",
            )}
          >
            {el.extension || "OS/VO"}
          </button>
        )}
      </div>
    );
  }

  if (el.type === "flashback_start" || el.type === "flashback_end") {
    return (
      <div {...common} className={wrap}>
        <div
          data-focusable
          tabIndex={0}
          className="text-muted-foreground before:bg-border after:bg-border focus:text-status-warning my-4 flex items-center gap-3.5 font-sans text-xs tracking-[0.3em] outline-none before:h-px before:flex-1 after:h-px after:flex-1"
        >
          {el.type === "flashback_start" ? "闪回" : "闪回结束"}
        </div>
      </div>
    );
  }

  return (
    <div {...common} className={wrap}>
      <Decor type={el.type} />
      <EditableText
        value={el.text}
        editable={editable}
        placeholder={PLACEHOLDER[el.type] ?? ""}
        onInput={(text) => onText(sceneKey, el.key, text)}
        className={TEXT_CLASS[el.type]}
      />
    </div>
  );
});
