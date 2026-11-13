import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateTemplateInput, Me, TemplateQuestion, TemplateVersion } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { faculty, observer } from '../../test/fixtures';
import { DraftPage, PreviewPage, TemplatesLayout, TemplatesPage, VersionPage, describeChanges } from './TemplatesPages';

const SESSION_KEY = 'assessment-helper.session';

const question = (n: number, title: string, extra: Partial<TemplateQuestion> = {}): TemplateQuestion => ({
  questionId: `q${n}`, orderNo: n, title, wording: `Wording for ${title}`, ratingMin: 1, ratingMax: 5, minLabel: 'Poor', maxLabel: 'Excellent', isRequired: true, ...extra,
});
const version = (versionId: string, versionNo: number, status: TemplateVersion['status'], extra: Partial<TemplateVersion> = {}): TemplateVersion => ({
  versionId, versionNo, status, changeNote: `Note ${versionNo}`, createdBy: observer, createdDate: '2026-08-01',
  publishedDate: status === 'draft' ? null : '2026-08-05', observationsCount: 4,
  questions: [question(1, 'Clarity'), question(2, 'Pacing')], ...extra,
});
const retired = version('9', 2, 'retired', { observationsCount: 12, publishedDate: '2026-02-01' });
const live = version('10', 3, 'live', { observationsCount: 1 });
const draft = version('11', 4, 'draft', { changeNote: '', observationsCount: 0 });

const failure = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });
const never = () => new Promise<never>(() => {});

interface Log { posts: CreateTemplateInput[]; publishes: { versionId: string; body: unknown }[]; reads: number }

/** The versions endpoint with the backend's rules: saving replaces the draft and publishing retires the live version. */
function serve(initial: TemplateVersion[]) {
  let versions = [...initial];
  const log: Log = { posts: [], publishes: [], reads: 0 };
  server.use(
    http.get('*/api/templates', () => { log.reads += 1; return HttpResponse.json(versions); }),
    http.post('*/api/templates', async ({ request }) => {
      const body = (await request.json()) as CreateTemplateInput;
      log.posts.push(body);
      const saved = version('12', 4, 'draft', {
        changeNote: body.changeNote, questions: body.questions.map((q, i) => ({ ...q, questionId: `n${i}` })), observationsCount: 0,
      });
      versions = [...versions.filter((v) => v.status !== 'draft'), saved];
      return HttpResponse.json(saved, { status: 201 });
    }),
    http.patch('*/api/templates/:versionId/publish', async ({ request, params }) => {
      log.publishes.push({ versionId: String(params.versionId), body: await request.json() });
      versions = versions.map((v) => (v.status === 'live' ? { ...v, status: 'retired' as const } : v.versionId === params.versionId ? { ...v, status: 'live' as const } : v));
      return HttpResponse.json(versions.find((v) => v.versionId === params.versionId));
    }),
  );
  return log;
}

const routes = [
  { path: '/committee/templates', element: <TemplatesLayout />, children: [
    { index: true, element: <TemplatesPage />, handle: { title: 'Observation templates' } },
    { path: 'draft', element: <DraftPage />, handle: { title: 'Edit draft', nav: '/committee/templates' } },
    { path: 'draft/preview', element: <PreviewPage />, handle: { title: 'Preview', nav: '/committee/templates' } },
    { path: ':versionId', element: <VersionPage />, handle: { title: 'Template version', nav: '/committee/templates' } },
  ] },
  { path: '/elsewhere', element: <p>Elsewhere</p> },
];
const open = (path = '/committee/templates') => renderRoutes(routes, path);
const user = () => userEvent.setup();
const row = (name: RegExp) => screen.getAllByRole('row').find((r) => name.test(r.textContent ?? ''))!;

afterEach(() => { sessionStorage.removeItem(SESSION_KEY); });

