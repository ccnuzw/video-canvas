import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  getDramaPresets,
  reorderDramaPresets,
  setDramaPresetEnabled,
} from "@/api/admin/drama-preset";
import type { DramaPresetAdminItem, DramaPresetKind } from "@/api/admin/drama-preset/type";

import { useAliveRef, type LoadStatus } from "../use-admin";

/**
 * 预设后台页的数据与操作：按当前种类取一次；开关、排序先落到界面，请求失败再按服务端重新拉。
 * 种类变化由调用方用 key 重挂载处理（见 preset-panel.tsx），这里不监听 kind 的切换。
 * 请求错误的全局提示由拦截器弹，这里只管状态。
 * @param kind 题材 / 画风
 */
export function usePresetsAdmin(kind: DramaPresetKind) {
  const aliveRef = useAliveRef();
  const [items, setItems] = useState<DramaPresetAdminItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  /** 正在保存的预设 ID（开关），对应行半透明、不可操作 */
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set());

  const reload = useCallback(async () => {
    try {
      const view = await getDramaPresets(kind);
      if (!aliveRef.current) return;
      setItems(view.items);
      setStatus("ready");
    } catch {
      if (aliveRef.current) setStatus((prev) => (prev === "ready" ? prev : "error"));
    }
  }, [aliveRef, kind]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setBusy = (id: number, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  /** 启用 / 停用 */
  const toggleEnabled = useCallback(
    async (item: DramaPresetAdminItem) => {
      setBusy(item.id, true);
      try {
        await setDramaPresetEnabled(item.id, !item.enabled);
        await reload();
      } catch {
        // 全局 toast 已弹，开关保持原样
      } finally {
        if (aliveRef.current) setBusy(item.id, false);
      }
    },
    [aliveRef, reload],
  );

  /** 拖动排序：先改界面，保存成功后重新拉，失败也按服务端重新拉 */
  const reorder = useCallback(
    async (next: DramaPresetAdminItem[]) => {
      setItems(next);
      try {
        await reorderDramaPresets(
          kind,
          next.map((item) => item.id),
        );
        if (aliveRef.current) toast("顺序已保存");
      } finally {
        if (aliveRef.current) void reload();
      }
    },
    [aliveRef, kind, reload],
  );

  return { items, status, busyIds, reload, toggleEnabled, reorder };
}
