import type { Response } from 'express';
import { SquadrulesError } from '../types/index.js';

function resolveHttpStatus(error: unknown): number {
  if (error instanceof SquadrulesError) {
    return error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
  }

  const maybeError = error as { status?: number; statusCode?: number };
  const status =
    typeof maybeError?.statusCode === 'number'
      ? maybeError.statusCode
      : typeof maybeError?.status === 'number'
        ? maybeError.status
        : 500;

  return status >= 400 && status < 600 ? status : 500;
}

export function sendToolRouteError(
  res: Response,
  error: unknown,
  fallbackErrorCode: string
): void {
  const status = resolveHttpStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  const payload: Record<string, unknown> = {
    error: error instanceof SquadrulesError ? error.code : status === 404 ? 'NOT_FOUND' : fallbackErrorCode,
    message
  };

  if (error instanceof SquadrulesError && error.details && typeof error.details === 'object') {
    Object.assign(payload, error.details);
  }

  res.status(status).json(payload);
}
