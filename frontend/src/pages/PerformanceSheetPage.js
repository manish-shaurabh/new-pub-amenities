/**
 * PerformanceSheetPage — route /performance/:userId
 * Wraps the existing SupervisorAnalyticsView with a back button.
 */
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';
import SupervisorAnalyticsView from '../components/SupervisorAnalyticsView';

export default function PerformanceSheetPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  return (
    <div className="space-y-4 p-4" data-testid="performance-sheet-page">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}
                data-testid="perf-back" className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <h1 className="text-xl font-semibold text-slate-800">Performance Sheet</h1>
      </div>
      <SupervisorAnalyticsView supervisorId={userId} />
    </div>
  );
}
