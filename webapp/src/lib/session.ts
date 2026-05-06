// Session token store + auth state. localStorage so the value
// survives page reloads and PWA reinstalls. The HttpOnly cookie set
// by the Worker is the canonical credential for subsequent calls;
// we keep the token in localStorage too so we can show "logged in"
// state in the UI without a round-trip on every render.

const TOKEN_KEY = "howler.token";
const USER_KEY = "howler.user";

export interface SessionUser {
  userId: string;
  username: string | null;
  displayName?: string | null;
}

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const getUser = (): SessionUser | null => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
};

export const setSession = (token: string, user: SessionUser): void => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearSession = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};
