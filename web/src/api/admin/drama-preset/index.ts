import service from "@/utils/requests/service";
import type {
  DramaPresetAdminItem,
  DramaPresetAdminView,
  DramaPresetKind,
  SaveDramaPresetBody,
  UpdateDramaPresetBody,
} from "./type";

/**
 * 读取某个种类的全部预设（含停用），按排序升序（admin 可读）
 * @param kind 题材 / 画风
 * @returns 预设列表，items 为 null 时兜底成空数组
 */
export const getDramaPresets = async (kind: DramaPresetKind): Promise<DramaPresetAdminView> => {
  const view = await service.get<DramaPresetAdminView>(
    `/admin/drama-presets?kind=${encodeURIComponent(kind)}`,
  );
  return { items: view.items ?? [] };
};

/**
 * 新建预设（admin）：排在同类末尾
 * @param body 预设内容
 * @returns 新建的预设
 */
export const createDramaPreset = (body: SaveDramaPresetBody) =>
  service.post<DramaPresetAdminItem>("/admin/drama-presets", body);

/**
 * 修改预设（admin）：只改传了的字段，key 不变
 * @param id 预设 ID
 * @param body 要改的字段
 * @returns 修改后的预设
 */
export const updateDramaPreset = (id: number, body: UpdateDramaPresetBody) =>
  service.put<DramaPresetAdminItem>(`/admin/drama-presets/${id}`, body);

/**
 * 启用或停用预设（admin）：停用只是从开拍设置里消失，已用它的短剧照常保存
 * @param id 预设 ID
 * @param enabled 是否启用
 * @returns 修改后的预设
 */
export const setDramaPresetEnabled = (id: number, enabled: boolean) =>
  service.put<DramaPresetAdminItem>(`/admin/drama-presets/${id}/enabled`, { enabled });

/**
 * 保存预设顺序（admin）
 * @param kind 题材 / 画风
 * @param ids 该种类全部预设 ID，按新顺序，必须不多不少
 */
export const reorderDramaPresets = (kind: DramaPresetKind, ids: number[]) =>
  service.put<null>("/admin/drama-presets/order", { kind, ids });

/**
 * 删除预设（仅 super_admin）：有短剧在用会返回 67039，只能停用
 * @param id 预设 ID
 */

/**
 * 上传 / 替换画风预览图（admin）：只收 WebP / PNG / JPEG，2MB 以内
 * @param id 预设 ID
 * @param file 图片文件
 * @returns 修改后的预设（preview_url 已换成新的预览路由地址）
 */
export const uploadDramaPresetPreview = (id: number, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return service.upload<DramaPresetAdminItem>(`/admin/drama-presets/${id}/preview`, form);
};
