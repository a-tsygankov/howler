import type { HomeId, UserId } from "./ids.ts";

export interface User {
  id: UserId;
  homeId: HomeId;
  displayName: string;
  login: string | null;
  pinSalt: string | null;
  pinHash: string | null;
  avatarId: string | null;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
}
