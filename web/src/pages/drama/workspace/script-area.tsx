import { useSharedWorkspace } from "@/hooks/use-shared-workspace";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BookOpen, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { getEpisode, updateEpisode } from "@/api/drama";
import { dramaErrorMessage, isRevisionConflict } from "@/api/drama/errors";
import type { Episode } from "@/api/drama/type";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChromeButton, ChromePill, ChromeSeparator } from "@/components/canvas/chrome/chrome";
import { DURATION, EASE_OUT, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MAX_JOB_EPISODES, nextStep, showEmptyScript } from "@/utils/drama/episodes";
import type { ScriptDoc } from "@/utils/drama/stages";

import { useWorkspace } from "./context";
import { DocEditor } from "./doc-editor";
import { ScriptsDialog } from "./scripts-dialog";
import { EmptyScript, EpisodeMeta, type MetaField } from "./episode-meta";
import { useAnalyzing } from "./analyzing-view";
import { ScriptEditor } from "./script-editor";
import { SceneList } from "./script-editor/scene-list";
import { SourcePane } from "./script-editor/source-pane";
import { useSourceSync } from "./script-editor/use-source-sync";
import { useScriptEditor } from "./script-editor/use-script-editor";
import { ProjectDoc } from "./project-doc";
import { useEstimate } from "./use-estimate";

/** 目录里的一项 */
function TocItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring/50 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm outline-none focus-visible:ring-2",
        active
          ? "bg-muted font-medium"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 一集的剧本：读单集（含正文）、锁定只读、自动保存。
 * 还没有剧本（规划只出目录）时显示空状态：「这一集还没有剧本」+「生成剧本」，以及梗概、钩子、悬念。
 */
