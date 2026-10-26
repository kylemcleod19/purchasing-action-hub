import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { IncomingPage } from './pages/IncomingPage';
import { PurchaseOrderPage } from './pages/PurchaseOrderPage';
import { DemoScenariosPage } from './pages/DemoScenariosPage';
import { DemoBanner } from './components/DemoBanner';
import { DemoProvider, useDemo } from './demo';
import './styles.css';

/** Demo scenarios appears only when the server runs in DEMO_MODE. */
function MainNav() {
  const { meta } = useDemo();
  return (
    <nav>
      <NavLink to="/" end>
        Incoming items
      </NavLink>
      {meta?.demoMode && <NavLink to="/demo-scenarios">Demo scenarios</NavLink>}
    </nav>
  );
}

function App() {
  return (
    <DemoProvider>
      <DemoBanner />
      <header className="app-header">
        <Link to="/" className="app-title">
          Purchasing Action Hub
        </Link>
        <MainNav />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<IncomingPage />} />
          <Route path="/purchase-orders/:id" element={<PurchaseOrderPage />} />
          <Route path="/demo-scenarios" element={<DemoScenariosPage />} />
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
