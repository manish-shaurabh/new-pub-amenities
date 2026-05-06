import axios from 'axios';

const API_BASE = process.env.REACT_APP_BACKEND_URL || '';

const api = axios.create({
  baseURL: `${API_BASE}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// Auth
export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  me: (token) => api.get(`/auth/me?token=${token}`),
};

// Departments
export const departmentsAPI = {
  list: () => api.get('/departments'),
  create: (data) => api.post('/departments', data),
  update: (id, data) => api.put(`/departments/${id}`, data),
  delete: (id) => api.delete(`/departments/${id}`),
};

// Stations
export const stationsAPI = {
  list: () => api.get('/stations'),
  create: (data) => api.post('/stations', data),
  update: (id, data) => api.put(`/stations/${id}`, data),
  delete: (id) => api.delete(`/stations/${id}`),
};

// Locations
export const locationsAPI = {
  list: (stationId) => api.get('/locations', { params: { station_id: stationId } }),
  create: (data) => api.post('/locations', data),
  update: (id, data) => api.put(`/locations/${id}`, data),
  delete: (id) => api.delete(`/locations/${id}`),
};

// Asset Types
export const assetTypesAPI = {
  list: (departmentId) => api.get('/asset-types', { params: { department_id: departmentId } }),
  create: (data) => api.post('/asset-types', data),
  update: (id, data) => api.put(`/asset-types/${id}`, data),
  delete: (id) => api.delete(`/asset-types/${id}`),
};

// Assets
export const assetsAPI = {
  list: (params) => api.get('/assets', { params }),
  get: (id) => api.get(`/assets/${id}`),
  create: (data) => api.post('/assets', data),
  update: (id, data) => api.put(`/assets/${id}`, data),
  delete: (id) => api.delete(`/assets/${id}`),
  inspections: (id, limit) => api.get(`/assets/${id}/inspections`, { params: { limit } }),
};

// Users
export const usersAPI = {
  list: (params) => api.get('/users', { params }),
  get: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  grantAdmin: (userId, grantedBy) => api.post(`/users/${userId}/grant-admin?granted_by=${grantedBy}`),
  revokeAdmin: (userId, revokedBy, newRole) => api.post(`/users/${userId}/revoke-admin?revoked_by=${revokedBy}&new_role=${newRole}`),
  supervisors: (params) => api.get('/users/supervisors', { params }),
  inspections: (id, limit) => api.get(`/users/${id}/inspections`, { params: { limit } }),
  linkSupervisors: (reportingOfficerId, supervisorIds) => api.post('/users/link-supervisors', {
    reporting_officer_id: reportingOfficerId,
    supervisor_ids: supervisorIds
  }),
  stationStaff: () => api.get('/users/station-staff'),
};

// Inspections
export const inspectionsAPI = {
  list: (params) => api.get('/inspections', { params }),
  get: (id) => api.get(`/inspections/${id}`),
  create: (data) => api.post('/inspections', data),
};

// Orange List
export const orangeListAPI = {
  list: (params) => api.get('/orange-list', { params }),
  markWorking: (id, data) => api.post(`/orange-list/${id}/mark-working`, data),
  approve: (id, data) => api.post(`/orange-list/${id}/approve`, data),
};

// Notifications
export const notificationsAPI = {
  list: (userId, unreadOnly) => api.get('/notifications', { params: { user_id: userId, unread_only: unreadOnly } }),
  markRead: (id) => api.post(`/notifications/${id}/read`),
  markAllRead: (userId) => api.post(`/notifications/mark-all-read?user_id=${userId}`),
  unreadCount: (userId) => api.get(`/notifications/unread-count?user_id=${userId}`),
};

// Dashboard / Analytics
export const analyticsAPI = {
  supervisor: (userId) => api.get(`/analytics/supervisor/${userId}`),
  approvingSupervisorList: (userId) => api.get(`/analytics/approving-supervisor/${userId}/supervisors`),
  asset: (assetId) => api.get(`/analytics/asset/${assetId}`),
};

export const approvalsAPI = {
  pending: (reviewerId) => api.get('/inspections/pending-approvals', { params: { reviewer_id: reviewerId } }),
  approve: (inspectionId, itemIndex, reviewerId, remarks) =>
    api.post(`/inspections/${inspectionId}/items/${itemIndex}/approve`, { reviewer_id: reviewerId, remarks }),
  reject: (inspectionId, itemIndex, reviewerId, remarks) =>
    api.post(`/inspections/${inspectionId}/items/${itemIndex}/reject`, { reviewer_id: reviewerId, remarks }),
};

// Schedules
export const schedulesAPI = {
  list: (overdueOnly) => api.get('/schedules', { params: { overdue_only: overdueOnly } }),
  dueToday: (userId) => api.get('/schedules/due-today', { params: { user_id: userId } }),
  create: (data) => api.post('/schedules', data),
  forSupervisor: (userId, fromDate, toDate) => api.get(`/schedules/supervisor/${userId}`, {
    params: { from_date: fromDate, to_date: toDate }
  }),
  supervisorsUnderApproving: (userId) => api.get(`/schedules/approving-supervisor/${userId}/supervisors`),
  admin: (filters) => {
    // filters: { station_ids: [], department_ids: [], asset_type_ids: [], supervisor_ids: [], reporting_officer_ids: [], from_date, to_date }
    const p = new URLSearchParams();
    (filters.station_ids || []).forEach((v) => p.append('station_ids', v));
    (filters.department_ids || []).forEach((v) => p.append('department_ids', v));
    (filters.asset_type_ids || []).forEach((v) => p.append('asset_type_ids', v));
    (filters.supervisor_ids || []).forEach((v) => p.append('supervisor_ids', v));
    (filters.reporting_officer_ids || []).forEach((v) => p.append('reporting_officer_ids', v));
    if (filters.from_date) p.append('from_date', filters.from_date);
    if (filters.to_date) p.append('to_date', filters.to_date);
    return api.get(`/schedules/admin?${p.toString()}`);
  },
};

// Admin
export const adminAPI = {
  transferSupervisor: (fromSupervisorId, toSupervisorId) => api.post('/admin/transfer-supervisor', {
    from_supervisor_id: fromSupervisorId,
    to_supervisor_id: toSupervisorId,
  }),
};

// Dashboard
export const dashboardAPI = {
  superadmin: () => api.get('/dashboard'),
  superadminFull: () => api.get('/dashboard/superadmin'),
  stats: () => api.get('/dashboard/stats'),
  recentInspections: (limit) => api.get('/dashboard/recent-inspections', { params: { limit } }),
  supervisor: (userId, stationId) => api.get(`/dashboard/supervisor/${userId}`, {
    params: stationId ? { station_id: stationId } : {}
  }),
  supervisorMyTasks: (userId, stationId) => api.get(`/dashboard/supervisor/${userId}/my-tasks`, {
    params: stationId ? { station_id: stationId } : {}
  }),
  approvingSupervisor: (userId, params) => api.get(`/dashboard/approving-supervisor/${userId}`, {
    params: params || {}
  }),
  reportingOfficer: (userId, params) => api.get(`/dashboard/reporting-officer/${userId}`, {
    params: params || {}
  }),
  oversightCategoryAssets: (userId, params) => api.get(`/dashboard/oversight/${userId}/category-assets`, {
    params: params || {}
  }),
  admin: (filters) => {
    const p = new URLSearchParams();
    (filters?.station_ids || []).forEach((v) => p.append('station_ids', v));
    (filters?.department_ids || []).forEach((v) => p.append('department_ids', v));
    (filters?.reporting_officer_ids || []).forEach((v) => p.append('reporting_officer_ids', v));
    return api.get(`/dashboard/admin?${p.toString()}`);
  },
};

// Upload
export const uploadAPI = {
  single: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  multiple: (files) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    return api.post('/upload/multiple', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
