import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, GitCompareArrows } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { caretOffset, isCollapsed, setCaret } from "./caret";
import { ElementRow } from "./element-row";
import { EntityPicker, type PickerTarget } from "./entity-picker";
import { SceneHeading } from "./scene-heading";
import { ElementBar } from "./element-bar";
import type { ScriptEditorApi } from "./use-script-editor";

/** 光标所在位置：哪一场的哪一行 */
interface Cursor {
  sceneKey: string;
  elKey: string;
}

/** 稿纸本身：宋体正文、宽行距；上方是元素类型条，所以上边不圆角 */
const PAPER =
  "bg-paper text-paper-foreground ring-border font-display relative rounded-b-[20px] px-[clamp(20px,7vw,88px)] pt-10 pb-24 text-[16px] leading-[2.05] shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)] ring-1 transition-[filter] duration-200";

/** 稿纸自己滚时，读取中 / 失败（没有类型条）整栏就是滚动区；左右上下各留 1px，稿纸描边不被裁掉 */
const ROOT_SCROLL = "self-stretch overflow-y-auto p-px";
/** 稿纸自己滚时的正常编辑态：类型条固定在上面，下面的稿纸单独滚 */
const ROOT_SCROLL_WITH_BAR = "flex flex-col self-stretch";
const PAPER_SCROLL = "min-h-0 flex-1 overflow-y-auto p-px";

/**
 * 结构化剧本编辑器（稿纸，版式参考 reveric 的剧本编辑器）：上方一行元素类型条，下面是场次标题 + 元素行。
 * 用户不用输入任何格式符号，Enter 换行并按规则接下一种元素（角色后接对白），Tab 切类型，
 * 对白永远挂在角色下面，格式乱不了。读取中、读取失败、已锁定时稿纸也在，只是没有类型条。
 * @param editor 编辑状态与动作（由外层的 useScriptEditor 创建，侧栏也要用同一份）
 * @param no 集号，用来显示场号
 * @param paperRef 稿纸元素，原著对照时用来同步滚动
 * @param scroll 稿纸自己滚：类型条固定在上面，滚动条从稿纸顶边开始、落在稿纸旁边
 */
