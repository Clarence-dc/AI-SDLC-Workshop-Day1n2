export function isAllowedMutationOrigin(request: Request): boolean {
  const expectedOrigin = process.env.RP_ORIGIN ?? new URL(request.url).origin;
  return request.headers.get("origin") === expectedOrigin;
}
