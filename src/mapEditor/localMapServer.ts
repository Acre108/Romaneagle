import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  parseBattlefieldMap,
  serializeBattlefieldMap,
} from "../gridBattle/model/battlefieldMap";

const MAP_API_PATH = "/api/project-maps";
const MAXIMUM_MAP_FILE_BYTES = 2 * 1024 * 1024;

export interface ProjectMapSummary {
  fileName: string;
  name: string;
  width: number;
  height: number;
  romanFormations: number;
  saxonFormations: number;
  spawnPoints: number;
  modifiedAt: string;
}

export function isSafeProjectMapFileName(fileName: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.json$/.test(fileName);
}

function displayName(fileName: string): string {
  return fileName
    .slice(0, -extname(fileName).length)
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAXIMUM_MAP_FILE_BYTES) throw new Error("Map file exceeds the 2 MB limit.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error("Map request body is empty.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function projectMapSummaries(mapsDirectory: string): Promise<ProjectMapSummary[]> {
  await mkdir(mapsDirectory, { recursive: true });
  const entries = await readdir(mapsDirectory, { withFileTypes: true });
  const summaries = await Promise.all(entries
    .filter((entry) => entry.isFile() && isSafeProjectMapFileName(entry.name))
    .map(async (entry): Promise<ProjectMapSummary | null> => {
      const path = join(mapsDirectory, entry.name);
      try {
        const [contents, details] = await Promise.all([readFile(path, "utf8"), stat(path)]);
        const map = parseBattlefieldMap(JSON.parse(contents) as unknown);
        return {
          fileName: entry.name,
          name: displayName(entry.name),
          width: map.width,
          height: map.height,
          romanFormations: map.deployments.filter((deployment) => deployment.factionId === "roman").length,
          saxonFormations: map.deployments.filter((deployment) => deployment.factionId === "saxon").length,
          spawnPoints: map.spawnPoints.length,
          modifiedAt: details.mtime.toISOString(),
        };
      } catch {
        return null;
      }
    }));
  return summaries
    .filter((summary): summary is ProjectMapSummary => summary !== null)
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

function requestFileName(pathname: string): string | null {
  if (!pathname.startsWith(`${MAP_API_PATH}/`)) return null;
  try {
    const fileName = decodeURIComponent(pathname.slice(MAP_API_PATH.length + 1));
    return isSafeProjectMapFileName(fileName) ? fileName : null;
  } catch {
    return null;
  }
}

export function localMapStoragePlugin(mapsDirectory: string): Plugin {
  return {
    name: "local-project-map-storage",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url) {
          next();
          return;
        }
        const url = new URL(request.url, "http://local.game");
        if (url.pathname !== MAP_API_PATH && !url.pathname.startsWith(`${MAP_API_PATH}/`)) {
          next();
          return;
        }
        try {
          if (request.method === "GET" && url.pathname === MAP_API_PATH) {
            sendJson(response, 200, { maps: await projectMapSummaries(mapsDirectory) });
            return;
          }
          const fileName = requestFileName(url.pathname);
          if (!fileName) {
            sendJson(response, 400, { error: "Map filename is invalid." });
            return;
          }
          const path = join(mapsDirectory, fileName);
          if (request.method === "GET") {
            const map = parseBattlefieldMap(JSON.parse(await readFile(path, "utf8")) as unknown);
            sendJson(response, 200, serializeBattlefieldMap(map));
            return;
          }
          if (request.method === "POST") {
            const map = parseBattlefieldMap(await readRequestJson(request));
            await mkdir(mapsDirectory, { recursive: true });
            await writeFile(path, `${JSON.stringify(serializeBattlefieldMap(map), null, 2)}\n`, "utf8");
            sendJson(response, 200, { fileName, path: `public/maps/${fileName}` });
            return;
          }
          sendJson(response, 405, { error: "Method not allowed." });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Map operation failed.";
          const missing = typeof error === "object" && error !== null && "code" in error
            && error.code === "ENOENT";
          sendJson(response, missing ? 404 : 400, { error: message });
        }
      });
    },
  };
}
