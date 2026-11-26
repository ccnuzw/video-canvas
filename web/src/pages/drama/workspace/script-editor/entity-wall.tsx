import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, Search, Trash2, X } from "lucide-react";

import {
  createScriptEntity,
  deleteScriptEntity,
  listScriptEntities,
  updateScriptEntity,
} from "@/api/drama";
import type { ScriptEntityDto, ScriptEntityKind } from "@/api/drama/type";
import { entityArt } from "@/utils/drama/entity-art";
import type { RefAsset } from "@/utils/drama/segment-assets";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NOUN: Record<ScriptEntityKind, string> = { character: "人物", location: "地点" };

/** 名字的首字，图位占位用；去掉引号，免得「成年“我”」显示成一个引号 */
const initialOf = (name: string) => name.replace(/[“”"「」『』]/g, "").slice(0, 1) || "?";

/** 名字对应一个稳定的色相，让没有图的占位也各有颜色 */
const hueOf = (name: string) => [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);

/** 图位比例的范围：角色三视图是横版，场景图也是横版，竖版肖像也有，太极端的限在这个范围里 */
const MIN_RATIO = 0.6;
const MAX_RATIO = 2.4;

/**
 * 图位：资产还没生成时只显示一个暗色的首字和「待生成」状态；有图时图片淡入盖住首字，完整显示不裁切。
 * 图位比例由外面定（一面墙上所有卡片共用，没图的卡片和有图的一样高）。
 * @param name 名字（取首字和色相）
 * @param kind 人物或地点
 * @param ratio 图位宽高比
 * @param src 资产图地址；资产还没出图或对不上名字时没有
 * @param onRatio 图读出来之后，把它本身的宽高比告诉外面
 */
function Slot({
  name,
  kind,
  ratio,
  src,
  onRatio,
}: {
  name: string;
  kind: ScriptEntityKind;
  ratio: number;
  src?: string;
  onRatio: (ratio: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const hue = hueOf(name);
  return (
    <div
      className="relative isolate grid place-items-center overflow-hidden"
      style={{ backgroundColor: `oklch(0.21 0.008 ${hue})`, aspectRatio: ratio }}
    >
      <span
        data-slot-initial
        aria-hidden
        className={cn(
          "font-display leading-none font-black transition-opacity duration-300 select-none",
          kind === "character" ? "text-[88px]" : "text-[64px]",
          loaded && "opacity-0",
        )}
        style={{ color: `oklch(0.45 0.03 ${hue})` }}
      >
        {initialOf(name)}
      </span>
      {src ? (
        <img
          src={src}
          alt={name}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w > 0 && h > 0) onRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, w / h)));
            setLoaded(true);
          }}
          className={cn(
            "absolute inset-0 size-full scale-[1.04] object-contain opacity-0 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            loaded && "scale-100 opacity-100",
          )}
        />
      ) : (
        <span className="text-muted-foreground absolute bottom-2.5 left-2.5 inline-flex h-[22px] items-center gap-1.5 rounded-full bg-black/30 px-2.5 text-[11px] backdrop-blur-md">
          <i className="bg-muted-foreground/60 size-[5px] rounded-full" />
          {kind === "character" ? "角色图待生成" : "场景图待生成"}
        </span>
      )}
    </div>
  );
}

