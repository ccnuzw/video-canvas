import { useEffect, useState, type ReactNode } from "react";
import { Copy, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  changeAdminPresetState,
  listAdminPresets,
  saveAdminPreset,
  type AdminPreset,
  type AdminPresetGroup,
  type PresetAction,
  type PresetInput,
  type PresetStatus,
} from "@/api/admin/drama-prompt-preset";
import { DRAMA_ERR, isDramaError } from "@/api/drama/errors";
import type { PromptStep } from "@/api/drama/type";
import { confirm } from "@/components/admin-ui/confirm-dialog";
import { DataPage, DataPanel, DataPanelBody } from "@/components/admin-ui/data-panel";
import { FilterSelect } from "@/components/admin-ui/filter-select";
import { LoadFailed } from "@/components/admin-ui/load-failed";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@/components/admin-ui/page-header";
import { RowIconAction, RowMoreMenu } from "@/components/admin-ui/row-icon-action";
import { Segmented, SegmentedItem } from "@/components/admin-ui/segmented";
import { StatusLabel } from "@/components/admin-ui/status-dot";
import { TableSkeletonRows } from "@/components/admin-ui/table-skeleton-rows";
import { TableToolbar, TableToolbarCount } from "@/components/admin-ui/table-toolbar";
import { Tag } from "@/components/admin-ui/tag";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PROMPT_STEPS } from "@/utils/drama/prompts";

import { PresetEditor, type PresetEdit } from "./preset-editor";

const statuses = { enabled: "已启用", disabled: "已停用", archived: "已归档" } as const;
const actions = { enable: "启用", disable: "停用", archive: "归档", default: "设为默认" } as const;

const statusOptions = [["", "全部状态"], ...Object.entries(statuses)] as const;
const headClass = "text-muted-foreground px-3 text-xs";
const columnCount = 5;

