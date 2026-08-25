import { ClawApiError } from "@aurax/claw-sdk";

export function errorText(error: unknown): string {
  if (error instanceof ClawApiError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "未知错误";
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ClawApiError && error.status === 404;
}
