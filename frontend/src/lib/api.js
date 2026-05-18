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
  create: (data, currentUserId) => api.post('/departments', data, {
    params: { current_user_id: currentUserId || undefined }
  }),
  update: (id, data, currentUserId) => api.put(`/departments/${id}`, data, {
    params: { current_user_id: currentUserId || undefined }
  }),
  delete: (id, currentUserId) => api.delete(`/departments/${id}`, {
    params: { current_user_id: currentUserId || undefined }
  }),
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
  list: (stationIdOrParams) => {
    const params = typeof stationIdOrParams === 'string'
      ? { station_id: stationIdOrParams }
      : stationIdOrParams;
    return api.get('/locations', { params });
  },
  create: (data) => api.post('/locations', data),
  update: (id, data) => api.put(`/locations/${id}`, data),
  delete: (id) => api.delete(`/locations/${id}`),
};

// Sub-Zones (clusters of identical grouped assets within a location)
export const subZonesAPI = {
  list: (params) => api.get('/sub-zones', { params }),
  create: (data) => api.post('/sub-zones', data),
  update: (id, data) => api.put(`/sub-zones/${id}`, data),
  delete: (id, force = false) => api.delete(`/sub-zones/${id}`, { params: { force } }),
  reorder: (locationId, orderedIds) =>
    api.patch('/sub-zones/reorder', { location_id: locationId, ordered_ids: orderedIds }),
};

// Canvas Landmarks (P.No reference markers on Platform Blueprint)
export const canvasLandmarksAPI = {
  list: (params) => api.get('/canvas-landmarks', { params }),
  create: (data) => api.post('/canvas-landmarks', data),
  update: (id, data) => api.put(`/canvas-landmarks/${id}`, data),
  delete: (id) => api.delete(`/canvas-landmarks/${id}`),
};

// Station Canvas (aggregated blueprint data)
export const stationCanvasAPI = {
  get: (params) => api.get('/station-canvas', { params }),
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
  listPaginated: (options = {}) => {
    const params = {
      paginated: true,
      page: options.page || 1,
      page_size: options.pageSize || 50,
    };
    if (options.search) params.search = options.search;
    if (options.station_id) params.station_id = options.station_id;
    if (options.asset_type_id) params.asset_type_id = options.asset_type_id;
    if (options.location_id) params.location_id = options.location_id;
    if (options.sub_zone_id) params.sub_zone_id = options.sub_zone_id;
    if (options.status) params.status = options.status;
    if (options.department_id) params.department_id = options.department_id;
    if (options.assigned_supervisor_id) params.assigned_supervisor_id = options.assigned_supervisor_id;
    return api.get('/assets', { params });
  },
  get: (id) => api.get(`/assets/${id}`),
  create: (data) => api.post('/assets', data),
  autoCreate: (data) => api.post('/assets/auto-create', data),
  previewCode: (data) => api.post('/assets/preview-code', data),
  update: (id, data) => api.put(`/assets/${id}`, data),
  delete: (id) => api.delete(`/assets/${id}`),
  patchStatus: (id, status) => api.patch(`/assets/${id}/status`, { status }),
  inspections: (id, limit) => api.get(`/assets/${id}/inspections`, { params: { limit } }),
  markDefective: (id, data) => api.post(`/assets/${id}/mark-defective`, data),
  bulkAssignSubZone: (assetIds, subZoneId) =>
    api.patch('/assets/bulk/sub-zone', { asset_ids: assetIds, sub_zone_id: subZoneId || null }),
  bulkUpdateCanvasPositions: (positions) =>
    api.patch('/assets/bulk/canvas', { positions }),
  updateCanvasPosition: (assetId, canvasX, canvasY) =>
    api.patch(`/assets/${assetId}/canvas`, { canvas_x: canvasX, canvas_y: canvasY }),
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
  listPaginated: (options = {}) => {
    const params = {
      paginated: true,
      page: options.page || 1,
      page_size: options.pageSize || 25,
    };
    if (options.station_id) params.station_id = options.station_id;
    if (options.inspector_id) params.inspector_id = options.inspector_id;
    if (options.inspection_type) params.inspection_type = options.inspection_type;
    if (options.for_user_id) params.for_user_id = options.for_user_id;
    return api.get('/inspections', { params });
  },
  get: (id) => api.get(`/inspections/${id}`),
  create: (data) => api.post('/inspections', data),
};