describe('versions list (A5)', () => {
  it('lists every version with its tag, date, note and use count', async () => {
    serve([draft, live, retired]);
    open();
    const table = await screen.findByRole('table', { name: 'Versions' });
    const live3 = within(row(/Version 3/));
    expect(live3.getByText('Live')).toBeVisible();
    expect(live3.getByText('Aug 5, 2026')).toBeVisible();
    expect(live3.getByText('Note 3')).toBeVisible();
    expect(live3.getByText('1 observation')).toBeVisible();
    expect(within(row(/Version 2/)).getByText('Retired')).toBeVisible();
    expect(within(row(/Version 2/)).getByText('12 observations')).toBeVisible();
    expect(within(row(/Version 4/)).getByText('Draft')).toBeVisible();
    expect(within(row(/Version 4/)).getByText('Not yet')).toBeVisible();
    expect(within(table).getByRole('link', { name: 'Edit version 4' })).toHaveAttribute('href', '/committee/templates/draft');
    expect(within(table).getByRole('link', { name: 'View version 3' })).toHaveAttribute('href', '/committee/templates/10');
    expect(screen.getByText('Only one draft at a time.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start a new draft' })).toBeDisabled();
  });
  it('offers to start a draft when there is none', async () => {
    serve([live, retired]);
    open();
    expect(await screen.findByRole('link', { name: 'Start a new draft' })).toHaveAttribute('href', '/committee/templates/draft');
    expect(screen.queryByText('Only one draft at a time.')).not.toBeInTheDocument();
  });
  it('shows loading, then an error with Try again that recovers', async () => {
    let attempts = 0;
    server.use(http.get('*/api/templates', () => (++attempts === 1 ? failure(503, 'DOWN', 'Templates unavailable') : HttpResponse.json([live]))));
    open();
    expect(screen.getByRole('status')).toHaveTextContent('Loading templates');
    expect(await screen.findByRole('alert')).toHaveTextContent('Templates unavailable');
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Versions' })).toBeVisible();
  });
  it('says so when there are no versions', async () => {
    serve([]);
    open();
    expect(await screen.findByText('No template versions yet.')).toBeVisible();
  });
});

