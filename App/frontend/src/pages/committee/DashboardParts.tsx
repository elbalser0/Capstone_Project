import { DueFaculty, Outstanding, Unmatched } from './DashboardSections';
import { NotificationControls } from './NotificationControls';
import { NotificationInbox } from './NotificationInbox';

// The dashboard's detail parts, one short page each under Dashboard in the sidebar, so the
// dashboard itself keeps only the KPIs and the executive summary. Each part keeps its own
// loading, error, Try again and no-cycle states. `@container` lets the parts follow the content
// column's width, as they did on the dashboard.

export function DueListPage() {
  return <div className="@container flex flex-col"><DueFaculty /></div>;
}

export function UnmatchedListPage() {
  return <div className="@container flex flex-col"><Unmatched /></div>;
}

export function OutstandingListPage() {
  return <div className="@container flex flex-col"><Outstanding /></div>;
}

export function NotificationsPage() {
  return (
    <div className="@container flex flex-col">
      <NotificationControls />
      <NotificationInbox />
    </div>
  );
}
