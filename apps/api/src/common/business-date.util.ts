/**
 * Business-day helper for República Dominicana (America/Santo_Domingo,
 * fixed UTC-4, no DST). Returns the RD calendar date as a UTC-midnight Date,
 * which maps 1:1 onto Prisma's `@db.Date` columns.
 */
export function rdBusinessDate(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
}
