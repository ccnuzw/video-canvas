import type { PromptPreset, PromptStep } from "@/api/drama/type";
import service from "@/utils/requests/service";

export type PresetStatus = "enabled" | "disabled" | "archived";
export type PresetAction = "enable" | "disable" | "archive" | "default";

export interface AdminPreset extends PromptPreset {
  body: string;
  status: PresetStatus;
  updated_by?: string;
  updated_at: string;
}

export interface AdminPresetGroup {
  step: PromptStep;
  default_id: string;
  original_body?: string;
  revision: number;
  items: AdminPreset[];
}

export type PresetInput = Pick<AdminPreset, "name" | "description" | "body"> & {
  revision?: number;
};

const path = "/admin/drama-prompt-presets";
const endpoint = (step: PromptStep, id: string) => `${path}/${step}/${encodeURIComponent(id)}`;

export async function listAdminPresets(): Promise<AdminPresetGroup[]> {
  return (await service.get<{ items: AdminPresetGroup[] }>(path)).items;
}

export async function saveAdminPreset(
  step: PromptStep,
  id: string | undefined,
  input: PresetInput,
) {
  const request = { silent: true };
  return id
    ? service.put<AdminPreset>(endpoint(step, id), input, request)
    : service.post<AdminPreset>(`${path}/${step}`, input, request);
}

export async function changeAdminPresetState(
  step: PromptStep,
  id: string,
  action: PresetAction,
  revision: number,
) {
  return service.put<AdminPreset>(
    `${endpoint(step, id)}/state`,
    { action, revision },
    { silent: true },
  );
}