describe('version view (A5a)', () => {
  it('shows the questions and rating scales read only', async () => {
    serve([draft, live, retired]);
    open('/committee/templates/10');
    const table = await screen.findByRole('table', { name: 'Version 3 questions' });
    expect(within(table).getByText('Clarity')).toBeVisible();
    expect(within(table).getByText('Wording for Pacing')).toBeVisible();
    expect(within(table).getAllByText('1 Poor to 5 Excellent')).toHaveLength(2);
    expect(within(table).getByText('Any other comments')).toBeVisible();
    expect(screen.getByText(/It cannot be edited/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to templates' })).toHaveAttribute('href', '/committee/templates');
  });
  it('sends the draft to the editor and an unknown version to the list', async () => {
    serve([draft, live]);
    const first = open('/committee/templates/11');
    expect(await screen.findByRole('button', { name: 'Preview' })).toBeVisible();
    first.unmount();
    open('/committee/templates/999');
    expect(await screen.findByRole('table', { name: 'Versions' })).toBeVisible();
  });
});

async function openDraft(versions = [draft, live, retired]) {
  const log = serve(versions);
  const u = user();
  const view = open('/committee/templates/draft');
  await screen.findByRole('button', { name: 'Edit Clarity' });
  return { log, u, ...view };
}
const editDialog = () => screen.getByRole('dialog', { name: /question/i });

describe('draft editing (A5b, A5c)', () => {
  it('shows the saved draft and its live version', async () => {
    await openDraft();
    expect(screen.getByText(/Editing a draft of version 4/)).toBeVisible();
    expect(screen.getByText(/Version 3 is live, published Aug 5, 2026/)).toBeVisible();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });
  it('keeps edits until saved and sends the backend body with orderNo', async () => {
    const { log, u } = await openDraft();
    await u.click(screen.getByRole('button', { name: 'Edit Clarity' }));
    const dialog = within(editDialog());
    await u.clear(dialog.getByLabelText('Wording observers see'));
    await u.type(dialog.getByLabelText('Wording observers see'), 'Was it clear?');
    await u.clear(dialog.getByLabelText('Highest score'));
    await u.type(dialog.getByLabelText('Highest score'), '4');
    await u.click(dialog.getByRole('button', { name: 'Okay' }));
    expect(screen.getByText('Was it clear?')).toBeVisible();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    await u.click(screen.getByRole('checkbox', { name: 'Pacing required' }));
    expect(log.posts).toHaveLength(0);

    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    await u.type(screen.getByLabelText('What changed'), '  Shorter scale  ');
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and exit' }));
    expect(await screen.findByRole('table', { name: 'Versions' })).toBeVisible();
    expect(log.posts).toEqual([{
      changeNote: 'Shorter scale',
      questions: [
        { orderNo: 1, title: 'Clarity', wording: 'Was it clear?', ratingMin: 1, ratingMax: 4, minLabel: 'Poor', maxLabel: 'Excellent', isRequired: true },
        { orderNo: 2, title: 'Pacing', wording: 'Wording for Pacing', ratingMin: 1, ratingMax: 5, minLabel: 'Poor', maxLabel: 'Excellent', isRequired: false },
      ],
    }]);
  });
  it('adds a question at the end and removes one', async () => {
    const { log, u } = await openDraft();
    await u.click(screen.getByRole('button', { name: 'Add question' }));
    let dialog = within(editDialog());
    expect(dialog.queryByRole('button', { name: 'Delete question' })).not.toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Okay' })).toBeDisabled();
    await u.type(dialog.getByLabelText('Question'), 'Preparation');
    await u.type(dialog.getByLabelText('Wording observers see'), 'Was the class prepared?');
    await u.click(dialog.getByRole('button', { name: 'Okay' }));
    expect(screen.getByRole('button', { name: 'Edit Preparation' })).toBeVisible();

    await u.click(screen.getByRole('button', { name: 'Edit Clarity' }));
    dialog = within(editDialog());
    await u.click(dialog.getByRole('button', { name: 'Delete question' }));
    expect(screen.queryByRole('button', { name: 'Edit Clarity' })).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and exit' }));
    await screen.findByRole('table', { name: 'Versions' });
    expect(log.posts[0].questions.map((q) => [q.orderNo, q.title])).toEqual([[1, 'Pacing'], [2, 'Preparation']]);
  });
  it('blocks a question without text or with a range that does not go up', async () => {
    const { u } = await openDraft();
    await u.click(screen.getByRole('button', { name: 'Edit Clarity' }));
    const dialog = within(editDialog());
    await u.clear(dialog.getByLabelText('Question'));
    expect(dialog.getByRole('button', { name: 'Okay' })).toBeDisabled();
    await u.type(dialog.getByLabelText('Question'), 'Clarity');
    expect(dialog.getByRole('button', { name: 'Okay' })).toBeEnabled();
    await u.clear(dialog.getByLabelText('Highest score'));
    await u.type(dialog.getByLabelText('Highest score'), '1');
    expect(dialog.getByRole('button', { name: 'Okay' })).toBeDisabled();
    expect(dialog.getByRole('alert')).toHaveTextContent('highest score above the lowest');
    await u.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });
  it('cannot save a template without questions', async () => {
    const { u } = await openDraft();
    for (const title of ['Clarity', 'Pacing']) {
      await u.click(screen.getByRole('button', { name: `Edit ${title}` }));
      await u.click(within(editDialog()).getByRole('button', { name: 'Delete question' }));
    }
    expect(screen.getByRole('alert')).toHaveTextContent('A template needs at least one question.');
    expect(screen.getByRole('button', { name: 'Save and exit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save and publish' })).toBeDisabled();
  });
  it('starts a new draft as a copy of the live version, not saved until asked', async () => {
    const { log, u } = await openDraft([live, retired]);
    expect(screen.getByText(/starts as a copy of version 3 and is not saved yet/)).toBeVisible();
    expect(screen.getByText(/Editing a draft of version 4/)).toBeVisible();
    expect(log.posts).toHaveLength(0);
    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and exit' }));
    await screen.findByRole('table', { name: 'Versions' });
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].questions.map((q) => q.title)).toEqual(['Clarity', 'Pacing']);
  });
  it('shows the server message and keeps the edits when saving fails', async () => {
    const { u } = await openDraft();
    server.use(http.post('*/api/templates', () => failure(400, 'INVALID_TEMPLATE', 'Question 1 needs a wording.')));
    await u.click(screen.getByRole('checkbox', { name: 'Pacing required' }));
    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and exit' }));
    expect(await screen.findByText('Question 1 needs a wording.')).toHaveAttribute('role', 'alert');
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Pacing required' })).not.toBeChecked();
  });
  it('sends the save once under repeated clicks', async () => {
    const { u } = await openDraft();
    const posts = vi.fn();
    server.use(http.post('*/api/templates', () => { posts(); return never(); }));
    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    const save = within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and exit' });
    await u.dblClick(save);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
    expect(posts).toHaveBeenCalledOnce();
  });
});

