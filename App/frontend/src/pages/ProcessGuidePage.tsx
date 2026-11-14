import { useRef } from 'react';
import { useCurrentCycle } from '../api/hooks/shared';
import type { DueStatus } from '../api/types';
import { Card, Detail, ErrorNote, Steps } from '../components/ui';
import { formatDate, formatRange } from '../lib/format';
import { DUE_STATUS_TEXT } from '../lib/statusTerms';
import { TryAgain, errorText, headingFocus } from './committee/DashboardSections';

// Process guide, linked from the sidebar. Every rule here is one the backend already applies.
// The steps stay general; the current cycle's dates are only in the card at the top.

const DUE_ORDER: DueStatus[] = ['DUE', 'OVERDUE', 'NOT_DUE'];

function CycleCard() {
  const cycle = useCurrentCycle();
  const heading = useRef<HTMLHeadingElement>(null);

  let body;
  if (cycle.data) {
    body = (
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
        <Detail label="Sign-up deadline" large>{formatDate(cycle.data.signupDeadline)}</Detail>
        <Detail label="Observation period deadline" large>{formatDate(cycle.data.observationDeadline)}</Detail>
        <Detail label="Survey window" large>{formatRange(cycle.data.surveyOpensDate, cycle.data.feedbackDeadline)}</Detail>
      </dl>
    );
  } else if (cycle.data === null) {
    body = <p className="mt-2 text-sm text-gray-500">No evaluation cycle has started yet. The committee sets the deadlines when it starts one.</p>;
  } else if (cycle.error) {
    body = (
      <div key={cycle.errorUpdatedAt} className="mt-3 flex flex-col items-start gap-3">
        <ErrorNote error={new Error(`Couldn't load the current cycle: ${errorText(cycle.error)}`)} className="w-full" />
        <TryAgain queries={[cycle]} focus={heading} look="button" />
      </div>
    );
  } else {
    body = <p role="status" className="mt-2 text-sm text-gray-500">Loading the current cycle…</p>;
  }

  return (
    <Card className="px-6 py-5">
      <h2 ref={heading} tabIndex={-1} className={`w-fit text-base font-bold text-gray-900 ${headingFocus}`}>
        {cycle.data ? `${cycle.data.term.label} cycle` : 'Current cycle'}
      </h2>
      {body}
    </Card>
  );
}

export function ProcessGuidePage() {
  return (
    <div className="flex flex-col gap-6 pt-8">
      <CycleCard />

      <Card className="px-6 py-5">
        <h2 className="mb-4 text-base font-bold text-gray-900">How a semester works</h2>
        <Steps
          tone="brand"
          items={[
            'The Assessment Committee starts the cycle and sets its deadlines.',
            'If you are due, sign up before the sign-up deadline: pick one course and the class meetings an observer could attend.',
            'The committee runs observer selection, and you get up to 5 suggested colleagues from your department.',
            'You send requests. Each one is open for 48 hours, and the first colleague to accept becomes your observer.',
            'Your observer attends the class before the observation deadline, fills in the form and signs it. You sign next, and the record locks.',
            'After the observation deadline, you both fill in a short survey. The results are generated after the feedback deadline.',
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4">
          <h3 className="text-sm font-bold text-gray-900">Who is due</h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-gray-500">
            {DUE_ORDER.map((status) => <li key={status}>{DUE_STATUS_TEXT[status]}</li>)}
          </ul>
          <p className="mt-2 text-sm text-gray-500">Your first observation is due two years after you start. After that, Assistant professors are due every year, and Associate and Full professors every two years.</p>
        </Card>
        <Card className="px-5 py-4">
          <h3 className="text-sm font-bold text-gray-900">Observing a colleague</h3>
          <p className="mt-2 text-sm text-gray-500">Signing up puts you in that semester's observer pool. You can accept up to 3 observations a semester.</p>
        </Card>
        <Card className="px-5 py-4">
          <h3 className="text-sm font-bold text-gray-900">Who sees a record</h3>
          <p className="mt-2 text-sm text-gray-500">You see every record about you, and observers see the ones they conducted. Assessment Committee members can open any record.</p>
        </Card>
      </div>
    </div>
  );
}
