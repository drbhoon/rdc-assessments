import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminDashboard from './pages/AdminDashboard';
import CandidateView from './pages/CandidateView';
import { BASE } from './basePath';

function App() {
  return (
    <BrowserRouter basename={BASE}>
      <Routes>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/" element={<CandidateView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