// Orange List
export const orangeListAPI = {
  list: (params) => api.get('/orange-list', { params }),
  listPaginated: (options = {}) => {
    const params = {
      paginated: true,
      page: options.page || 1,
      page_size: options.pageSize || 25,
    };
    if (options.list_type) params.list_type = options.list_type;
    if (options.for_user_id) params.for_user_id = options.for_user_id;
    if (options.station_id) params.station_id = options.station_id;
    if (options.department_id) params.department_id = options.department_id;
    return api.get('/orange-list', { params });
  },
  markWorking: (id, data) => api.post(`/orange-list/${id}/mark-working`, data),
  approve: (id, data) => api.post(`/orange-list/${id}/approve`, data),
  rejectWorking: (id, data) => api.post(`/orange-list/${id}/reject-working`, data),
};

// Remarks (Phase 5 — threaded log)
export const remarksAPI = {
  listTags: (includeArchived = false) =>
    api.get('/remarks/tags', { params: { include_archived: includeArchived } }),
  createTag: (data, currentUserId) =>
    api.post('/remarks/tags', data, { params: { current_user_id: currentUserId } }),
  updateTag: (id, data, currentUserId) =>
    api.put(`/remarks/tags/${id}`, data, { params: { current_user_id: currentUserId } }),
  deleteTag: (id, currentUserId) =>
    api.delete(`/remarks/tags/${id}`, { params: { current_user_id: currentUserId } }),
  listThread: (orangeListId) =>
    api.get(`/orange-list/${orangeListId}/remarks`),
  postRemark: (orangeListId, data, currentUserId) =>
    api.post(`/orange-list/${orangeListId}/remarks`, data, {
      params: { current_user_id: currentUserId },
    }),
};

// Notifications
export const notificationsAPI = {
  list: (userId, unreadOnly) => api.get('/notifications', { params: { user_id: userId, unread_only: unreadOnly } }),
  // Paginated list for the full Notifications page
  listPaginated: (userId, options = {}) => {
    const params = {
      user_id: userId,
      paginated: true,
      page: options.page || 1,
      page_size: options.pageSize || 20,
    };
    if (options.unreadOnly) params.unread_only = true;
    if (options.search) params.search = options.search;
    if (options.notificationType) params.notification_type = options.notificationType;
    if (options.fromDate) params.from_date = options.fromDate;
    if (options.toDate) params.to_date = options.toDate;
    return api.get('/notifications', { params });
  },
  markRead: (id) => api.post(`/notifications/${id}/read`),
  markUnread: (id) => api.post(`/notifications/${id}/unread`),
  delete: (id) => api.delete(`/notifications/${id}`),
  deleteRead: (userId) => api.post(`/notifications/delete-read?user_id=${userId}`),
  markAllRead: (userId) => api.post(`/notifications/mark-all-read?user_id=${userId}`),
  unreadCount: (userId) => api.get(`/notifications/unread-count?user_id=${userId}`),
};

