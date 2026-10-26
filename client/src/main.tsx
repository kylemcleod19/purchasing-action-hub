import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { IncomingPage } from './pages/IncomingPage';
import { PurchaseOrderPage } from './pages/PurchaseOrderPage';
import { DemoBanner } from './components/DemoBanner';
import { DemoProvider } from './demo';
import './styles.css';

function App() {
  return (
    <DemoProvider>
      <DemoBanner />
      <header className="app-header">
        <Link to="/" className="app-title">
          Purchasing Action Hub
        </Link>
        <nav>
          <Link to="/">Incoming items</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<IncomingPage />} />
          <Route path="/purchase-orders/:id" element={<PurchaseOrderPage />} />
          <Route
            path="*"
            element={
              <p className="empty">
                Page not found. <Link to="/">Go to Incoming items</Link>
              </p>
            }
          />
        </Routes>
      </main>
    </DemoProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
