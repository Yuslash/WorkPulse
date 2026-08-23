import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { RealtimeProvider } from './lib/realtime';
import { ThemeProvider } from './lib/theme';
import { ApiError } from './lib/api';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Presence arrives over the WebSocket, so polled data can be stale for
      // a while without the dashboard looking wrong.
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Retrying a 401/403/404 just delays the real error.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RealtimeProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </RealtimeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
