import { useId, useRef } from 'react';

import { useNotifications } from '../../api/hooks/shared';
import type { Notification } from '../../api/types';
import { Card, EmptyRow, Pagination, usePages } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { TryAgain, errorText, headingFocus } from './DashboardSections';

// The smallest view of GET /api/me/notifications (newest first, at most 100 from the backend), so the
// result of a send can be seen by a recipient. Where it finally lives in the faculty pages is still to be
// agreed; it takes no props, so it can move without changes.

const PAGE_SIZE = 5;

const TYPE_LABEL: Record<Notification['notifType'], string> = {
  reminder: 'Due reminder',
  due_notice: 'Due notice',
  matches_ready: 'Observer list ready',
  observation_request: 'Observation request',
  request_cancelled: 'Request cancelled',
  survey_open: 'Survey open',
};

export function NotificationInbox({ title = 'Your notifications' }: { title?: string }) {
  const query = useNotifications();
  const heading = useRef<HTMLHeadingElement>(null);
  const pager = usePages(query.data ?? [], PAGE_SIZE);
  const id = useId();

  let body;
  if (query.data === undefined) {
    body = query.error
      ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-4 text-sm">
          <span role="alert" className="text-red-800">Couldn't load your notifications: {errorText(query.error)}</span>
          <TryAgain queries={[query]} focus={heading} />
        </div>
      )
      : <p role="status" className="px-4 py-4 text-sm text-gray-500">Loading your notifications…</p>;
  } else if (query.data.length === 0) {
    body = <EmptyRow>No notifications yet.</EmptyRow>;
  } else {
    body = (
      <>
        {query.error && (
          <p className="flex flex-wrap items-center gap-x-3 px-4 pt-3 text-xs text-red-800">
            <span role="alert">Couldn't refresh.</span>
            <TryAgain queries={[query]} focus={heading} />
          </p>
        )}
        <ul className="divide-y divide-gray-200">
          {pager.rows.map((n) => (
            <li key={n.notificationId} className="px-4 py-3">
              <p className="text-xs text-gray-500">
                <span className="font-bold text-gray-700">{TYPE_LABEL[n.notifType] ?? n.notifType}</span>
                {' · '}<time dateTime={n.sentDate}>{formatDateTime(n.sentDate)}</time>
                {n.sentBy ? ` · from ${n.sentBy.displayName}` : ''}
              </p>
              <p className="mt-1 text-sm wrap-anywhere text-gray-900">{n.subject}</p>
            </li>
          ))}
        </ul>
        {pager.pages > 1 && <div className="border-t border-gray-200 px-4 py-3"><Pagination pager={pager} label={`${title} pages`} /></div>}
      </>
    );
  }

  return (
    <section aria-labelledby={id}>
      <h2 id={id} ref={heading} tabIndex={-1} className={`mt-[30px] mb-3 w-fit text-base font-bold text-gray-900 ${headingFocus}`}>{title}</h2>
      <Card>{body}</Card>
    </section>
  );
}
