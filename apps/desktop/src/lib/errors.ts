import {
  ClawApiError,
  formatClawApiError,
  type ClawApiErrorFormatOptions,
} from "@aurax/claw-sdk";

export function errorText(
  error: unknown,
  options: ClawApiErrorFormatOptions = {},
): string {
  if (error instanceof ClawApiError) {
    return formatClawApiError(error, options);
  }
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return "无法连接 AuraClaw（Failed to fetch）。DEV_WEB（:1420）请在「连接」留空 URL 走同源反代；跨域直连需在 AuraClaw 配置 CORS。";
  }
  return error instanceof Error ? error.message : "未知错误";
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ClawApiError && error.status === 404;
}
