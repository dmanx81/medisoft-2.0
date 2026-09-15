export function sessionCookieOptions(secure: boolean, maxAge: number) {
  return {
    httpOnly: true as const,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

export function productionHttpsOrigin(origin: string | undefined) {
  return (
    process.env.NODE_ENV === 'production' &&
    typeof origin === 'string' &&
    origin.startsWith('https://')
  );
}
