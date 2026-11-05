import {
  parseBattlefieldMap,
  serializeBattlefieldMap,
  type BattlefieldMap,
} from "../gridBattle/model/battlefieldMap";
import type { ProjectMapSummary, UnreadableProjectMap } from "./localMapServer";

const MAP_API_PATH = "/api/project-maps";

interface ProjectMapListResponse {
  maps: ProjectMapSummary[];
  unreadable: UnreadableProjectMap[];
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

/** The chosen name belongs to a different saved map; replacing it needs the author's say-so. */
export class ProjectMapConflictError extends Error {
  constructor(readonly fileName: string, message: string) {
    super(message);
    this.name = "ProjectMapConflictError";
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("Project map storage is unavailable in this static build.");
  }
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Map request failed (${response.status}).`);
  return value;
}

/** Describes the saved maps folder, naming any file that exists but cannot be used. */
export function savedMapsStatus(maps: readonly unknown[], unreadable: readonly UnreadableProjectMap[]): string {
  const available = maps.length === 0
    ? "No saved maps yet. Create one in the map editor, then choose Save to project."
    : `${maps.length} saved ${maps.length === 1 ? "map" : "maps"} available.`;
  if (unreadable.length === 0) return available;
  const details = unreadable.map((file) => `${file.fileName}: ${file.reason}`).join("; ");
  return `${available} Could not read ${unreadable.length} ${unreadable.length === 1 ? "file" : "files"} in public/maps. ${details}.`;
}

export async function listProjectMaps(): Promise<ProjectMapListResponse> {
  const response = await fetch(MAP_API_PATH, { headers: { Accept: "application/json" } });
  return responseJson<ProjectMapListResponse>(response);
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
  overwrite = false,
): Promise<ProjectMapSaveResponse> {
  const fileName = projectMapFileName(name);
  const query = overwrite ? "?overwrite=true" : "";
  const response = await fetch(`${MAP_API_PATH}/${encodeURIComponent(fileName)}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(serializeBattlefieldMap(map)),
  });
  if (response.status === 409) {
    const { error } = await response.json() as { error?: string };
    throw new ProjectMapConflictError(fileName, error ?? `A saved map named ${fileName} already exists.`);
  }
  return responseJson<ProjectMapSaveResponse>(response);
}
