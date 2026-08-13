import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminDashboard from './pages/AdminDashboard';
import CandidateView from './pages/CandidateView';
import { BASE } from './basePath';

function App() {
  return (
    <BrowserRouter basename={BASE}>
      <Routes>
        {/* Two consoles over one codebase, split by audience — employees on
            /admin, external candidates on /admin/recruitment. The portal gives
            each its own tile; see src/consoles.js for what belongs where. */}
        <Route path="/admin" element={<AdminDashboard consoleKey="assessment" />} />
        <Route path="/admin/recruitment" element={<AdminDashboard consoleKey="recruitment" />} />
        <Route path="/" element={<CandidateView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
