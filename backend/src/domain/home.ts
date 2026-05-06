import type { HomeId } from "./ids.ts";

export interface Home {
  id: HomeId;
  displayName: string;
  login: string | null;
  pinSalt: string | null;
  pinHash: string | null;
  tz: string;
  avatarId: string | null;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
}
