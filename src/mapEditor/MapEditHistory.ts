import {
  createBattlefieldMap,
  serializeBattlefieldMap,
  type BattlefieldMap,
  type BattlefieldMapDocument,
} from "../gridBattle/model/battlefieldMap";

const DEFAULT_HISTORY_LIMIT = 100;

/** Undo and redo as whole-map snapshots: one entry per paint stroke or erase. */
export class MapEditHistory {
  private readonly undoStack: BattlefieldMapDocument[] = [];
  private readonly redoStack: BattlefieldMapDocument[] = [];

  constructor(private readonly limit = DEFAULT_HISTORY_LIMIT) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(before: BattlefieldMapDocument): void {
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(current: BattlefieldMap): BattlefieldMap | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(serializeBattlefieldMap(current));
    return createBattlefieldMap(previous);
  }

  redo(current: BattlefieldMap): BattlefieldMap | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(serializeBattlefieldMap(current));
    return createBattlefieldMap(next);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
