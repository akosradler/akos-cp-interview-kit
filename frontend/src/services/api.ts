import axios, { AxiosError } from 'axios';


export const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  // send the cookie to the server
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    console.error('API Error:', error.response?.data || error.message);

    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('user');
      window.location.assign('/login');
    }

    return Promise.reject(error);
  }
);

export async function fetchDashboards() {
  const response = await api.get('/dashboards');
  return response.data;
}

export async function fetchDashboard(id: string) {
  const response = await api.get(`/dashboards/${id}`);
  return response.data;
}

export async function createDashboard(data: { name: string; description?: string }) {
  const response = await api.post('/dashboards', data);
  return response.data;
}

export async function updateDashboard(id: string, data: any) {
  const response = await api.put(`/dashboards/${id}`, data);
  return response.data;
}

export async function deleteDashboard(id: string) {
  await api.delete(`/dashboards/${id}`);
}

// Widget operations
export async function createWidget(dashboardId: string, data: any) {
  const response = await api.post(`/dashboards/${dashboardId}/widgets`, data);
  return response.data;
}

export async function updateWidget(dashboardId: string, widgetId: string, data: any) {
  const response = await api.put(`/dashboards/${dashboardId}/widgets/${widgetId}`, data);
  return response.data;
}

export async function deleteWidget(dashboardId: string, widgetId: string) {
  await api.delete(`/dashboards/${dashboardId}/widgets/${widgetId}`);
}

export async function fetchWidgetData(dashboardId: string, widgetId: string) {
  const response = await api.get(`/dashboards/${dashboardId}/widgets/${widgetId}/data`);
  return response.data;
}

// Analytics operations
export async function trackEvent(eventType: string, eventName: string, properties?: any) {
  api.post('/analytics/track', { eventType, eventName, properties });
}

export async function fetchAnalyticsStats(period: string) {
  const response = await api.get(`/analytics/stats?period=${period}`);
  return response.data;
}

export async function exportAnalytics(startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);

  const response = await api.get(`/analytics/export?${params.toString()}`, {
    responseType: 'blob'
  });
  return response.data;
}

// User operations
export async function fetchCurrentUser() {
  const response = await api.get('/users/me');
  return response.data;
}

export async function updateUser(data: any) {
  const response = await api.put('/users/me', data);
  return response.data;
}

// Organization operations
export async function fetchOrganization() {
  const response = await api.get('/organizations/current');
  return response.data;
}

export async function fetchTeamMembers() {
  const response = await api.get('/organizations/members');
  return response.data;
}

export async function inviteMember(data: { email: string; name: string; role?: string }) {
  const response = await api.post('/organizations/invite', data);
  return response.data;
}

// Billing operations
export async function fetchBillingOverview() {
  const response = await api.get('/billing/overview');
  return response.data;
}

export async function fetchInvoices() {
  const response = await api.get('/billing/invoices');
  return response.data;
}

// Notifications
export async function fetchNotifications(unreadOnly = false) {
  const response = await api.get(`/notifications?unreadOnly=${unreadOnly}`);
  return response.data;
}

export async function markNotificationRead(id: string) {
  const response = await api.put(`/notifications/${id}/read`);
  return response.data;
}

// Audit logs
export async function fetchAuditLogs(filters?: any) {
  const params = new URLSearchParams(filters);
  const response = await api.get(`/audit?${params.toString()}`);
  return response.data;
}

// Generic fetch with error handling
export async function fetchWithErrorHandling<T>(
  request: () => Promise<T>,
  onError?: (error: any) => void
): Promise<T | null> {
  try {
    return await request();
  } catch (error) {
    if (onError) {
      onError(error);
    } else {
      console.error('Request failed:', error);
    }
    return null;
  }
}

// ==================== User Operations ====================

// Change password - Intentional flaw: doesn't require current password in UI
export async function changePassword(data: { currentPassword: string; newPassword: string }) {
  const response = await api.put('/users/me/password', data);
  return response.data;
}

// Delete account
export async function deleteAccount() {
  await api.delete('/users/me');
}

// User preferences
export async function fetchUserPreferences() {
  const response = await api.get('/users/me/preferences');
  return response.data;
}

export async function updateUserPreferences(preferences: any) {
  const response = await api.put('/users/me/preferences', preferences);
  return response.data;
}

// User sessions
export async function fetchUserSessions() {
  const response = await api.get('/users/me/sessions');
  return response.data;
}

export async function revokeSession(sessionId: string) {
  await api.delete(`/users/me/sessions/${sessionId}`);
}

export async function revokeAllSessions() {
  await api.delete('/users/me/sessions');
}

// Search users
export async function searchUsers(query: string) {
  const response = await api.get(`/users/search/${encodeURIComponent(query)}`);
  return response.data;
}

// ==================== Organization Operations ====================

// Update organization
export async function updateOrganization(data: { name?: string; slug?: string }) {
  const response = await api.put('/organizations/current', data);
  return response.data;
}

// Delete organization
export async function deleteOrganization() {
  await api.delete('/organizations/current');
}

// Organization settings
export async function fetchOrganizationSettings() {
  const response = await api.get('/organizations/settings');
  return response.data;
}

// Transfer ownership
export async function transferOwnership(userId: string) {
  const response = await api.post('/organizations/transfer-ownership', { userId });
  return response.data;
}

// Update member role
export async function updateMemberRole(memberId: string, role: string) {
  const response = await api.put(`/organizations/members/${memberId}`, { role });
  return response.data;
}

