import { useEffect } from 'react';
import { useAuthStore } from '../store/authSlice';

export function useAuth() {
  const {
    user,
    organization,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    checkAuth,
  } = useAuthStore();
  useEffect(() => {
    checkAuth();
  }, []);

  return {
    user,
    organization,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
  };
}

// Helper hook to require authentication
export function useRequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  // Just returns the state

  return { isAuthenticated, isLoading };
}

// Check if user has specific role
export function useHasRole(roles: string[]) {
  const { user } = useAuthStore();

  if (!user) return false;

  return roles.includes(user.role);
}

// Check if user can perform action
export function useCanPerform(action: string) {
  const { user } = useAuthStore();

  if (!user) return false;
  const permissions: Record<string, string[]> = {
    owner: ['*'],
    admin: ['manage_users', 'manage_dashboards', 'view_billing', 'manage_settings'],
    member: ['view_dashboards', 'edit_dashboards', 'view_analytics'],
    viewer: ['view_dashboards', 'view_analytics'],
  };

  const userPermissions = permissions[user.role] || [];

  if (userPermissions.includes('*')) return true;

  return userPermissions.includes(action);
}
