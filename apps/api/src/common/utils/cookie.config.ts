export const COOKIE_NAMES = {
  ACCESS_TOKEN: 'evzone_access_token',
  REFRESH_TOKEN: 'evzone_refresh_token',
} as const;

export const getCookieOptions = (
  isRefreshToken = false,
): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  maxAge: number;
  path: string;
} => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true, // Prevent JavaScript access (XSS protection)
    secure: isProduction, // HTTPS only in production
    sameSite: isProduction ? 'strict' : 'lax', // CSRF protection
    maxAge: isRefreshToken
      ? 7 * 24 * 60 * 60 * 1000 // 7 days for refresh token
      : 15 * 60 * 1000, // 15 minutes for access token
    path: '/',
  };
};
