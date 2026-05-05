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
  delete: (id) => api.delete(`/locations/${id}`),
};

// Asset Types
export const assetTypesAPI = {
  list: (departmentId) => api.get('/asset-types', { params: { department_id: departmentId } }),
  create: (data) => api.post('/asset-types', data),
  delete: (id) => api.delete(`/asset-types/${id}`),
};

// Assets
export const assetsAPI = {
  list: (params) => api.get('/assets', { params }),
  get: (id) => api.get(`/assets/${id}`),
  create: (data) => api.post('/assets', data),
  update: (id, data) => api.put(`/assets/${id}`, data),
  delete: (id) => api.delete(`/assets/${id}`),
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

// Schedules
export const schedulesAPI = {
  list: (overdueOnly) => api.get('/schedules', { params: { overdue_only: overdueOnly } }),
  dueToday: (userId) => api.get('/schedules/due-today', { params: { user_id: userId } }),
  create: (data) => api.post('/schedules', data),
};

// Dashboard
export const dashboardAPI = {
  stats: () => api.get('/dashboard/stats'),
  recentInspections: (limit) => api.get('/dashboard/recent-inspections', { params: { limit } }),
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
