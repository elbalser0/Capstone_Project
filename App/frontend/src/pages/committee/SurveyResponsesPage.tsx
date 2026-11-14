import { useState } from 'react';
import { downloadSurveyTroubleFile } from '../../api/client';
import { useSurveyResponses } from '../../api/hooks/committee';
import { useCurrentCycle, useMe } from '../../api/hooks/shared';
import { Button, Card, ErrorNote } from '../../components/ui';
import { formatDate } from '../../lib/format';

function Responses({ cycleId }: { cycleId: string }) {
  const query = useSurveyResponses(cycleId);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async (responseId: string) => {
    if (busy) return;
    setBusy(true);
    setDownloadId(responseId);
    setDownloadError('');
    try { await downloadSurveyTroubleFile(cycleId, responseId); }
    catch (error) { setDownloadError(error instanceof Error ? error.message : 'Could not download the file.'); }
    finally { setBusy(false); }
  };
  return <>
    {query.isPending && <p role="status" className="mt-5">Loading survey responses…</p>}
    {query.error && <div className="mt-5"><ErrorNote error={query.error} /><Button variant="secondary" className="mt-3" onClick={() => void query.refetch()}>Try again</Button></div>}
    {query.data && query.data.length === 0 && <p className="mt-5">No survey responses yet.</p>}
    {downloadError && <p role="alert" className="mt-4 text-sm text-red-800">Could not download the trouble file: {downloadError}</p>}
    {query.data && query.data.length > 0 && <div className="mt-5 flex flex-col gap-4">
      {query.data.map((row) => <Card key={row.responseId} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-bold">{row.respondent.displayName} <span className="font-normal text-gray-600">({row.respondentRole})</span></h2>
          <span className="text-sm text-gray-600">Submitted {formatDate(row.submittedDate)}</span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <div><dt className="font-bold">Process went well</dt><dd>{row.processOk ? 'Yes' : 'No'}</dd></div>
          <div><dt className="font-bold">Difficulties</dt><dd className="whitespace-pre-wrap break-words">{row.difficulties || 'None provided'}</dd></div>
          <div><dt className="font-bold">Additional feedback</dt><dd className="whitespace-pre-wrap break-words">{row.additionalFeedback || 'None provided'}</dd></div>
        </dl>
        {row.troubleFileKey && <Button variant="secondary" size="sm" className="mt-4" disabled={busy} onClick={() => void download(row.responseId)}>
          {busy && downloadId === row.responseId ? 'Downloading…' : 'Download trouble file'}
        </Button>}
      </Card>)}
    </div>}
  </>;
}

export function SurveyResponsesPage() {
  const me = useMe();
  const cycle = useCurrentCycle();
  if (me.isPending) return <p role="status" className="pt-8">Checking access…</p>;
  if (me.error) return <div className="pt-8"><ErrorNote error={me.error} /></div>;
  // Do not issue the AC-only list request until the signed-in user's role has been confirmed.
  if (me.data?.role !== 'AC') return <p className="pt-8">Assessment Committee access required.</p>;
  return <div className="pt-8">
    {cycle.isPending && <p role="status">Loading current cycle…</p>}
    {cycle.error && <><ErrorNote error={cycle.error} /><Button variant="secondary" className="mt-3" onClick={() => void cycle.refetch()}>Try again</Button></>}
    {cycle.data === null && <p>No current cycle is available.</p>}
    {cycle.data && <><p className="text-sm text-gray-600">{cycle.data.term.label} survey responses</p><Responses key={cycle.data.cycleId} cycleId={cycle.data.cycleId} /></>}
  </div>;
}
