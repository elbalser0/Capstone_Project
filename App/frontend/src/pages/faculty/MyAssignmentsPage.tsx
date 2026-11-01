import { Link } from 'react-router';
import { useMyAssignments } from '../../api/hooks/faculty';
import { Card, PageError, linkClass } from '../../components/ui';
import { formatDate, isLocked } from '../../lib/format';

export function MyAssignmentsPage() {
  const assignments = useMyAssignments();
  if (assignments.error) return <PageError error={assignments.error} />;
  if (!assignments.data) return <p role="status" className="pt-8">Loading assignments…</p>;
  return <div className="space-y-4 pt-8">
    <h2 className="text-xl font-bold">My assigned observations</h2>
    {assignments.data.length === 0 && <p>No assigned observations yet.</p>}
    {assignments.data.map(o => <Card key={o.observationId} className="space-y-2 p-5">
      <h3 className="font-bold">{o.observee.displayName} — {o.section.label}</h3>
      <p className="text-sm">{formatDate(o.scheduledDate)} · {o.status === 'not_completed' ? 'Did not happen' : isLocked(o) ? 'Signed and locked' : o.status === 'completed' ? 'Completed' : 'Scheduled'}</p>
      <div className="flex flex-wrap gap-5">
        <Link className={linkClass} to={`/faculty/observe/${o.observationId}`}>View record</Link>
        {!isLocked(o) && o.status !== 'not_completed' && <Link className={linkClass} to={`/faculty/observe/${o.observationId}/form`}>Open form</Link>}
      </div>
    </Card>)}
  </div>;
}
