import client from './client';

const apiService = {
  // Configurations
  async getConfigs() {
    const res = await client.get('/api/forums/configs');
    return res.data;
  },

  async createConfig(configData) {
    const res = await client.post('/api/forums/configs', configData);
    return res.data;
  },

  async deleteConfig(id) {
    const res = await client.delete(`/api/forums/configs/${id}`);
    return res.data;
  },

  // Jobs
  async getJobs(page = 1, status = '') {
    const params = { page, per_page: 10 };
    if (status) params.status = status;
    const res = await client.get('/api/jobs', { params });
    return res.data;
  },

  async getJobDetails(id) {
    const res = await client.get(`/api/jobs/${id}`);
    return res.data;
  },

  async createJob(jobData) {
    const res = await client.post('/api/jobs', jobData);
    return res.data;
  },

  async cancelJob(id) {
    const res = await client.post(`/api/jobs/${id}/cancel`);
    return res.data;
  },

  async retryJob(id) {
    const res = await client.post(`/api/jobs/${id}/retry`);
    return res.data;
  },

  async deleteJob(id) {
    const res = await client.delete(`/api/jobs/${id}`);
    return res.data;
  },

  async getSubJobs(parentId) {
    const res = await client.get(`/api/jobs/${parentId}/sub-jobs`);
    return res.data;
  },

  async getJobQueue() {
    const res = await client.get('/api/jobs/queue/status');
    return res.data;
  },

  async pauseScheduler() {
    const res = await client.post('/api/jobs/scheduler/pause');
    return res.data;
  },

  async resumeScheduler() {
    const res = await client.post('/api/jobs/scheduler/resume');
    return res.data;
  },

  async pauseSchedulerJob(jobId) {
    const res = await client.post(`/api/jobs/scheduler/jobs/${jobId}/pause`);
    return res.data;
  },

  async resumeSchedulerJob(jobId) {
    const res = await client.post(`/api/jobs/scheduler/jobs/${jobId}/resume`);
    return res.data;
  },

  async runSchedulerJobNow(jobId) {
    const res = await client.post(`/api/jobs/scheduler/jobs/${jobId}/run`);
    return res.data;
  },

  // Dashboard Metrics
  async getDashboardStats() {
    const res = await client.get('/api/dashboard/stats');
    return res.data;
  },

  async getDashboardActivity() {
    const res = await client.get('/api/dashboard/activity');
    return res.data;
  },

  async getRecentJobs() {
    const res = await client.get('/api/dashboard/recent-jobs');
    return res.data;
  },

  async getHealthCheck() {
    const res = await client.get('/api/dashboard/health-check');
    return res.data;
  },

  async getScreenshotUrl() {
    const res = await client.get('/api/dashboard/screenshot', { responseType: 'blob' });
    return URL.createObjectURL(res.data);
  },

  // Admin Logs
  async getLogs(limit = 300, search = '', level = '') {
    const params = { limit };
    if (search) params.search = search;
    if (level) params.level = level;
    const res = await client.get('/api/admin/logs', { params });
    return res.data;
  },

  // Scraped Content & Threads
  async getThreads(page = 1, search = '', configId = '', sortBy = 'scraped_at', sortDir = 'desc') {
    const params = { page, per_page: 15, sort_by: sortBy, sort_dir: sortDir };
    if (search) params.search = search;
    if (configId) params.config_id = configId;
    const res = await client.get('/api/forums/threads', { params });
    return res.data;
  },

  async getThreadDetails(id) {
    const res = await client.get(`/api/forums/threads/${id}`);
    return res.data;
  },

  async exportThreads(search = '', configId = '', format = 'csv') {
    const params = { format };
    if (search) params.search = search;
    if (configId) params.config_id = configId;
    const res = await client.get('/api/forums/threads/export', { 
      params,
      responseType: 'blob'
    });
    return res.data;
  },

  // Scraped Posts (First Post Content)
  async getPosts(page = 1, search = '', configId = '', hasContent = null) {
    const params = { page, per_page: 20 };
    if (search) params.search = search;
    if (configId) params.config_id = configId;
    if (hasContent !== null) params.has_content = hasContent;
    const res = await client.get('/api/posts', { params });
    return res.data;
  },

  async exportPosts(search = '', configId = '', format = 'txt') {
    const params = { format };
    if (search) params.search = search;
    if (configId) params.config_id = configId;
    const res = await client.get('/api/posts/export', {
      params,
      responseType: 'blob'
    });
    return res.data;
  },

  // Watches (Repeating Jobs)
  async getWatches() {
    const res = await client.get('/api/watches');
    return res.data;
  },

  async createWatch(data) {
    const res = await client.post('/api/watches', data);
    return res.data;
  },

  async toggleWatch(id) {
    const res = await client.patch(`/api/watches/${id}/toggle`);
    return res.data;
  },

  async updateWatchInterval(id, interval_seconds) {
    const res = await client.patch(`/api/watches/${id}/interval`, { interval_seconds });
    return res.data;
  },

  async deleteWatch(id) {
    await client.delete(`/api/watches/${id}`);
  },

  // Telegram Settings
  async getTelegramSettings() {
    const res = await client.get('/api/telegram/settings');
    return res.data;
  },

  async updateTelegramSettings(data) {
    const res = await client.put('/api/telegram/settings', data);
    return res.data;
  },

  async testTelegramBot(message) {
    const res = await client.post('/api/telegram/test', { message });
    return res.data;
  },

  // Card Extraction
  async getCardSettings() {
    const res = await client.get('/api/cards/settings');
    return res.data;
  },

  async updateCardSettings(data) {
    const res = await client.put('/api/cards/settings', data);
    return res.data;
  },

  async sendCardExportNow() {
    const res = await client.post('/api/cards/send-now');
    return res.data;
  },

  async validateCard(card_raw, email) {
    const res = await client.post('/api/cards/validate', { card_raw, email });
    return res.data;
  },

  async startBulkValidate(cards, emails) {
    const res = await client.post('/api/cards/bulk-validate', { cards, emails });
    return res.data; // { job_id, total }
  },

  async getBulkResults(jobId) {
    const res = await client.get(`/api/cards/bulk-validate/${jobId}/results`);
    return res.data;
  },

  getBulkWsUrl(jobId) {
    const token = localStorage.getItem('token') || '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    return `${proto}://${host}/api/cards/bulk-validate/${jobId}/ws?token=${encodeURIComponent(token)}`;
  },

  async getLatestBulkJob() {
    const res = await client.get('/api/cards/bulk-validate/latest');
    return res.data; // { job_id, status, total, processed, failed, created_at }
  },

  // Topic CC Scraper — scrape all posts in a topic, extract cards
  async startTopicScrape(thread_url, config_id) {
    const res = await client.post('/api/topic-scrape/start', { thread_url, config_id });
    return res.data; // { job_id, status }
  },

  async getTopicScrapeStatus(jobId) {
    const res = await client.get(`/api/topic-scrape/${jobId}/status`);
    return res.data;
  },

  getTopicScrapeWsUrl(jobId) {
    const token = localStorage.getItem('token') || '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    return `${proto}://${host}/api/topic-scrape/${jobId}/ws?token=${encodeURIComponent(token)}`;
  },

  getTopicScrapeDownloadUrl(jobId) {
    return `/api/topic-scrape/${jobId}/download`;
  },

  async downloadTopicCards(jobId) {
    const res = await client.get(`/api/topic-scrape/${jobId}/download`, { responseType: 'blob' });
    return res.data;
  },

  async sendTopicCardsToTelegram(jobId) {
    const res = await client.post(`/api/topic-scrape/${jobId}/send-telegram`);
    return res.data;
  },
};

export default apiService;
