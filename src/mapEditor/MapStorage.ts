import {
  parseBattlefieldMap,
  serializeBattlefieldMap,
  type BattlefieldMap,
} from "../gridBattle/model/battlefieldMap";
import type { ProjectMapSummary } from "./localMapServer";

const MAP_API_PATH = "/api/project-maps";

interface ProjectMapListResponse {
  maps: ProjectMapSummary[];
}

interface ProjectMapSaveResponse {
  fileName: string;
  path: string;
}

export type { ProjectMapSummary } from "./localMapServer";

export function projectMapFileName(name: string): string {
  const stem = name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "") || "battlefield-map";
  return `${stem}.json`;
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("Project map storage is unavailable in this static build.");
  }
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Map request failed (${response.status}).`);
  return value;
}

export async function listProjectMaps(): Promise<ProjectMapSummary[]> {
  const response = await fetch(MAP_API_PATH, { headers: { Accept: "application/json" } });
  return (await responseJson<ProjectMapListResponse>(response)).maps;
}

export async function loadProjectMap(fileName: string): Promise<BattlefieldMap> {
  const response = await fetch(`${MAP_API_PATH}/${encodeURIComponent(fileName)}`, {
    headers: { Accept: "application/json" },
  });
  return parseBattlefieldMap(await responseJson<unknown>(response));
}

export async function saveProjectMap(
  name: string,
  map: BattlefieldMap,
): Promise<ProjectMapSaveResponse> {
  const fileName = projectMapFileName(name);
  const response = await fetch(`${MAP_API_PATH}/${encodeURIComponent(fileName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(serializeBattlefieldMap(map)),
  });
  return responseJson<ProjectMapSaveResponse>(response);
}