// Remove member
export async function removeMember(memberId: string) {
  await api.delete(`/organizations/members/${memberId}`);
}

// ==================== API Keys ====================

export async function fetchApiKeys() {
  const response = await api.get('/organizations/api-keys');
  return response.data;
}

export async function createApiKey(data: { name: string; expiresIn?: number }) {
  const response = await api.post('/organizations/api-keys', data);
  return response.data;
}

export async function deleteApiKey(keyId: string) {
  await api.delete(`/organizations/api-keys/${keyId}`);
}

// ==================== Webhooks ====================

export async function fetchWebhooks() {
  const response = await api.get('/webhooks');
  return response.data;
}

export async function fetchWebhook(webhookId: string) {
  const response = await api.get(`/webhooks/${webhookId}`);
  return response.data;
}

export async function createWebhook(data: { url: string; events: string[]; description?: string }) {
  const response = await api.post('/webhooks', data);
  return response.data;
}

export async function updateWebhook(webhookId: string, data: { url?: string; events?: string[]; isActive?: boolean }) {
  const response = await api.put(`/webhooks/${webhookId}`, data);
  return response.data;
}

export async function deleteWebhook(webhookId: string) {
  await api.delete(`/webhooks/${webhookId}`);
}

export async function regenerateWebhookSecret(webhookId: string) {
  const response = await api.post(`/webhooks/${webhookId}/regenerate-secret`);
  return response.data;
}

export async function testWebhook(webhookId: string) {
  const response = await api.post(`/webhooks/${webhookId}/test`);
  return response.data;
}

export async function fetchWebhookDeliveries(webhookId: string) {
  // Intentional flaw: No pagination - loads all deliveries
  const response = await api.get(`/webhooks/${webhookId}/deliveries`);
  return response.data;
}

// ==================== Audit Logs ====================

export async function fetchAuditLog(logId: string) {
  const response = await api.get(`/audit/${logId}`);
  return response.data;
}

export async function searchAuditLogs(query: string) {
  const response = await api.get(`/audit/search/${encodeURIComponent(query)}`);
  return response.data;
}

export async function fetchAuditLogsByResource(resourceType: string, resourceId: string) {
  const response = await api.get(`/audit/resource/${resourceType}/${resourceId}`);
  return response.data;
}

export async function fetchAuditLogsByUser(userId: string) {
  const response = await api.get(`/audit/user/${userId}`);
  return response.data;
}

export async function fetchAuditStats() {
  const response = await api.get('/audit/stats/summary');
  return response.data;
}

export async function exportAuditLogs(filters?: any) {
  // Intentional flaw: loads all data into memory before download
  const params = new URLSearchParams(filters);
  const response = await api.get(`/audit/export?${params.toString()}`);
  return response.data;
}

export async function cleanupAuditLogs(olderThanDays: number) {
  const response = await api.delete('/audit/cleanup', { data: { olderThanDays } });
  return response.data;
}

// ==================== Billing ====================

export async function fetchBillingUsage() {
  const response = await api.get('/billing/usage');
  return response.data;
}

export async function fetchBillingPricing() {
  const response = await api.get('/billing/pricing');
  return response.data;
}

export async function upgradePlan(tier: string) {
  const response = await api.post('/billing/upgrade', { tier });
  return response.data;
}

export async function updatePaymentMethod(paymentMethodId: string) {
  const response = await api.post('/billing/payment-method', { paymentMethodId });
  return response.data;
}

export async function setBudgetAlert(threshold: number) {
  // Intentional flaw: no validation - can set negative threshold
  const response = await api.post('/billing/budget-alert', { threshold });
  return response.data;
}

export async function fetchInvoice(invoiceId: string) {
  const response = await api.get(`/billing/invoices/${invoiceId}`);
  return response.data;
}

// ==================== Dashboard Operations ====================

export async function duplicateDashboard(dashboardId: string) {
  const response = await api.post(`/dashboards/${dashboardId}/duplicate`);
  return response.data;
}

export async function shareDashboard(dashboardId: string, settings?: { isPublic?: boolean }) {
  const response = await api.post(`/dashboards/${dashboardId}/share`, settings);
  return response.data;
}

export async function fetchSharedDashboard(shareId: string) {
  const response = await api.get(`/dashboards/shared/${shareId}`);
  return response.data;
}

export async function fetchDashboardData(dashboardId: string) {
  const response = await api.get(`/dashboards/${dashboardId}/data`);
  return response.data;
}

// ==================== Notifications ====================

export async function markAllNotificationsRead() {
  const response = await api.put('/notifications/mark-all-read');
  return response.data;
}

export async function deleteNotification(notificationId: string) {
  await api.delete(`/notifications/${notificationId}`);
}

export async function clearAllNotifications() {
  await api.delete('/notifications');
}

export async function fetchNotificationPreferences() {
  const response = await api.get('/notifications/preferences');
  return response.data;
}

export async function updateNotificationPreferences(preferences: any) {
  const response = await api.put('/notifications/preferences', preferences);
  return response.data;
}

// ==================== Comments ====================

export async function fetchComments(resourceType: string, resourceId: string) {
  const response = await api.get(`/comments/${resourceType}/${resourceId}`);
  return response.data;
}

export async function createComment(data: { resourceType: string; resourceId: string; content: string }) {
  const response = await api.post('/comments', data);
  return response.data;
}

export async function updateComment(commentId: string, content: string) {
  const response = await api.put(`/comments/${commentId}`, { content });
  return response.data;
}

export async function deleteComment(commentId: string) {
  await api.delete(`/comments/${commentId}`);
}
