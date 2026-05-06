import type { HomeId, TaskResultId } from "./ids.ts";

export interface TaskResult {
  id: TaskResultId;
  homeId: HomeId;
  displayName: string;
  unitName: string;
  minValue: number | null;
  maxValue: number | null;
  step: number;
  defaultValue: number | null;
  useLastValue: boolean;
  system: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
}
