import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Link2, Play, Loader, Download, Send, CreditCard, FileText,
  CheckCircle, AlertTriangle, XCircle, Activity, ChevronDown,
  Terminal,
} from 'lucide-react';
import apiService from '../api/apiService';
import toast from 'react-hot-toast';

export default function TopicScraper() {
  const [threadUrl, setThreadUrl] = useState('');
  const [configs, setConfigs] = useState([]);
  const [configId, setConfigId] = useState('');
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [progress, setProgress] = useState({ totalPages: 0, currentPage: 0, totalPosts: 0, totalCards: 0 });
  const [cards, setCards] = useState([]);
  const [logs, setLogs] = useState([]);
  const [threadTitle, setThreadTitle] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [sendingTelegram, setSendingTelegram] = useState(false);

  const wsRef = useRef(null);
  const logBoxRef = useRef(null);

  // Load forum configs on mount
  useEffect(() => {
    let cancelled = false;
    async function loadConfigs() {
      try {
        const data = await apiService.getConfigs();
        if (cancelled) return;
        setConfigs(data);
        if (data.length > 0 && !configId) {
          setConfigId(String(data[0].id));
        }
      } catch {
        toast.error('Failed to load forum configurations.');
      }
    }
    loadConfigs();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  // Cleanup WS on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const fetchFinalResults = useCallback(async (jid) => {
    try {
      const data = await apiService.getTopicScrapeStatus(jid);
      setProgress(p => ({
        ...p,
        totalPages: data.total_pages || p.totalPages,
        totalPosts: data.total_posts || p.totalPosts,
        totalCards: data.total_cards || p.totalCards,
      }));
      setThreadTitle(data.thread_title || '');
      if (data.cards_list && data.cards_list.length > 0) {
        setCards(data.cards_list);
      }
    } catch {
      // ignore
    }
  }, []);

  const connectWs = useCallback((jid) => {
    if (wsRef.current) wsRef.current.close();
    setWsConnected(false);

    const url = apiService.getTopicScrapeWsUrl(jid);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'ping') return;

        if (msg.type === 'snapshot') {
          setJobStatus(msg.job_status);
          if (msg.total_pages) setProgress(p => ({ ...p, totalPages: msg.total_pages }));
          if (msg.total_posts) setProgress(p => ({ ...p, totalPosts: msg.total_posts }));
          if (msg.total_cards) setProgress(p => ({ ...p, totalCards: msg.total_cards }));
          if (msg.thread_title) setThreadTitle(msg.thread_title);
          if (msg.cards_list) setCards(msg.cards_list);
        } else if (msg.type === 'start') {
          setProgress({ totalPages: 0, currentPage: 0, totalPosts: 0, totalCards: 0 });
          setCards([]);
          setLogs([]);
        } else if (msg.type === 'page_total') {
          setThreadTitle(msg.thread_title || '');
          setProgress(p => ({ ...p, totalPages: msg.total_pages }));
        } else if (msg.type === 'page_done') {
          setProgress({
            totalPages: msg.total_pages,
            currentPage: msg.page,
            totalPosts: msg.total_posts,
            totalCards: msg.cards_found,
          });
        } else if (msg.type === 'log') {
          setLogs(prev => [...prev, { message: msg.message, level: msg.level || 'info' }]);
        } else if (msg.type === 'done') {
          setJobStatus('completed');
          setThreadTitle(msg.thread_title || '');
          setProgress({
            totalPages: msg.total_pages,
            currentPage: msg.total_pages,
            totalPosts: msg.total_posts,
            totalCards: msg.total_cards,
          });
          setScraping(false);
          // Fetch final cards list from status endpoint
          fetchFinalResults(jid);
        } else if (msg.type === 'cancelled') {
          setJobStatus('cancelled');
          setScraping(false);
        } else if (msg.type === 'error') {
          setJobStatus('failed');
          setScraping(false);
          toast.error(msg.error || 'Scrape failed.');
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    ws.onerror = () => {
      setWsConnected(false);
      toast.error('WebSocket connection error.');
    };

    ws.onclose = () => setWsConnected(false);
  }, [fetchFinalResults]);

  const handleScrape = async () => {
    const url = threadUrl.trim();
    if (!url) {
      toast.error('Please enter a topic URL.');
      return;
    }
    if (!configId) {
      toast.error('Please select a forum configuration.');
      return;
    }

    setLoading(true);
    setScraping(true);
    setProgress({ totalPages: 0, currentPage: 0, totalPosts: 0, totalCards: 0 });
    setCards([]);
    setLogs([]);
    setThreadTitle('');
    setJobStatus('pending');

    try {
      const data = await apiService.startTopicScrape(url, parseInt(configId, 10));
      setJobId(data.job_id);
      setJobStatus(data.status);
      toast.success('Scrape started — extracting cards from all posts...');
      connectWs(data.job_id);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to start scrape.');
      setScraping(false);
      setJobStatus('failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!jobId) return;
    setDownloading(true);
    try {
      const blob = await apiService.downloadTopicCards(jobId);
      // Create a download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (threadTitle || 'topic').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_').slice(0, 50) || 'topic';
      a.download = `cards_${safeName}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Text file downloaded.');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

  const handleSendTelegram = async () => {
    if (!jobId) return;
    setSendingTelegram(true);
    try {
      const data = await apiService.sendTopicCardsToTelegram(jobId);
      toast.success(data.message || 'Cards sent to Telegram.');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to send to Telegram.');
    } finally {
      setSendingTelegram(false);
    }
  };

  const percentage = progress.totalPages > 0
    ? Math.round((progress.currentPage / progress.totalPages) * 100)
    : 0;

  const isRunning = scraping || jobStatus === 'pending' || jobStatus === 'running';
  const isDone = jobStatus === 'completed';
  const hasCards = progress.totalCards > 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Topic CC Scraper</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Scrape all posts in a topic and extract every credit card into a downloadable file.
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white border border-slate-200/80 px-4 py-2.5 rounded-xl shadow-xs">
          <CreditCard className="h-5 w-5 text-indigo-500" />
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 leading-tight">Output Format</p>
            <p className="text-base font-extrabold text-slate-800 leading-tight font-mono">CARD|MM|YY|CVV</p>
          </div>
        </div>
      </div>

      {/* Input Card */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-extrabold text-slate-800 mb-5 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-indigo-600" />
          Topic URL & Forum Configuration
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px_auto] gap-4 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Topic URL *</label>
            <input
              value={threadUrl}
              onChange={e => setThreadUrl(e.target.value)}
              placeholder="https://altenens.is/threads/topic-name.123456/"
              className="input-field w-full text-sm"
              style={{ padding: '11px 14px', borderRadius: '8px' }}
              disabled={isRunning}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Forum Config *</label>
            <div className="relative">
              <select
                value={configId}
                onChange={e => setConfigId(e.target.value)}
                className="input-field w-full text-sm appearance-none pr-10"
                style={{ padding: '11px 14px', borderRadius: '8px' }}
                disabled={isRunning || configs.length === 0}
              >
                {configs.length === 0 && <option value="">No configs available</option>}
                {configs.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
          <button
            onClick={handleScrape}
            disabled={isRunning || !threadUrl.trim() || !configId}
            className="btn flex items-center justify-center gap-2"
            style={{
              padding: '11px 28px',
              fontSize: '13px',
              fontWeight: '700',
              borderRadius: '8px',
              textTransform: 'none',
              letterSpacing: 'normal',
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              color: '#ffffff',
              boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
              opacity: isRunning || !threadUrl.trim() || !configId ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {loading || scraping ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Scraping...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Scrape Topic
              </>
            )}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-3">
          Enter the full URL of a forum topic. The scraper will fetch every page, parse all posts, and extract credit cards in
          <span className="font-mono font-bold text-slate-500"> CARD|MM|YY|CVV </span> format.
        </p>
      </div>

      {/* Progress & Status */}
      {(jobId || isRunning) && (
        <div className="glass-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              {isRunning ? (
                <Activity className="w-5 h-5 text-indigo-600 animate-pulse" />
              ) : jobStatus === 'completed' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              ) : jobStatus === 'failed' ? (
                <XCircle className="w-5 h-5 text-rose-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              )}
              <span className="font-extrabold text-slate-800 text-sm">
                {isRunning ? 'Scraping in Progress' : jobStatus === 'completed' ? 'Scrape Complete' : jobStatus === 'failed' ? 'Scrape Failed' : 'Cancelled'}
              </span>
              {jobId && <span className="text-xs text-slate-400 font-semibold">Job #{jobId}</span>}
              {wsConnected && (
                <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                  Live
                </span>
              )}
            </div>
            {threadTitle && (
              <span className="text-xs text-slate-500 font-medium truncate max-w-md" title={threadTitle}>
                {threadTitle}
              </span>
            )}
          </div>

          {/* Progress Bar */}
          {progress.totalPages > 0 && (
            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-extrabold text-slate-800">
                  Page {progress.currentPage} of {progress.totalPages}
                </span>
                <span className="text-sm font-black text-indigo-600">{percentage}%</span>
              </div>
              <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 rounded-full transition-all duration-300"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="bg-slate-50/50 p-3.5 rounded-xl border border-slate-100 text-center">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Pages Scraped</span>
              <strong className="text-xl font-black text-slate-700">{progress.currentPage}<span className="text-sm text-slate-400">/{progress.totalPages || '?'}</span></strong>
            </div>
            <div className="bg-slate-50/50 p-3.5 rounded-xl border border-slate-100 text-center">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Posts Scanned</span>
              <strong className="text-xl font-black text-slate-700">{progress.totalPosts}</strong>
            </div>
            <div className="bg-emerald-50/50 p-3.5 rounded-xl border border-emerald-100 text-center">
              <span className="block text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-1">Cards Found</span>
              <strong className="text-xl font-black text-emerald-600">{progress.totalCards}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons (shown when scrape is done with cards) */}
      {isDone && hasCards && (
        <div className="glass-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h4 className="font-extrabold text-slate-800 text-sm">Extraction Complete</h4>
                <p className="text-xs text-slate-500">
                  <strong className="text-emerald-600">{progress.totalCards}</strong> unique cards extracted from{' '}
                  <strong>{progress.totalPosts}</strong> posts across <strong>{progress.totalPages}</strong> pages.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="btn flex items-center justify-center gap-2"
                style={{
                  padding: '12px 22px',
                  fontSize: '13px',
                  fontWeight: '700',
                  borderRadius: '10px',
                  textTransform: 'none',
                  letterSpacing: 'normal',
                  background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                  color: '#ffffff',
                  boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)',
                  opacity: downloading ? 0.6 : 1,
                }}
              >
                {downloading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Preparing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Download Text File
                  </>
                )}
              </button>
              <button
                onClick={handleSendTelegram}
                disabled={sendingTelegram}
                className="btn flex items-center justify-center gap-2"
                style={{
                  padding: '12px 22px',
                  fontSize: '13px',
                  fontWeight: '700',
                  borderRadius: '10px',
                  textTransform: 'none',
                  letterSpacing: 'normal',
                  background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
                  color: '#ffffff',
                  boxShadow: '0 4px 12px rgba(14, 165, 233, 0.25)',
                  opacity: sendingTelegram ? 0.6 : 1,
                }}
              >
                {sendingTelegram ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send to Telegram
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty / no cards state */}
      {isDone && !hasCards && (
        <div className="glass-card p-8 text-center">
          <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-100">
            <FileText className="w-8 h-8 text-slate-300" />
          </div>
          <h4 className="text-slate-800 font-bold mb-1 text-sm">No Cards Found</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            The scraper completed but no valid credit cards were found in any of the posts in this topic.
          </p>
        </div>
      )}

      {/* Cards Preview */}
      {hasCards && (
        <div className="glass-card overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/30 flex items-center justify-between">
            <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-indigo-500" />
              Extracted Cards ({progress.totalCards})
            </h4>
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: '320px' }}>
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0">
                <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 text-xs font-bold uppercase tracking-wider">
                  <th className="px-4 py-3 text-left w-10">#</th>
                  <th className="px-4 py-3 text-left">Card</th>
                  <th className="px-4 py-3 text-left">Exp</th>
                  <th className="px-4 py-3 text-left">CVV</th>
                </tr>
              </thead>
              <tbody>
                {cards.slice(0, 500).map((c, i) => {
                  const parts = c.split('|');
                  return (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/70 transition-colors" style={{ background: i % 2 === 0 ? '#ffffff' : '#fafbfc' }}>
                      <td className="py-3 px-4 font-bold text-slate-400">{i + 1}</td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-700">
                        {parts[0] ? `${parts[0].slice(0, 6)}••••${parts[0].slice(-4)}` : c}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">{parts[1] && parts[2] ? `${parts[1]}/${parts[2]}` : '—'}</td>
                      <td className="py-3 px-4 font-mono text-slate-600">{parts[3] || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {cards.length > 500 && (
            <div className="p-3 text-center text-xs text-slate-400 bg-slate-50/30 border-t border-slate-100">
              Showing first 500 of {cards.length} cards. Download the file for the full list.
            </div>
          )}
        </div>
      )}

      {/* Live Logs */}
      {logs.length > 0 && (
        <div className="glass-card overflow-hidden">
          <button
            onClick={() => setShowLogs(v => !v)}
            className="flex items-center justify-between w-full p-4 border-b border-slate-100 bg-slate-50/30"
          >
            <span className="font-bold text-slate-700 text-xs tracking-wider uppercase flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-500" />
              Live Logs ({logs.length})
            </span>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showLogs ? '' : 'rotate-180'}`} />
          </button>
          {showLogs && (
            <div
              ref={logBoxRef}
              className="p-4 overflow-y-auto font-mono text-xs leading-relaxed"
              style={{ maxHeight: '220px', background: '#0f172a', color: '#cbd5e1' }}
            >
              {logs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    color: log.level === 'warning' ? '#fbbf24' : log.level === 'error' ? '#f87171' : '#cbd5e1',
                  }}
                >
                  <span style={{ color: '#64748b' }}>{String(i + 1).padStart(3, '0')}</span>{' '}
                  {log.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}