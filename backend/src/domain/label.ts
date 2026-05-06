import type { HomeId, LabelId } from "./ids.ts";

export interface Label {
  id: LabelId;
  homeId: HomeId;
  displayName: string;
  color: string | null;
  system: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
}
