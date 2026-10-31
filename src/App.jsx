import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import AdminDashboard from './pages/AdminDashboard';
import CandidateView from './pages/CandidateView';
import TraineeReport from './pages/TraineeReport';
import SupervisorReview from './pages/SupervisorReview';
import { BASE } from './basePath';

// A report link held by the Recruitment Tracker.
function RecruitmentReport() {
  const { code } = useParams();
  return <AdminDashboard consoleKey="recruitment" reportCode={code} />;
}

function App() {
  return (
    <BrowserRouter basename={BASE}>
      <Routes>
        {/* Two consoles over one codebase, split by audience — employees on
            /admin, external candidates on /admin/recruitment. The portal gives
            each its own tile; see src/consoles.js for what belongs where. */}
        <Route path="/admin" element={<AdminDashboard consoleKey="assessment" />} />
        <Route path="/admin/recruitment" element={<AdminDashboard consoleKey="recruitment" />} />
        <Route path="/admin/recruitment/report/:code" element={<RecruitmentReport />} />
        {/* Monthly trainee reports: the trainee's upload link and the
            supervisor's review link. Open pages — the token is the key. */}
        <Route path="/report/:token" element={<TraineeReport />} />
        <Route path="/review/:token" element={<SupervisorReview />} />
        <Route path="/" element={<CandidateView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
