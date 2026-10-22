import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { setClock } from './lib/clock';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

async function start() {
  // With VITE_USE_MOCKS=true the service worker answers /api from the dummy data,
  // so the app runs before the Express endpoints exist.
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    const { worker } = await import('./mocks/browser');
    const { now } = await import('./mocks/store');
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
    setClock(() => new Date(now()).getTime());
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