export function ScriptEditor({
  editor,
  no,
  paperRef,
  scroll = false,
}: {
  editor: ScriptEditorApi;
  no: number;
  paperRef?: React.Ref<HTMLDivElement>;
  scroll?: boolean;
}) {
  const { scenes, scenesRef, readOnly } = editor;
  // 根节点用 state 持有（回调 ref）：弹层定位的函数要在渲染外读它，闭包 state 比闭包 ref 更干净
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const appliedFocus = useRef(0);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  /** 用户点按钮打开的选择框；新建角色行时的自动打开由 editor.focus 推出，不进这里 */
  const [picked, setPicked] = useState<PickerTarget | null>(null);

  const characterName = useMemo(
    () => new Map(editor.characters.map((c) => [c.id, c])),
    [editor.characters],
  );
  const locationName = useMemo(
    () => new Map(editor.locations.map((l) => [l.id, l])),
    [editor.locations],
  );

  // 编辑操作后把光标放到该去的行；每个 token 只应用一次
  useLayoutEffect(() => {
    const f = editor.focus;
    if (!f || f.token === appliedFocus.current) return;
    appliedFocus.current = f.token;
    const row = rootEl?.querySelector<HTMLElement>(`[data-el="${f.key}"]`);
    if (!row) return;
    const text = row.querySelector<HTMLElement>("[data-text]");
    if (text) setCaret(text, f.off ?? "end");
    else row.querySelector<HTMLElement>("[data-pick], [data-focusable]")?.focus();
  }, [editor.focus, rootEl]);

  // 把行切成「角色」后，立刻弹出人物选择：由 focus 推出，不用在 effect 里再 setState；
  // 弹层贴着谁等到真正定位时才去找 DOM，渲染期间不碰 ref
  const autoPick: PickerTarget | null = useMemo(() => {
    const f = editor.focus;
    if (!f?.pick) return null;
    const sc = scenes.find((s) => s.elements.some((e) => e.key === f.key));
    if (!sc) return null;
    return {
      kind: "character",
      sceneKey: sc.key,
      elKey: f.key,
      anchor: () => rootEl?.querySelector<HTMLElement>(`[data-el="${f.key}"] [data-pick]`) ?? null,
    };
  }, [editor.focus, scenes, rootEl]);
  const picker = picked ?? autoPick;

  const closePicker = () => {
    setPicked(null);
    editor.consumeFocus();
  };

  const locate = (target: EventTarget | null) => {
    const row = (target as HTMLElement | null)?.closest<HTMLElement>("[data-el]");
    if (!row) return null;
    const sc = scenesRef.current.find((s) => s.key === row.dataset.scene);
    const i = sc?.elements.findIndex((e) => e.key === row.dataset.el) ?? -1;
    return sc && i >= 0 ? { sc, i, el: sc.elements[i] } : null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || readOnly) return;
    const at = locate(e.target);
    if (!at) return;
    const { sc, i, el } = at;
    const text = (e.target as HTMLElement).closest<HTMLElement>("[data-text]");
    if (e.key === "Tab") {
      e.preventDefault();
      editor.cycle(sc.key, i, e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      editor.addScene(sc.key);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      editor.enter(sc.key, i, text ? caretOffset(text) : 0);
    } else if (e.key === "Backspace") {
      if (text && (!isCollapsed() || caretOffset(text) !== 0)) return;
      e.preventDefault();
      editor.backspace(sc.key, i, !text || el.text === "");
    }
  };

  const onFocus = (e: React.FocusEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-el]");
    if (row?.dataset.scene && row.dataset.el) {
      setCursor({ sceneKey: row.dataset.scene, elKey: row.dataset.el });
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const at = locate(e.target);
    if (!at || readOnly) return;
    const text = e.clipboardData.getData("text/plain");
    // 单行交给浏览器直接插进文字；多行才需要解析成场次和元素
    if (!/\n/.test(text.trim())) return;
    e.preventDefault();
    void editor.paste(at.sc.key, at.i, text);
  };

  if (editor.phase === "loading") {
    return (
      <div className={cn("min-w-0 flex-1", scroll && ROOT_SCROLL)}>
        <div ref={paperRef} className={PAPER}>
          <div className="grid gap-2.5 py-2">
            {[90, 70, 80, 55].map((width) => (
              <Skeleton
                key={width}
                className="h-4 motion-reduce:animate-none"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (editor.phase === "failed") {
    return (
      <div className={cn("min-w-0 flex-1", scroll && ROOT_SCROLL)}>
        <div ref={paperRef} className={PAPER}>
          <p className="text-muted-foreground py-10 text-center text-sm">
            这一集读取失败，请稍后重试
          </p>
        </div>
      </div>
    );
  }

  /** 这一场的出场人物：说话的人（按首次出现）加没台词但在场的；只是显示，不可编辑 */
  const cast = (scene: (typeof scenes)[number]) => {
    const ids = [
      ...new Set([
        ...scene.elements.filter((e) => e.type === "character").map((e) => e.characterId),
        ...scene.extraCharacterIds,
      ]),
    ];
    return ids
      .map((id) => (id ? characterName.get(id)?.name : undefined))
      .filter(Boolean)
      .join("、");
  };
  const problem = editor.problem;
  const curScene = scenes.find((s) => s.key === cursor?.sceneKey) ?? scenes[0];
  const curIndex = Math.max(
    0,
    curScene.elements.findIndex((e) => e.key === cursor?.elKey),
  );

  return (
    <div
      ref={setRootEl}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={onFocus}
      className={cn("min-w-0 flex-1", scroll && ROOT_SCROLL_WITH_BAR)}
    >
      <ElementBar
        els={curScene.elements}
        index={curIndex}
        readOnly={readOnly}
        onType={(type) => editor.setType(curScene.key, curIndex, type)}
        onMarker={(type) => editor.insertMarker(curScene.key, curIndex, type)}
        onNewScene={() => editor.addScene(curScene.key)}
      />
      <div className={cn(scroll && PAPER_SCROLL)}>
        <div ref={paperRef} className={cn(PAPER, readOnly && "saturate-[.7]")}>
          {editor.status === "conflict" && (
            <div
              role="alert"
              className="bg-destructive/10 mb-4 flex items-center gap-2 rounded-xl px-3 py-2 font-sans text-sm"
            >
              <GitCompareArrows className="text-destructive size-4 shrink-0" />
              <span className="flex-1">内容已在别处修改</span>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => void editor.reload()}
              >
                重新加载
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => void editor.overwrite()}
              >
                覆盖
              </Button>
            </div>
          )}
          {problem && (
            <div
              role="alert"
              className="bg-destructive/10 mb-4 flex items-center gap-2 rounded-xl px-3 py-2 font-sans text-sm"
            >
              <CircleAlert className="text-destructive size-4 shrink-0" />
              <span className="flex-1">
                剧本结构不合法：第 {no}-{problem.scene + 1} 场第 {problem.element + 1} 行，
                {problem.message}
                ，改好后会自动保存
              </span>
            </div>
          )}
          {scenes.map((scene, si) => {
            const loc = scene.locationId ? locationName.get(scene.locationId) : undefined;
            return (
              <section key={scene.key} data-scene-key={scene.key} className="mb-11 scroll-mt-16">
                <SceneHeading
                  scene={scene}
                  label={`${no}-${si + 1}`}
                  locationName={loc?.name ?? null}
                  unconfirmed={!!loc && !loc.confirmed}
                  editable={!readOnly}
                  canDelete={scenes.length > 1}
                  onChange={(patch) => editor.patchScene(scene.key, patch)}
                  onPickLocation={(anchor) =>
                    setPicked({ kind: "location", sceneKey: scene.key, anchor })
                  }
                  onDelete={() => editor.deleteScene(scene.key)}
                />
                {cast(scene) && (
                  <p
                    data-scene-cast
                    className="text-muted-foreground -mt-1.5 mb-1 text-[13.5px] leading-[1.8]"
                  >
                    出场人物：<span className="text-foreground/70">{cast(scene)}</span>
                  </p>
                )}
                {scene.elements.map((el, ei) => {
                  const person = el.characterId ? characterName.get(el.characterId) : undefined;
                  return (
                    <ElementRow
                      key={el.key}
                      el={el}
                      sceneKey={scene.key}
                      editable={!readOnly}
                      characterName={person?.name ?? null}
                      unconfirmed={!!person && !person.confirmed}
                      highlighted={false}
                      invalid={!!problem && problem.scene === si && problem.element === ei}
                      onText={editor.setText}
                      onPick={(sceneKey, elKey, anchor) =>
                        setPicked({ kind: "character", sceneKey, elKey, anchor })
                      }
                      onExtension={editor.cycleExtension}
                    />
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
      <EntityPicker
        target={picker}
        entities={picker?.kind === "location" ? editor.locations : editor.characters}
        onPick={(target, id) => {
          if (target.kind === "character" && target.elKey) {
            editor.setCharacter(target.sceneKey, target.elKey, id);
          } else {
            editor.patchScene(target.sceneKey, { locationId: id });
          }
          closePicker();
        }}
        onCreate={(target, name) => {
          void editor.createEntity(target.kind, name).then((id) => {
            if (!id) return;
            if (target.kind === "character" && target.elKey) {
              editor.setCharacter(target.sceneKey, target.elKey, id);
            } else {
              editor.patchScene(target.sceneKey, { locationId: id });
            }
            closePicker();
          });
        }}
        onClose={closePicker}
      />
    </div>
  );
}
