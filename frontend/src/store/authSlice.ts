import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  tier: string;
}

interface AuthState {
  user: User | null;
  organization: Organization | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setOrganization: (org: Organization | null) => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  organization: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // send the cookie to the server
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }
      localStorage.setItem('user', JSON.stringify(data.user));

      set({
        user: data.user,
        organization: data.user.organization,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error: any) {
      set({
        error: error.message,
        isLoading: false,
        isAuthenticated: false,
      });
      throw error;
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.log('Logout request failed:', error);
    }

    localStorage.removeItem('user');

    set({
      user: null,
      organization: null,
      isAuthenticated: false,
    });
  },

  setUser: (user) => {
    set({ user });
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    }
  },

  setOrganization: (organization) => {
    set({ organization });
  },

  checkAuth: async () => {
    set({ isLoading: true });

    try {
      const response = await fetch('/api/auth/verify', {
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok && data.valid) {
        const storedUser = localStorage.getItem('user');
        const user = storedUser ? JSON.parse(storedUser) : data.user;

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        localStorage.removeItem('user');
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    } catch (error) {
      console.log('Auth check failed:', error);
      set({ isAuthenticated: false, isLoading: false });
    }
  },
}));
