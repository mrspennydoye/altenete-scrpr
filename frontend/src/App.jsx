import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import Threads from './pages/Threads';
import Posts from './pages/Posts';
import Settings from './pages/Settings';
import Login from './pages/Login';
import HealthCheck from './pages/HealthCheck';
import AdminLogs from './pages/AdminLogs';
import Scheduler from './pages/Scheduler';
import CardValidator from './pages/CardValidator';
import TopicScraper from './pages/TopicScraper';
import useStore from './store/useStore';

function PrivateRoute({ children }) {
  const { isAuthenticated, fetchCurrentUser } = useStore();

  useEffect(() => {
    if (isAuthenticated) {
      fetchCurrentUser();
    }
  }, [isAuthenticated]);

  return isAuthenticated ? (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '256px 1fr',
        gridTemplateRows: '64px 1fr',
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        background: '#f8fafc',
        position: 'relative',
      }}
    >
      {/* Background Glows */}
      <div style={{
        position: 'fixed',
        top: '-15%', right: '-10%',
        width: 600, height: 600,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(165,180,252,0.12) 0%, transparent 70%)',
        filter: 'blur(80px)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />
      <div style={{
        position: 'fixed',
        bottom: '-15%', left: '10%',
        width: 600, height: 600,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(196,181,253,0.12) 0%, transparent 70%)',
        filter: 'blur(80px)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      {/* Sidebar — spans both rows on column 1 */}
      <div style={{ gridColumn: '1', gridRow: '1 / 3', zIndex: 20, position: 'relative' }}>
        <Sidebar />
      </div>

      {/* Header — row 1, column 2 */}
      <div style={{ gridColumn: '2', gridRow: '1', zIndex: 30, position: 'relative' }}>
        <Header />
      </div>

      {/* Main scroll area — row 2, column 2 */}
      <main
        style={{
          gridColumn: '2',
          gridRow: '2',
          overflowY: 'auto',
          overflowX: 'hidden',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <div style={{ padding: '2rem', minHeight: '100%' }}>
          {children}
        </div>
      </main>
    </div>
  ) : (
    <Navigate to="/login" replace />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster 
        position="top-right" 
        toastOptions={{
          style: {
            background: '#ffffff',
            color: '#1e293b',
            border: '1px solid rgba(0, 0, 0, 0.06)',
            borderRadius: '12px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)'
          }
        }} 
      />
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route 
          path="/" 
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/jobs" 
          element={
            <PrivateRoute>
              <Jobs />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/jobs/:id" 
          element={
            <PrivateRoute>
              <JobDetail />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/threads" 
          element={
            <PrivateRoute>
              <Threads />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/posts" 
          element={
            <PrivateRoute>
              <Posts />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/settings" 
          element={
            <PrivateRoute>
              <Settings />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/health" 
          element={
            <PrivateRoute>
              <HealthCheck />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/logs" 
          element={
            <PrivateRoute>
              <AdminLogs />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/scheduler" 
          element={
            <PrivateRoute>
              <Scheduler />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/card-validator" 
          element={
            <PrivateRoute>
              <CardValidator />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/topic-scraper" 
          element={
            <PrivateRoute>
              <TopicScraper />
            </PrivateRoute>
          } 
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
