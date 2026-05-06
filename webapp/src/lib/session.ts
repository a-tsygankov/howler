// Session token + minimal home/user identity. localStorage so the
// value survives reloads and PWA installs. The Worker also sets an
// HttpOnly cookie on every auth response — the localStorage copy
// is only for the SPA's own UI checks.

const TOKEN_KEY = "howler.token";
const SESSION_KEY = "howler.session";

export interface SessionInfo {
  token: string;
  homeId: string;
  userId: string;
  homeDisplayName?: string | null;
  userDisplayName?: string | null;
}

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const getSession = (): SessionInfo | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
};

export const setSession = (s: SessionInfo): void => {
  localStorage.setItem(TOKEN_KEY, s.token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
};

export const clearSession = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
};
