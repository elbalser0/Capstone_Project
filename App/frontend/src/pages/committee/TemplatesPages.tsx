import { Link, Navigate, Outlet, useParams } from 'react-router';
import { useTemplates } from '../../api/hooks/committee';
import type { TemplateQuestion, TemplateStatus, TemplateVersion } from '../../api/types';
import { usePageTitle } from '../../components/AppShell';
import { Button, Cell, ErrorNote, Note, Row, Table, Tag, buttonClass, type TagTone } from '../../components/ui';
import { formatDate } from '../../lib/format';

// A5 versions and A5a view a version (read only). The draft screens (A5b, A5c, A5d, A5e) are in the same
// file so that the draft being edited lives in one layout.

const STATUS: Record<TemplateStatus, [TagTone, string]> = { draft: ['neutral', 'Draft'], live: ['signed', 'Live'], retired: ['neutral', 'Retired'] };

export function StatusTag({ status }: { status: TemplateStatus }) {
  return <Tag tone={STATUS[status][0]}>{STATUS[status][1]}</Tag>;
}

/** "1 Poor to 5 Excellent", or "1 to 5" when the labels are empty. */
export const scaleLabel = (q: Pick<TemplateQuestion, 'ratingMin' | 'ratingMax' | 'minLabel' | 'maxLabel'>) =>
  [q.ratingMin, q.minLabel, 'to', q.ratingMax, q.maxLabel].filter((part) => part !== '').join(' ');

function useVersions() {
  const templates = useTemplates();
  const versions = templates.data ?? [];
  return { templates, versions, live: versions.find((v) => v.status === 'live'), draftVersion: versions.find((v) => v.status === 'draft') };
}

function LoadError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="pt-8">
      <ErrorNote error={error} />
      <Button variant="secondary" className="mt-3" disabled={retrying} onClick={onRetry}>{retrying ? 'Trying again…' : 'Try again'}</Button>
    </div>
  );
}

export function TemplatesLayout() {
  return <Outlet />;
}

// ---------- A5 ----------

export function TemplatesPage() {
  const { templates, versions } = useVersions();

  if (templates.error && !templates.data) return <LoadError error={templates.error} onRetry={() => void templates.refetch()} retrying={templates.isFetching} />;
  if (!templates.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading templates…</p>;
  return (
    <div className="flex flex-col pt-8">
      <p className="text-sm text-gray-500">All versions of the observation form. Edit the draft, or view any version. Signed observations keep the version they used.</p>
      <div className="mt-[17px] flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">All versions</h2>
      </div>
      <div className="mt-[10px]">
        <Table label="Versions" columns="100px 120px 130px 150px 250px 120px 1fr" head={['Version', 'Status', 'Published', 'By', 'What changed', 'Used by', '']}>
          {versions.map((v) => (
            <Row key={v.versionId}>
              <Cell className="font-bold">Version {v.versionNo}</Cell>
              <Cell><StatusTag status={v.status} /></Cell>
              <Cell className="text-gray-700">{v.publishedDate ? formatDate(v.publishedDate) : 'Not yet'}</Cell>
              <Cell className="text-gray-700">{v.createdBy.displayName}</Cell>
              <Cell className="text-gray-700">{v.changeNote}</Cell>
              <Cell className="text-gray-700">{v.observationsCount} {v.observationsCount === 1 ? 'observation' : 'observations'}</Cell>
              <Cell className="pr-0">
                {v.status !== 'draft' && <Link to={v.versionId} className={buttonClass('secondary', '', 'xs')} aria-label={`View version ${v.versionNo}`}>View</Link>}
              </Cell>
            </Row>
          ))}
          {versions.length === 0 && <p className="px-4 py-4 text-sm text-gray-500">No template versions yet.</p>}
        </Table>
      </div>
      <Note className="mt-6" title="How every form works">
        Each question gets a rating and a comment box, and every form ends with Any other comments. There are no other question types.
      </Note>
    </div>
  );
}

// ---------- A5a ----------

function QuestionsTable({ questions, label }: { questions: TemplateQuestion[]; label: string }) {
  return (
    <Table label={label} columns="200px 300px 180px 110px 1fr" head={['Question', 'Wording observers see', 'Rating', 'Comment box', 'Required']}>
      {questions.map((q) => (
        <Row key={q.questionId}>
          <Cell className="font-bold">{q.title}</Cell>
          <Cell className="text-gray-700">{q.wording}</Cell>
          <Cell className="text-gray-700">{scaleLabel(q)}</Cell>
          <Cell className="text-gray-700">Yes</Cell>
          <Cell className="text-gray-700">{q.isRequired ? 'Yes' : 'No'}</Cell>
        </Row>
      ))}
      <Row>
        <Cell className="font-bold">Any other comments</Cell>
        <Cell className="text-gray-700">Always the last item on every form</Cell>
        <Cell className="text-gray-500">No rating</Cell>
        <Cell className="text-gray-700">Yes</Cell>
        <Cell className="text-gray-500">Always included</Cell>
      </Row>
    </Table>
  );
}

function VersionView({ v }: { v: TemplateVersion }) {
  usePageTitle(`Version ${v.versionNo} (read only)`);
  return (
    <div className="flex flex-col pt-8">
      <div className="flex flex-wrap items-center gap-[15px]">
        <StatusTag status={v.status} />
        <p className="text-sm text-gray-500">
          {v.publishedDate ? `Published ${formatDate(v.publishedDate)}` : 'Not published'} by {v.createdBy.displayName}. Used by {v.observationsCount}
          {v.observationsCount === 1 ? ' observation' : ' observations'}. It cannot be edited.
        </p>
      </div>
      {v.changeNote && <p className="mt-3 text-sm text-gray-700">What changed: {v.changeNote}</p>}
      <div className="mt-[18px] overflow-x-auto"><div className="min-w-[760px]"><QuestionsTable questions={v.questions} label={`Version ${v.versionNo} questions`} /></div></div>
      <div className="mt-9">
        <Link to="/committee/templates" className={buttonClass('secondary')}>Back to templates</Link>
      </div>
    </div>
  );
}

export function VersionPage() {
  const { versionId } = useParams();
  const { templates, versions } = useVersions();
  const v = versions.find((x) => x.versionId === versionId);

  if (templates.error && !templates.data) return <LoadError error={templates.error} onRetry={() => void templates.refetch()} retrying={templates.isFetching} />;
  if (!templates.data) return <p role="status" className="pt-8 text-sm text-gray-500">Loading template…</p>;
  if (!v) return <Navigate to="/committee/templates" replace />;
  if (v.status === 'draft') return <Navigate to="/committee/templates/draft" replace />;
  return <VersionView v={v} />;
}
