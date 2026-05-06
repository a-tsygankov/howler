export type Brand<T, B extends string> = T & { readonly __brand: B };

export type HomeId = Brand<string, "HomeId">;
export type UserId = Brand<string, "UserId">;
export type TaskId = Brand<string, "TaskId">;
export type ScheduleId = Brand<string, "ScheduleId">;
export type OccurrenceId = Brand<string, "OccurrenceId">;
export type DeviceId = Brand<string, "DeviceId">;
export type LabelId = Brand<string, "LabelId">;
export type TaskResultId = Brand<string, "TaskResultId">;
export type TaskExecutionId = Brand<string, "TaskExecutionId">;

const HEX32 = /^[0-9a-f]{32}$/;
const isHex32 = (s: string): boolean => HEX32.test(s);

export const asHomeId = (s: string): HomeId => {
  if (!isHex32(s)) throw new Error(`invalid HomeId: ${s}`);
  return s as HomeId;
};
export const asUserId = (s: string): UserId => {
  if (!isHex32(s)) throw new Error(`invalid UserId: ${s}`);
  return s as UserId;
};
export const asLabelId = (s: string): LabelId => {
  if (!isHex32(s)) throw new Error(`invalid LabelId: ${s}`);
  return s as LabelId;
};
export const asTaskResultId = (s: string): TaskResultId => {
  if (!isHex32(s)) throw new Error(`invalid TaskResultId: ${s}`);
  return s as TaskResultId;
};
export const asTaskExecutionId = (s: string): TaskExecutionId => {
  if (!isHex32(s)) throw new Error(`invalid TaskExecutionId: ${s}`);
  return s as TaskExecutionId;
};
export const asTaskId = (s: string): TaskId => {
  if (!isHex32(s)) throw new Error(`invalid TaskId: ${s}`);
  return s as TaskId;
};
export const asScheduleId = (s: string): ScheduleId => {
  if (!isHex32(s)) throw new Error(`invalid ScheduleId: ${s}`);
  return s as ScheduleId;
};
export const asOccurrenceId = (s: string): OccurrenceId => {
  if (!isHex32(s)) throw new Error(`invalid OccurrenceId: ${s}`);
  return s as OccurrenceId;
};
export const asDeviceId = (s: string): DeviceId => {
  if (!isHex32(s)) throw new Error(`invalid DeviceId: ${s}`);
  return s as DeviceId;
};

export const newUuid = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};