function PresetTable({
  rows,
  defaultId,
  loading,
  onEdit,
  onAction,
  emptyContent,
}: {
  rows: AdminPreset[];
  defaultId: string | undefined;
  loading: boolean;
  onEdit: (edit: PresetEdit) => void;
  onAction: (row: AdminPreset, action: PresetAction) => void;
  emptyContent: ReactNode;
}) {
  return (
    <Table aria-busy={loading}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={headClass}>模板名称</TableHead>
          <TableHead className={headClass}>用途</TableHead>
          <TableHead className={headClass}>状态</TableHead>
          <TableHead className={headClass}>更新时间 / 操作者</TableHead>
          <TableHead className="text-muted-foreground px-3 text-right text-xs">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableSkeletonRows columns={columnCount} />
        ) : rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={columnCount}
              className="text-muted-foreground h-32 text-center text-sm"
            >
              {emptyContent}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const isDefault = row.id === defaultId;
            const available = row.status !== "archived";
            const enabled = row.status === "enabled";
            return (
              <TableRow key={row.id}>
                <TableCell className="h-14 min-w-32 px-3 py-3 whitespace-normal font-medium">
                  <div className="flex max-w-64 flex-wrap items-center gap-1.5">
                    <span className="min-w-0 wrap-anywhere">{row.name}</span>
                    {isDefault && <Tag tone="info">默认</Tag>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground min-w-32 max-w-72 px-3 py-3 text-xs wrap-anywhere whitespace-normal">
                  {row.description || "—"}
                </TableCell>
                <TableCell className="px-3 py-3">
                  <StatusLabel tone={enabled ? "success" : "neutral"}>
                    {statuses[row.status]}
                  </StatusLabel>
                </TableCell>
                <TableCell className="text-muted-foreground px-3 py-3 text-xs tabular-nums">
                  <time dateTime={row.updated_at}>{new Date(row.updated_at).toLocaleString()}</time>
                  <div>{row.updated_by ? `管理员 ${row.updated_by}` : "系统"}</div>
                </TableCell>
                <TableCell className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {available && (
                      <RowIconAction label="编辑" target={row.name} onClick={() => onEdit({ row })}>
                        <Pencil />
                      </RowIconAction>
                    )}
                    <RowIconAction
                      label="复制"
                      target={row.name}
                      onClick={() => onEdit({ row, copy: true })}
                    >
                      <Copy />
                    </RowIconAction>
                    {available && !isDefault && (
                      <RowMoreMenu label={`${row.name}的更多操作`}>
                        {enabled && (
                          <DropdownMenuItem onClick={() => onAction(row, "default")}>
                            设为默认
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => onAction(row, enabled ? "disable" : "enable")}
                        >
                          {enabled ? "停用" : "启用"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onAction(row, "archive")}
                        >
                          归档
                        </DropdownMenuItem>
                      </RowMoreMenu>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

export default function DramaPresetsPage() {
  const [step, setStep] = useState<PromptStep>("plan");
  const [filter, setFilter] = useState<PresetStatus | "">("");
  const [edit, setEdit] = useState<PresetEdit | null>(null);
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ request: number; groups: AdminPresetGroup[] | null }>();
  const reload = () => setRequest((value) => value + 1);

  useEffect(() => {
    let active = true;
    void listAdminPresets().then(
      (groups) => {
        if (active) setResult({ request, groups });
      },
      () => {
        if (active) setResult({ request, groups: null });
      },
    );
    return () => {
      active = false;
    };
  }, [request]);

  const loading = result?.request !== request;
  const group = result?.groups?.find((item) => item.step === step);
  const rows =
    !loading && group?.default_id
      ? group.items.filter((item) => !filter || item.status === filter)
      : [];
  const save = async (id: string | undefined, input: PresetInput) => {
    try {
      await saveAdminPreset(step, id, input);
      setEdit(null);
      reload();
      toast.success("提示词已保存");
    } catch (cause) {
      if (isDramaError(cause, DRAMA_ERR.presetChanged)) reload();
      throw cause;
    }
  };

  const onAction = (row: AdminPreset, action: PresetAction) => {
    if (!group) return;
    const current = group.items.find((item) => item.id === group.default_id);
    void confirm({
      title: `${actions[action]}「${row.name}」`,
      description:
        action === "default"
          ? `默认项：${current?.name ?? "—"} → ${row.name}。新项目将预选它，已建项目不变。`
          : action === "enable"
            ? "启用后，创作者可以选用这条提示词。"
            : "创作者不能再新选这条提示词，已建项目仍可沿用其快照。",
      confirmLabel: actions[action],
      destructive: action === "archive",
      onConfirm: async () => {
        try {
          await changeAdminPresetState(
            step,
            row.id,
            action,
            action === "default" ? group.revision : row.revision,
          );
          reload();
          toast.success(`已${actions[action]}`);
        } catch (cause) {
          reload();
          throw cause;
        }
      },
    });
  };

  return (
    <DataPage>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>短剧提示词</PageHeaderTitle>
        </PageHeaderHeading>
        <PageHeaderActions>
          {group?.original_body && (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => setEdit({ copy: true, originalBody: group.original_body })}
            >
              复制原内置
            </Button>
          )}
          <Button disabled={!group || loading || !group.default_id} onClick={() => setEdit({})}>
            <Plus />
            新建提示词
          </Button>
        </PageHeaderActions>
      </PageHeader>
      <DataPanel>
        <TableToolbar>
          <div className="max-w-full overflow-x-auto p-0.5">
            <Segmented aria-label="提示词分类" className="whitespace-nowrap">
              {PROMPT_STEPS.map(({ key, name }) => (
                <SegmentedItem
                  key={key}
                  active={key === step}
                  onClick={() => {
                    setStep(key);
                    setFilter("");
                  }}
                >
                  {name}
                </SegmentedItem>
              ))}
            </Segmented>
          </div>
          <FilterSelect
            aria-label="筛选状态"
            value={filter}
            options={statusOptions}
            onValueChange={(value) => setFilter(value as PresetStatus | "")}
          />
          {!loading && group?.default_id && (
            <TableToolbarCount shown={rows.length} total={group.items.length} />
          )}
        </TableToolbar>
        <DataPanelBody>
          <PresetTable
            rows={rows}
            defaultId={group?.default_id}
            loading={loading}
            onEdit={setEdit}
            onAction={onAction}
            emptyContent={
              !group ? (
                <LoadFailed onRetry={reload} />
              ) : !group.default_id ? (
                <span role="status">内置提示词管理暂未启用。</span>
              ) : (
                "没有匹配的提示词"
              )
            }
          />
        </DataPanelBody>
      </DataPanel>
      <PresetEditor step={step} edit={edit} onClose={() => setEdit(null)} onSave={save} />
    </DataPage>
  );
}