// Dashboard / Analytics
export const analyticsAPI = {
  supervisor: (userId) => api.get(`/analytics/supervisor/${userId}`),
  supervisorPerformance: (userId, params = {}) => {
    const p = new URLSearchParams();
    if (params.fromDate) p.set('from_date', params.fromDate);
    if (params.toDate) p.set('to_date', params.toDate);
    if (params.stationId) p.set('station_id', params.stationId);
    if (params.locationId) p.set('location_id', params.locationId);
    return api.get(`/analytics/supervisor/${userId}/performance?${p.toString()}`);
  },
  asupPerformanceSummary: (userId, params = {}) => {
    const p = new URLSearchParams();
    if (params.fromDate) p.set('from_date', params.fromDate);
    if (params.toDate) p.set('to_date', params.toDate);
    return api.get(`/analytics/approving-supervisor/${userId}/performance-summary?${p.toString()}`);
  },
  roPerformanceSummary: (userId, params = {}) => {
    const p = new URLSearchParams();
    if (params.fromDate) p.set('from_date', params.fromDate);
    if (params.toDate) p.set('to_date', params.toDate);
    return api.get(`/analytics/reporting-officer/${userId}/performance-summary?${p.toString()}`);
  },
  approvingSupervisorList: (userId) => api.get(`/analytics/approving-supervisor/${userId}/supervisors`),
  asset: (assetId) => api.get(`/analytics/asset/${assetId}`),
  adminRollup: (params = {}) => {
    const p = new URLSearchParams();
    if (params.fromDate) p.set('from_date', params.fromDate);
    if (params.toDate) p.set('to_date', params.toDate);
    if (params.currentUserId) p.set('current_user_id', params.currentUserId);
    return api.get(`/analytics/admin/rollup?${p.toString()}`);
  },
  adminCoverageGaps: (currentUserId) =>
    api.get('/analytics/admin/coverage-gaps', {
      params: currentUserId ? { current_user_id: currentUserId } : {},
    }),
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
  assignAssetsBulk: (assetIds, toSupervisorId, performedBy) => api.post('/admin/assets/assign-bulk', {
    asset_ids: assetIds,
    to_supervisor_id: toSupervisorId || null,
    performed_by: performedBy || null,
  }),
};

// Dashboard
export const dashboardAPI = {
  superadmin: () => api.get('/dashboard'),
  superadminFull: (filters) => {
    const p = new URLSearchParams();
    (filters?.station_ids || []).forEach((v) => p.append('station_ids', v));
    const qs = p.toString();
    return api.get(`/dashboard/superadmin${qs ? `?${qs}` : ''}`);
  },
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

// Profiles
export const profilesAPI = {
  get: (userId, params = {}) => {
    const p = new URLSearchParams();
    if (params.dept_id) p.set('dept_id', params.dept_id);
    if (params.station_id) p.set('station_id', params.station_id);
    return api.get(`/profiles/${userId}?${p.toString()}`);
  },
};

// Zones
const _uid = () => { try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u._id || u.id || ''; } catch { return ''; } };

export const zonesAPI = {
  list: () => api.get('/zones'),
  create: (data) => api.post(`/zones?current_user_id=${_uid()}`, data),
  update: (id, data) => api.put(`/zones/${id}?current_user_id=${_uid()}`, data),
  delete: (id) => api.delete(`/zones/${id}?current_user_id=${_uid()}`),
};

// Inspection Compliance
export const complianceAPI = {
  supervisorActivity: (userId, params = {}) => api.get(`/inspection-compliance/supervisor-activity/${userId}`, { params }),
  missingHeatmap: (userId) => api.get(`/inspection-compliance/missing-heatmap/${userId}`),
  sigHistory: (userId, params = {}) => api.get(`/inspection-compliance/sig-history/${userId}`, { params }),
  exportSigPdf: (inspectionId) => api.post(`/inspection-compliance/sig/${inspectionId}/export/pdf`, {}, { responseType: 'blob' }),
  getThreshold: () => api.get('/settings/compliance-threshold'),
  updateThreshold: (data) => api.put('/settings/compliance-threshold', data),
};

// Divisions
export const divisionsAPI = {
  list: () => api.get('/divisions'),
  get: (id) => api.get(`/divisions/${id}`),
  create: (data) => api.post(`/divisions?current_user_id=${_uid()}`, data),
  update: (id, data) => api.put(`/divisions/${id}?current_user_id=${_uid()}`, data),
  delete: (id) => api.delete(`/divisions/${id}?current_user_id=${_uid()}`),
  getStations: (id) => api.get(`/divisions/${id}/stations`),
  assignStations: (id, station_ids) =>
    api.post(`/divisions/${id}/assign-stations?current_user_id=${_uid()}`, station_ids),
};
