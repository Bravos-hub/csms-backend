export type PaginationOptions = {
  limit: number;
  offset: number;
};

const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_LIMIT = 100;

export function parsePaginationOptions(
  input: { limit?: unknown; offset?: unknown },
  defaults: { limit?: number; maxLimit?: number } = {},
): PaginationOptions {
  const maxLimit = defaults.maxLimit ?? DEFAULT_MAX_LIMIT;
  const fallbackLimit = defaults.limit ?? DEFAULT_LIMIT;

  const parsedLimit = toPositiveInt(input.limit);
  const parsedOffset = toNonNegativeInt(input.offset);

  const limit = Math.min(parsedLimit ?? fallbackLimit, maxLimit);
  const offset = parsedOffset ?? 0;

  return { limit, offset };
}

function toPositiveInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  if (normalized <= 0) return undefined;
  return normalized;
}

function toNonNegativeInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  if (normalized < 0) return undefined;
  return normalized;
}
