import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
  timeout: 30000,
});

// Response interceptor: handle auth expiry globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Redirect to login if session expired
      const currentPath = window.location.pathname;
      if (currentPath !== '/' && currentPath !== '/gdpr-consent') {
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  },
);

export default api;

// ─── Typed API helpers ────────────────────────────────────────────────────────

export const authApi = {
  me:          () => api.get('/auth/me'),
  logout:      () => api.post('/auth/logout'),
  gdprConsent: () => api.post('/auth/gdpr-consent'),
};

export const searchApi = {
  execute:   (params: object) => api.post('/api/search', params),
  status:    (jobId: string)  => api.get(`/api/search/status/${jobId}`),
  results:   (jobId: string)  => api.get(`/api/search/results/${jobId}`),
  rateLimit: ()               => api.get('/api/search/rate-limit'),
};

export const savedSearchApi = {
  list:      ()                         => api.get('/api/saved-searches'),
  create:    (data: object)             => api.post('/api/saved-searches', data),
  update:    (id: string, data: object) => api.put(`/api/saved-searches/${id}`, data),
  delete:    (id: string)               => api.delete(`/api/saved-searches/${id}`),
  run:       (id: string)               => api.post(`/api/saved-searches/${id}/run`),
  templates: ()                         => api.get('/api/saved-searches/templates'),
};

export const historyApi = {
  list:     () => api.get('/api/history'),
  delete:   (id: string) => api.delete(`/api/history/${id}`),
  clearAll: () => api.delete('/api/history'),
};

export const gdprApi = {
  export:    () => api.get('/api/gdpr/export', { responseType: 'blob' }),
  deleteMe:  () => api.delete('/api/gdpr/me'),
  auditLog:  () => api.get('/api/gdpr/audit'),
};