/** 别名标签和「＋ 别名」：回车添加，点叉移除 */
function Aliases({
  aliases,
  disabled,
  onChange,
}: {
  aliases: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => {
    const name = draft.trim();
    setAdding(false);
    setDraft("");
    if (name && !aliases.includes(name)) onChange([...aliases, name]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {aliases.map((alias) => (
        <span
          key={alias}
          className="bg-chrome-hover text-muted-foreground inline-flex h-6 items-center gap-0.5 rounded-full pr-1 pl-2.5 text-xs"
        >
          {alias}
          <button
            type="button"
            title="移除别名"
            disabled={disabled}
            onClick={() => onChange(aliases.filter((a) => a !== alias))}
            className="hover:bg-chrome-hover grid size-[18px] place-items-center rounded-full opacity-60 hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          aria-label="新别名"
          value={draft}
          maxLength={64}
          placeholder="别名"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          className="bg-chrome-hover ring-chrome-border h-6 w-24 rounded-full px-2.5 text-xs ring-1 outline-none"
        />
      ) : (
        <button
          type="button"
          data-add-alias
          disabled={disabled}
          onClick={() => setAdding(true)}
          className="text-muted-foreground hover:text-foreground ring-chrome-border h-6 rounded-full px-2.5 text-xs ring-1 ring-inset"
        >
          ＋ 别名
        </button>
      )}
    </div>
  );
}

/** 一张卡：图位、名字、别名、小传 / 描述、出场信息；悬停右上角出现确认、删除 */
function EntityCard({
  entity,
  kind,
  art,
  ratio,
  onRatio,
  busy,
  onPatch,
  onDelete,
}: {
  entity: ScriptEntityDto;
  kind: ScriptEntityKind;
  /** 资产图地址；资产还没出图或对不上名字时为 null */
  art: string | null;
  /** 图位宽高比和读出新图比例时的回调：一面墙共用 */
  ratio: number;
  onRatio: (ratio: number) => void;
  busy: boolean;
  onPatch: (body: {
    name?: string;
    aliases?: string[];
    note?: string;
    confirmed?: boolean;
  }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(entity.name);
  const [note, setNote] = useState(entity.note);
  // 服务端的值变了（改名被规整、别处改过）就跟上；正在输入时不会变，因为只在提交后重读
  const [seen, setSeen] = useState({ name: entity.name, note: entity.note });
  if (seen.name !== entity.name || seen.note !== entity.note) {
    setSeen({ name: entity.name, note: entity.note });
    setName(entity.name);
    setNote(entity.note);
  }
  /** 上次提交的名字：回车提交后紧接着失焦，不要再提交一次 */
  const sent = useRef(entity.name);
  const commitName = () => {
    const next = name.trim();
    if (!next) setName(entity.name);
    else if (next !== entity.name && next !== sent.current) {
      sent.current = next;
      onPatch({ name: next });
    }
  };
  const appear =
    entity.episodes.length === 0
      ? kind === "character"
        ? "暂未出场"
        : "暂未出现"
      : `第 ${entity.episodes.join("、")} 集${kind === "character" ? ` · ${entity.lines} 句台词` : ""}`;
  return (
    <article
      data-entity={entity.id}
      className="bg-card ring-border group relative flex flex-col overflow-hidden rounded-[22px] ring-1 transition-shadow duration-200 hover:shadow-[0_20px_40px_-24px_rgb(0_0_0/0.7)]"
    >
      <Slot name={entity.name} kind={kind} ratio={ratio} src={art ?? undefined} onRatio={onRatio} />
      <div className="absolute top-2.5 right-2.5 z-10 flex gap-0.5 rounded-full bg-black/35 p-[3px] opacity-0 backdrop-blur-md transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        {!entity.confirmed && (
          <button
            type="button"
            title="确认"
            disabled={busy}
            onClick={() => onPatch({ confirmed: true })}
            className="grid size-[26px] place-items-center rounded-full text-white/75 hover:bg-white/10 hover:text-white"
          >
            <Check className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          title="删除"
          disabled={busy}
          onClick={onDelete}
          className="hover:text-destructive grid size-[26px] place-items-center rounded-full text-white/75 hover:bg-white/10"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="grid gap-2.5 px-[18px] pt-4 pb-[18px]">
        <div className="flex items-center gap-2">
          <input
            aria-label="名字"
            value={name}
            maxLength={64}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setName(entity.name);
            }}
            className="font-display hover:bg-chrome-hover/50 focus:bg-chrome-hover -ml-1 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-[19px] font-bold tracking-[0.04em] outline-none"
          />
          {!entity.confirmed && (
            <span className="bg-status-info/15 text-status-info shrink-0 rounded-full px-2 py-0.5 text-[11.5px]">
              待确认
            </span>
          )}
        </div>
        <Aliases
          aliases={entity.aliases}
          disabled={busy}
          onChange={(aliases) => onPatch({ aliases })}
        />
        <textarea
          aria-label={kind === "character" ? "人物小传" : "地点描述"}
          value={note}
          maxLength={4000}
          rows={2}
          disabled={busy}
          placeholder={
            kind === "character" ? "年龄、身份、性格、和谁是什么关系" : "这个地方的样子、光线、气氛"
          }
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== entity.note && onPatch({ note })}
          className="placeholder:text-muted-foreground/60 hover:bg-chrome-hover/50 focus:bg-chrome-hover -mx-1.5 field-sizing-content min-h-[3.6em] resize-none rounded-lg bg-transparent px-1.5 py-0.5 text-[13.5px] leading-[1.8] text-[oklch(0.82_0.01_85)] outline-none"
        />
        <div className="border-border text-muted-foreground border-t pt-2.5 text-xs">{appear}</div>
      </div>
    </article>
  );
}

/** 新增卡：先是一个虚线占位，点开变成名字输入框，回车建好；名字空着失焦就收回 */
function NewCard({
  kind,
  open,
  onOpen,
  onCancel,
  onCreate,
}: {
  kind: ScriptEntityKind;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const tile =
    "border-border text-muted-foreground flex min-h-[260px] flex-col items-center justify-center gap-2.5 rounded-[22px] border border-dashed text-[13px]";
  if (!open) {
    return (
      <button
        type="button"
        data-new-entity
        onClick={onOpen}
        className={cn(
          tile,
          "hover:text-foreground transition-colors duration-150 hover:bg-white/[0.02]",
        )}
      >
        <Plus className="size-5" />
        新增{NOUN[kind]}
      </button>
    );
  }
  const submit = () => {
    const next = name.trim();
    if (next) onCreate(next);
    else onCancel();
    setName("");
  };
  return (
    <div className={tile}>
      <input
        autoFocus
        aria-label={`新${NOUN[kind]}的名字`}
        value={name}
        maxLength={64}
        placeholder={`${NOUN[kind]}名字`}
        onChange={(e) => setName(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setName("");
            onCancel();
          }
        }}
        className="font-display bg-chrome-hover ring-chrome-border text-foreground h-10 w-3/4 rounded-full px-4 text-center text-[17px] font-bold ring-1 outline-none"
      />
    </div>
  );
}

/**
 * 人物页 / 地点页的卡片墙：这部短剧的剧本人物表或地点表，一人（一地）一张卡，名字、别名、小传 / 描述直接改。
 * 改名一处生效（旧名自动成为别名，后端重渲染未锁定集），解析剧本时自动登记的新名字标「待确认」，在卡上确认；
 * 仍被剧本引用的删不掉（后端返回原因，由全局提示弹出）。每次写完重新读表并通知外层刷新，剧本页再打开时就是新表。
 * 人物小传是 AI 写分集剧本时读的人物资料。
 * @param dramaId 短剧 id
 * @param kind 人物或地点
 * @param assets 画布上的资产节点，卡片上的图从这里按名字找
 * @param onChanged 表改了之后调用（工作台据此刷新分集信息）
 * 人物和地点之间切换时外层要换 key，让读取状态从头开始。
 */
export function EntityWall({
  dramaId,
  kind,
  assets,
  onChanged,
}: {
  dramaId: string;
  kind: ScriptEntityKind;
  /** 画布上的资产节点：人物、地点按名字找对应的资产图，没有就显示占位 */
  assets?: readonly RefAsset[];
  onChanged?: () => void;
}) {
  const [list, setList] = useState<ScriptEntityDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  /** 图位比例：第一张读出来的资产图决定，之后所有卡片都用它；没有图时用默认的 */
  const [artRatio, setArtRatio] = useState<number | null>(null);
  const ratio = artRatio ?? (kind === "character" ? 4 / 5 : 16 / 9);

  const load = useCallback(async () => {
    const next = await listScriptEntities(dramaId, kind);
    setList(next);
    setFailed(false);
  }, [dramaId, kind]);
  // 人物 / 地点切换由外层用 key 重新挂载，这里只管首次读取
  useEffect(() => {
    let active = true;
    listScriptEntities(dramaId, kind)
      .then((next) => active && setList(next))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [dramaId, kind]);

  /** 写操作：请求失败的提示由全局 toast 弹，这里只管恢复 busy、重读表、通知外层 */
  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
    } catch {
      // 失败原因已由请求层提示；重读一次让卡片回到服务端的值
    } finally {
      setBusy(null);
      await load().catch(() => undefined);
      onChanged?.();
    }
  };

  if (failed && !list) {
    return <p className="text-muted-foreground py-16 text-center text-sm">读取失败，请稍后重试</p>;
  }
  const q = query.trim();
  const shown = (list ?? []).filter(
    (e) => !q || e.name.includes(q) || e.aliases.some((a) => a.includes(q)),
  );
  return (
    <div className="mx-auto w-full max-w-[1180px] px-8 pt-9 pb-32 max-sm:px-3">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl font-black tracking-[0.06em]">{NOUN[kind]}</h2>
        {list && <span className="text-muted-foreground text-[13px]">{list.length} 个</span>}
        <span className="flex-1" />
        <label className="bg-chrome-hover ring-chrome-border text-muted-foreground inline-flex h-[34px] items-center gap-2 rounded-full px-3.5 ring-1 ring-inset">
          <Search className="size-3.5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`搜索${NOUN[kind]}或别名`}
            className="text-foreground w-36 bg-transparent text-[13px] outline-none"
          />
        </label>
        <Button size="sm" className="rounded-full" onClick={() => setAdding(true)}>
          <Plus />
          新增{NOUN[kind]}
        </Button>
      </div>
      {!list ? (
        <p className="text-muted-foreground py-16 text-center text-sm">正在读取…</p>
      ) : (
        <div
          className={cn(
            "grid gap-[18px]",
            kind === "character"
              ? "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]"
              : "grid-cols-[repeat(auto-fill,minmax(320px,1fr))]",
          )}
        >
          {shown.map((entity) => (
            <EntityCard
              key={entity.id}
              entity={entity}
              kind={kind}
              art={entityArt(entity, kind, assets ?? [])}
              ratio={ratio}
              onRatio={(next) => setArtRatio((prev) => prev ?? next)}
              busy={busy === entity.id}
              onPatch={(body) =>
                void run(entity.id, () => updateScriptEntity(dramaId, kind, entity.id, body))
              }
              onDelete={() =>
                void run(entity.id, () => deleteScriptEntity(dramaId, kind, entity.id))
              }
            />
          ))}
          <NewCard
            kind={kind}
            open={adding}
            onOpen={() => setAdding(true)}
            onCancel={() => setAdding(false)}
            onCreate={(name) => {
              setAdding(false);
              void run("new", () => createScriptEntity(dramaId, kind, { name }));
            }}
          />
        </div>
      )}
    </div>
  );
}