describe('what changed (A5e)', () => {
  it('lists added, removed and changed questions against the live version', async () => {
    const { u } = await openDraft();
    await u.click(screen.getByRole('button', { name: 'Edit Pacing' }));
    await u.click(within(editDialog()).getByRole('button', { name: 'Delete question' }));
    await u.click(screen.getByRole('button', { name: 'Edit Clarity' }));
    await u.type(within(editDialog()).getByLabelText('Wording observers see'), ' now');
    await u.click(within(editDialog()).getByRole('button', { name: 'Okay' }));
    await u.click(screen.getByRole('button', { name: 'Add question' }));
    await u.type(within(editDialog()).getByLabelText('Question'), 'Preparation');
    await u.type(within(editDialog()).getByLabelText('Wording observers see'), 'Prepared?');
    await u.click(within(editDialog()).getByRole('button', { name: 'Okay' }));
    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    const dialog = within(screen.getByRole('dialog', { name: 'What changed?' }));
    expect(dialog.getByText('Compared with version 3')).toBeVisible();
    expect(dialog.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Added: Preparation', 'Removed: Pacing', 'Changed: Clarity']);
  });
  it('says there are no changes for an untouched draft', async () => {
    const { u } = await openDraft();
    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    expect(within(screen.getByRole('dialog')).getByText('No changes yet.')).toBeVisible();
  });
  it('describes changes without a live version as nothing to compare', () => {
    expect(describeChanges(undefined, [])).toEqual([]);
  });
});

describe('preview (A5d)', () => {
  it('shows unsaved edits, marks changed questions, and Back to editing keeps them', async () => {
    const { u } = await openDraft();
    await u.click(screen.getByRole('button', { name: 'Edit Clarity' }));
    await u.type(within(editDialog()).getByLabelText('Wording observers see'), ' edited');
    await u.click(within(editDialog()).getByRole('button', { name: 'Okay' }));
    await u.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Wording for Clarity edited')).toBeVisible();
    expect(screen.getAllByText('Changed in v4')).toHaveLength(1);
    expect(screen.getByRole('radiogroup', { name: 'Clarity' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Any other comments' })).toBeVisible();
    await u.click(within(screen.getByRole('radiogroup', { name: 'Pacing' })).getByLabelText('3'));
    expect(within(screen.getByRole('radiogroup', { name: 'Pacing' })).getByLabelText('3')).toBeChecked();
    await u.click(screen.getByRole('link', { name: 'Back to editing' }));
    expect(await screen.findByText('Wording for Clarity edited')).toBeVisible();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
  });
  it('sends a visit with nothing to preview to the list', async () => {
    serve([retired]);
    open('/committee/templates/draft/preview');
    expect(await screen.findByRole('table', { name: 'Versions' })).toBeVisible();
  });
});

describe('leaving with unsaved edits', () => {
  it('warns, lets the user stay, and discards when they leave', async () => {
    const { u, router } = await openDraft();
    await u.click(screen.getByRole('checkbox', { name: 'Pacing required' }));
    await act(async () => { void router.navigate('/elsewhere'); });
    const dialog = within(await screen.findByRole('dialog', { name: 'Leave without saving?' }));
    await u.click(dialog.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/committee/templates/draft');
    expect(screen.getByText('Unsaved changes')).toBeVisible();

    await act(async () => { void router.navigate('/elsewhere'); });
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave and discard' }));
    expect(await screen.findByText('Elsewhere')).toBeVisible();
  });
  it('does not warn without edits, or when moving between the editor and the preview', async () => {
    const { u, router } = await openDraft();
    await u.click(screen.getByRole('checkbox', { name: 'Pacing required' }));
    await u.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('link', { name: 'Back to editing' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await u.click(screen.getByRole('link', { name: 'Back to editing' }));
    await screen.findByRole('button', { name: 'Edit Clarity' });
    await u.click(screen.getByRole('checkbox', { name: 'Pacing required' }));
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    await act(async () => { void router.navigate('/elsewhere'); });
    expect(await screen.findByText('Elsewhere')).toBeVisible();
  });
  it('does not warn after saving', async () => {
    const { u, router } = await openDraft();
    await u.click(screen.getByRole('checkbox', { name: 'Pacing required' }));
    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and exit' }));
    await screen.findByRole('table', { name: 'Versions' });
    expect(router.state.location.pathname).toBe('/committee/templates');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('publishing a draft', () => {
  async function publishDialog(u: ReturnType<typeof user>) {
    await u.click(screen.getByRole('button', { name: 'Save and publish' }));
    return within(screen.getByRole('dialog', { name: 'Publish version 4?' }));
  }
  it('explains the effect and publishes an unedited draft with an empty note', async () => {
    const { log, u, router } = await openDraft();
    const dialog = await publishDialog(u);
    expect(dialog.getByText(/goes live and version 3 is retired/)).toBeVisible();
    expect(dialog.getByText(/Observations that are already assigned keep the version they were assigned/)).toBeVisible();
    await u.click(dialog.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/committee/templates'));
    expect(log.posts).toHaveLength(0);
    expect(log.publishes).toEqual([{ versionId: '11', body: { changeNote: '' } }]);
    expect(await screen.findByText('Live')).toBeVisible();
  });
  it('saves edits first, then publishes the saved draft with the typed note', async () => {
    const { log, u, router } = await openDraft();
    await u.click(screen.getByRole('checkbox', { name: 'Pacing required' }));
    const dialog = await publishDialog(u);
    expect(dialog.getByText('Changed: Pacing')).toBeVisible();
    await u.type(dialog.getByLabelText('What changed (optional)'), 'Pacing is optional');
    await u.click(dialog.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/committee/templates'));
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].changeNote).toBe('Pacing is optional');
    expect(log.publishes).toEqual([{ versionId: '12', body: { changeNote: 'Pacing is optional' } }]);
  });
  it('sends one save and one publish under repeated clicks', async () => {
    const { log, u } = await openDraft();
    const patches = vi.fn();
    server.use(http.patch('*/api/templates/:versionId/publish', () => { patches(); return never(); }));
    const dialog = await publishDialog(u);
    await u.dblClick(dialog.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled());
    expect(patches).toHaveBeenCalledOnce();
    expect(log.posts).toHaveLength(0);
  });
  it('shows a publish failure, and the retry publishes the saved draft without saving again', async () => {
    const { log, u, router } = await openDraft();
    await u.click(screen.getByRole('checkbox', { name: 'Pacing required' }));
    let failing = true;
    server.use(http.patch('*/api/templates/:versionId/publish', async ({ params }) => {
      log.publishes.push({ versionId: String(params.versionId), body: null });
      return failing ? failure(409, 'NOT_DRAFT', 'Only a draft can be published.') : HttpResponse.json(live);
    }));
    const dialog = await publishDialog(u);
    await u.click(dialog.getByRole('button', { name: 'Save and publish' }));
    expect(await dialog.findByText('Only a draft can be published.')).toHaveAttribute('role', 'alert');
    expect(dialog.getByText(/Your draft was saved/)).toBeVisible();
    expect(log.posts).toHaveLength(1);
    failing = false;
    await u.click(dialog.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/committee/templates'));
    expect(log.posts).toHaveLength(1);
    expect(log.publishes.map((p) => p.versionId)).toEqual(['12', '12']);
  });
  it('closes without publishing on Cancel', async () => {
    const { log, u } = await openDraft();
    const dialog = await publishDialog(u);
    await u.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(log.publishes).toHaveLength(0);
  });
});

describe('permission', () => {
  it.each([
    '/committee/templates',
    '/committee/templates/10',
    '/committee/templates/draft',
    '/committee/templates/draft/preview',
  ])('sends a faculty-only user from %s to My evaluation without asking for templates', async (path) => {
    const log = serve([live]);
    server.use(http.get('*/api/me', () => HttpResponse.json({ ...faculty, email: 'maya.lin@demo.edu', department: { deptId: '1', deptName: 'Computer Science' }, role: 'faculty' } satisfies Me)));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:test' }));
    const { router } = renderRoutes([{
      element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
      children: [
        { path: '/committee/templates', element: <TemplatesLayout />, children: [
          { index: true, element: <TemplatesPage />, handle: { title: 'Observation templates' } },
          { path: 'draft', element: <DraftPage />, handle: { title: 'Edit draft' } },
          { path: 'draft/preview', element: <PreviewPage />, handle: { title: 'Preview' } },
          { path: ':versionId', element: <VersionPage />, handle: { title: 'Template version' } },
        ] },
        { path: '/faculty/evaluation', element: <p>My evaluation page</p>, handle: { title: 'My evaluation' } },
      ],
    }], path);
    expect(await screen.findByText('My evaluation page')).toBeVisible();
    expect(router.state.location.pathname).toBe('/faculty/evaluation');
    expect(log.reads).toBe(0);
  });
});

describe('review follow-ups', () => {
  it('lets the first template be created when no version exists', async () => {
    const log = serve([]);
    const u = user();
    open();
    await u.click(await screen.findByRole('link', { name: 'Start a new draft' }));
    expect(await screen.findByText('This is the first template. Add questions, then save it.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save and exit' })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Add question' }));
    await u.type(within(editDialog()).getByLabelText('Question'), 'Clarity');
    await u.type(within(editDialog()).getByLabelText('Wording observers see'), 'Was it clear?');
    await u.click(within(editDialog()).getByRole('button', { name: 'Okay' }));
    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and exit' }));
    await screen.findByRole('table', { name: 'Versions' });
    expect(log.posts).toHaveLength(1);
    expect(log.posts[0].questions).toEqual([{ orderNo: 1, title: 'Clarity', wording: 'Was it clear?', ratingMin: 1, ratingMax: 5, minLabel: 'Poor', maxLabel: 'Excellent', isRequired: true }]);
  });
  it('ignores Escape and Cancel while a save is in flight', async () => {
    const { u } = await openDraft();
    server.use(http.post('*/api/templates', () => never()));
    await u.click(screen.getByRole('checkbox', { name: 'Pacing required' }));
    await u.click(screen.getByRole('button', { name: 'Save and exit' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and exit' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
    await u.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'What changed?' })).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
  it('ignores Escape while a publish is in flight', async () => {
    const { u } = await openDraft();
    server.use(http.patch('*/api/templates/:versionId/publish', () => never()));
    await u.click(screen.getByRole('button', { name: 'Save and publish' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled());
    await u.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Publish version 4?' })).toBeVisible();
  });
});