function EpisodeDoc({ no, onGenerate }: { no: number; onGenerate: (no: number) => void }) {
  const shared = useSharedWorkspace();
  const { drama, applyEpisode, reportSave } = useWorkspace();
  const summary = drama.episodes.find((ep) => ep.no === no);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [failed, setFailed] = useState(false);
  const revision = summary?.revision;
  const scriptStatus = summary?.scriptStatus;
  /** 已经读到（或自己刚存下）的 revision + 状态：目录里的值和它一致就不用再读，免得每次自动保存都多一次请求 */
  const known = useRef<string | null>(null);
  /** 原著对照分栏是否打开 */
  const [compare, setCompare] = useState(false);
  const reduceMotion = useReducedMotion();
  /** 稿纸和原著栏：对照时原著栏跟着稿纸滚 */
  const paperRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLElement>(null);
  const syncSource = useSourceSync(compare, paperRef, sourceRef);
  /** 剧本编辑器：读取、编辑、自动保存都在这里；侧栏的场次目录和人物弹窗共用同一份 */
  const editor = useScriptEditor(
    drama.id,
    no,
    summary?.locked ?? false,
    (status) => reportSave(`ep${no}`, status),
    (saved, hasContent) => {
      // 剧本保存让集级 revision 前进：同步到目录和这里持有的集，改钩子、悬念才不会冲突
      known.current = `${saved}:${hasContent ? "ready" : "empty"}`;
      setEpisode((prev) => (prev ? { ...prev, revision: saved } : prev));
      applyEpisode(no, { revision: saved, scriptStatus: hasContent ? "ready" : "empty" });
    },
    !shared,
  );

  /** 点场次目录：滚到对应的场次（减弱动态时直接跳） */
  const jumpTo = (sceneKey: string) => {
    document.querySelector<HTMLElement>(`[data-scene-key="${sceneKey}"]`)?.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  // 目录里这一集的 revision / 状态变了（生成完、任务改了）：重新读正文
  useEffect(() => {
    const key = `${revision}:${scriptStatus}`;
    if (!shared && known.current === key) return;
    let active = true;
    (shared ? Promise.resolve(shared.episodes[no]) : getEpisode(drama.id, no))
      .then((value) => {
        if (!active) return;
        known.current = `${value.revision}:${value.scriptStatus}`;
        setEpisode(value);
        setFailed(false);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [drama.id, no, revision, scriptStatus, shared]);

  if (!summary) return null;
  const empty = showEmptyScript(summary, episode?.scriptMd ?? "");
  /** 改开场钩子 / 结尾悬念：带 revision 乐观锁；冲突时载入最新内容并提示，失败让输入框留在编辑态 */
  const saveMeta = async (field: MetaField, value: string) => {
    if (!episode) return;
    try {
      const saved = await updateEpisode(drama.id, no, {
        revision: episode.revision,
        [field]: value,
      });
      known.current = `${saved.revision}:${saved.scriptStatus}`;
      setEpisode(saved);
      editor.syncRevision(saved.revision);
      applyEpisode(no, {
        revision: saved.revision,
        hook: saved.hook,
        cliffhanger: saved.cliffhanger,
        updatedAt: saved.updatedAt,
      });
    } catch (e) {
      if (isRevisionConflict(e)) {
        toast.warning(`第 ${no} 集在别处被修改过，已加载最新内容，你的改动没有保存`);
        const latest = await getEpisode(drama.id, no).catch(() => null);
        if (latest) {
          setEpisode(latest);
          applyEpisode(no, {
            revision: latest.revision,
            hook: latest.hook,
            cliffhanger: latest.cliffhanger,
          });
        }
      } else {
        toast.error(dramaErrorMessage(e, "保存失败，请稍后重试"));
      }
      throw e;
    }
  };
  if (failed && !episode) {
    return (
      <div className="text-muted-foreground p-10 text-center text-sm">
        这一集读取失败，请稍后重试
      </div>
    );
  }
  if (!episode) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-2.5 px-6 py-10">
        {[90, 70, 80].map((width) => (
          <Skeleton
            key={width}
            className="h-4 motion-reduce:animate-none"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex justify-center gap-8 px-6 pt-6 pb-28 max-sm:px-3">
      <div
        className={cn(
          // 打开原著对照时内容区平滑变宽，和原著栏展开同时进行
          "w-full min-w-0 transition-[max-width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
          compare ? "max-w-[1240px]" : "max-w-[720px]",
        )}
      >
        <div className="flex items-center gap-2">
          <h2 className="font-display min-w-0 truncate text-[22px] font-black tracking-wide">
            第 {no} 集 · {summary.title}
          </h2>
          {summary.locked && (
            <span className="bg-status-warning/15 text-status-warning inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs">
              <Lock className="size-3" />
              已锁定
            </span>
          )}
          {empty && (
            <span className="bg-muted text-muted-foreground inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs">
              待写剧本
            </span>
          )}
          {!empty && editor.phase === "ready" && (
            // 统计和「原著对照」合成一条半透明胶囊；人物与地点在左侧栏「人物」页里改
            <ChromePill className="ml-auto h-9 shrink-0 text-xs">
              <span
                className="text-muted-foreground hidden items-center gap-3 px-2.5 tabular-nums md:flex"
                title="预估时长按对白每秒 4 个字、动作 / 空镜 / 字幕每条 2 秒估算"
              >
                <span>
                  <b className="text-foreground">{editor.stats.scenes}</b> 场
                </span>
                <span>
                  <b className="text-foreground">{editor.stats.chars.toLocaleString()}</b> 字
                </span>
                <span
                  className={cn(
                    drama.episodeSeconds > 0 &&
                      editor.stats.seconds > drama.episodeSeconds &&
                      "text-destructive",
                  )}
                >
                  约 <b className="text-foreground">{editor.stats.seconds}</b>
                  {drama.episodeSeconds > 0 && ` / ${drama.episodeSeconds}`} 秒
                </span>
              </span>
              <ChromeSeparator className="max-md:hidden" />
              {summary.unitFrom !== null && summary.unitTo !== null && (
                <ChromeButton
                  active={compare}
                  aria-pressed={compare}
                  className={cn("h-7 px-2.5 text-xs", compare && "bg-chrome-hover")}
                  onClick={() => setCompare((on) => !on)}
                >
                  <BookOpen className="size-3.5!" />
                  原著对照
                </ChromeButton>
              )}
            </ChromePill>
          )}
        </div>
        {summary.locked && (
          <div className="bg-status-warning/10 mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
            <Lock className="text-status-warning size-4 shrink-0" />
            这一集已经拆解资产，剧本已锁定。资产和分镜都以这一版为准。
          </div>
        )}
        {summary.scriptStatus === "generating" ? (
          <div className="text-muted-foreground mt-16 flex flex-col items-center gap-2 text-center text-sm">
            <Loader2 className="size-6 animate-spin" />
            正在生成这一集的剧本…
          </div>
        ) : empty ? (
          <EmptyScript
            episode={summary}
            onGenerate={() => onGenerate(no)}
            onSaveMeta={shared ? undefined : saveMeta}
          />
        ) : shared ? (
          // 分享链接只读：数据来自快照，不读结构化接口，直接显示快照里的剧本文本
          <div className="bg-paper text-paper-foreground ring-border font-display relative mt-4 rounded-t-md rounded-b-[20px] px-[clamp(20px,7vw,88px)] pt-16 pb-24 text-[16px] leading-[2.05] shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)] ring-1">
            <DocEditor
              key={`ep${no}`}
              value={episode.scriptMd}
              revision={episode.revision}
              editable={false}
              isConflict={isRevisionConflict}
              onStatus={() => {}}
              onSave={async () => episode.revision}
            />
          </div>
        ) : (
          <div className="mt-4 flex items-start">
            {/* 原著栏：宽度从 0 展开到 40%，内容稍后淡入并从左滑进来，稿纸跟着平滑变窄；收起时反过来、更快 */}
            <AnimatePresence initial={false}>
              {compare && summary.unitFrom !== null && summary.unitTo !== null && (
                <motion.div
                  key="source"
                  // 吸顶放在最外层：原著栏自己的 sticky 包在动画容器里不起作用
                  className="sticky top-6 min-w-0 shrink-0 self-start overflow-hidden"
                  initial={reduceMotion ? false : { width: 0, marginRight: 0 }}
                  animate={{ width: "40%", marginRight: 16 }}
                  exit={reduceMotion ? undefined : { width: 0, marginRight: 0 }}
                  transition={reduceMotion ? { duration: 0 } : SPRING}
                >
                  <motion.div
                    className="p-px"
                    initial={reduceMotion ? false : { opacity: 0, x: -24 }}
                    animate={{
                      opacity: 1,
                      x: 0,
                      transition: { duration: DURATION.slow, ease: EASE_OUT, delay: 0.06 },
                    }}
                    exit={
                      reduceMotion
                        ? undefined
                        : {
                            opacity: 0,
                            x: -24,
                            transition: { duration: DURATION.exit, ease: EASE_OUT },
                          }
                    }
                  >
                    <SourcePane
                      dramaId={drama.id}
                      from={summary.unitFrom}
                      to={summary.unitTo}
                      paneRef={sourceRef}
                      onLoaded={syncSource}
                    />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
            <ScriptEditor editor={editor} no={no} paperRef={paperRef} />
          </div>
        )}
      </div>
      {/* 页边：场次目录、梗概 / 钩子 / 悬念和对应原文，宽屏才有 */}
      <aside className="sticky top-6 hidden w-52 shrink-0 self-start pt-12 xl:block">
        {!empty && !shared && (
          <>
            <div className="text-muted-foreground mb-2 font-mono text-[10.5px] tracking-[0.14em]">
              本集场次
            </div>
            {editor.scenes.length > 0 && editor.phase === "ready" ? (
              <SceneList editor={editor} no={no} onJump={jumpTo} />
            ) : (
              <p className="text-muted-foreground mb-5 text-xs">这一集还没有场次</p>
            )}
          </>
        )}
        <EpisodeMeta
          episode={summary}
          unitKind={drama.unitKind}
          inEmptyState={empty}
          onSaveMeta={shared ? undefined : saveMeta}
        />
      </aside>
    </div>
  );
}

/**
 * 底部「下一步」浮条：生成分集剧本 / 资产拆解，点了都先弹框选集数；
 * 有进行中任务时禁用并写明原因
 */
function NextStepPill({
  onBreakdown,
  onScripts,
}: {
  onBreakdown: () => void;
  onScripts: () => void;
}) {
  const { drama, jobs } = useWorkspace();
  const step = nextStep(drama, jobs);
  const estimate = useEstimate(
    drama.id,
    step.kind === "scripts"
      ? { step: "scripts", episodes: step.episodes.slice(0, MAX_JOB_EPISODES) }
      : null,
  );

  return (
    <>
      <AnimatePresence>
        {step.kind !== "none" && (
          <motion.div
            key={step.kind}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: DURATION.exit } }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            className="bg-chrome ring-chrome-border absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-sm shadow-lg ring-1 backdrop-blur-xl"
          >
            {step.kind === "scripts" ? (
              <>
                <span className="tabular-nums">{step.episodes.length} 集还没有剧本</span>
                {estimate.status === "ready" && (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {step.episodes.length > MAX_JOB_EPISODES && `前 ${MAX_JOB_EPISODES} 集 `}约{" "}
                    <span className="text-credit">{estimate.credits}</span> 积分
                  </span>
                )}
              </>
            ) : (
              <span>剧本整理完毕，下一步拆解角色和场景</span>
            )}
            <Button
              size="sm"
              className="rounded-full"
              disabled={!!step.disabledReason}
              title={step.disabledReason ?? undefined}
              onClick={step.kind === "scripts" ? onScripts : onBreakdown}
            >
              {step.kind === "scripts" ? "生成分集剧本" : "资产拆解"}
            </Button>
            {step.disabledReason && (
              <span className="text-muted-foreground max-w-48 truncate pr-3 text-xs">
                {step.disabledReason}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * 剧本区：文档（Markdown 编辑、自动保存），换集、打开大纲 / 人物传记都用左侧分集栏。
 * 研读中大纲页里显示步骤和骨架屏，底部「下一步」浮条。
 */
export function ScriptArea({
  ep,
  doc,
  onEp,
  onDoc,
  onBreakdownOpen,
}: {
  /** 当前集号（来自左侧分集栏） */
  ep: number;
  /** 打开的大纲 / 人物传记；null 看当前集的剧本 */
  doc: ScriptDoc | null;
  onEp: (ep: number) => void;
  onDoc: (doc: ScriptDoc) => void;
  onBreakdownOpen: () => void;
}) {
  const shared = useSharedWorkspace();
  const { drama } = useWorkspace();
  const { analyzing, showAnalyzing } = useAnalyzing();
  /** 写剧本弹窗：从浮条打开用默认选择，从某一集的空状态打开预选这一集 */
  const [scripts, setScripts] = useState<{ open: boolean; initial?: number[] }>({ open: false });

  return (
    <div className="flex h-full min-h-0">
      <ScriptsDialog
        open={scripts.open}
        initial={scripts.initial}
        onOpenChange={(open) => setScripts((prev) => ({ ...prev, open }))}
      />
      <div className="relative min-w-0 flex-1">
        <div className="h-full overflow-y-auto">
          {drama.status === "failed" && !analyzing && (
            <div
              role="alert"
              className="bg-destructive/10 text-destructive mx-auto mt-4 w-full max-w-3xl rounded-lg px-4 py-2 text-sm"
            >
              上一步任务失败了，可以在上方重试，失败不扣积分。
            </div>
          )}
          {/* 窄屏没有左侧分集栏：顶部用标签切换大纲、人物和集 */}
          <div className="border-border flex gap-1 overflow-x-auto border-b p-2 sm:hidden">
            <TocItem active={doc === "outline"} onClick={() => onDoc("outline")}>
              大纲
            </TocItem>
            <TocItem active={doc === "characters"} onClick={() => onDoc("characters")}>
              人物
            </TocItem>
            <TocItem active={doc === "locations"} onClick={() => onDoc("locations")}>
              地点
            </TocItem>
            {drama.episodes.map((item) => (
              <TocItem key={item.no} active={!doc && ep === item.no} onClick={() => onEp(item.no)}>
                第{item.no}集
              </TocItem>
            ))}
          </div>
          {doc ? (
            <ProjectDoc key={doc} doc={doc} />
          ) : (
            <EpisodeDoc
              key={ep}
              no={ep}
              onGenerate={(no) => setScripts({ open: true, initial: [no] })}
            />
          )}
        </div>
        {!shared && !showAnalyzing && (
          <NextStepPill
            onBreakdown={onBreakdownOpen}
            onScripts={() => setScripts({ open: true })}
          />
        )}
      </div>
    </div>
  );
}
