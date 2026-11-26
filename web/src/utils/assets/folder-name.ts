/** 文件夹名称最长多少个字，与后端一致 */
export const FOLDER_NAME_MAX = 30;
/** 素材名称长度与后端库条目一致。 */
export const ASSET_NAME_MAX = 255;

/** 名称校验结果：通过时带去掉首尾空白后的名称，不通过时带可直接展示的原因 */
export type FolderNameResult = { ok: true; name: string } | { ok: false; message: string };

/**
 * 校验文件夹名称：去首尾空白后 1–30 字（按字符计，emoji 算一个字）。
 * 重名、数量上限由后端判断，直接展示后端的业务错误文案。
 * @param raw 输入框里的原文
 * @returns 校验结果
 */
export function validateFolderName(raw: string): FolderNameResult {
  return validateName(raw, "文件夹名称", FOLDER_NAME_MAX);
}

/** 校验个人资产库中的素材名称。 */
export function validateAssetName(raw: string): FolderNameResult {
  return validateName(raw, "素材名称", ASSET_NAME_MAX);
}

function validateName(raw: string, label: string, max: number): FolderNameResult {
  const name = raw.trim();
  if (!name) return { ok: false, message: `请输入${label}` };
  if (name.includes("\0")) return { ok: false, message: `${label}包含无效字符` };
  if (Array.from(name).length > max) {
    return { ok: false, message: `名称最多 ${max} 个字` };
  }
  return { ok: true, name };
}
