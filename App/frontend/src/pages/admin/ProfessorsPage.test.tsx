import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AdminProfessor } from '../../api/types';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { ProfessorsPage } from './ProfessorsPage';

// 23 professors, so the default page size of 10 gives three pages. Last names sort as Prof01..Prof23.
const roster: AdminProfessor[] = Array.from({ length: 23 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    netid: `p${n}`,
    firstName: `First${n}`,
    lastName: `Prof${n}`,
    displayName: `Dr. First${n} Prof${n}`,
    email: `p${n}@example.edu`,
    rank: 'assistant',
    department: { deptId: '1', deptName: 'Computer Science' },
    isAc: false,
    isActive: true,
  };
});

function open() {
  server.use(http.get('*/api/admin/professors', () => HttpResponse.json(roster)));
  return renderRoutes([{ path: '/admin', element: <ProfessorsPage /> }], '/admin');
}

/** NetIDs of the table's body rows, in order. */
const netids = () =>
  screen.getAllByRole('row').slice(1).map((row) => within(row).queryByRole('rowheader')?.textContent).filter(Boolean);
const pages = () => screen.getByRole('navigation', { name: 'Professor pages' });

describe('ProfessorsPage paging', () => {
  it('shows ten professors per page and moves between pages', async () => {
    const user = userEvent.setup();
    open();

    expect(await screen.findByText('1 to 10 of 23')).toBeInTheDocument();
    expect(netids()).toEqual(roster.slice(0, 10).map((p) => p.netid));

    await user.click(within(pages()).getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('11 to 20 of 23')).toBeInTheDocument();
    expect(netids()).toEqual(roster.slice(10, 20).map((p) => p.netid));

    await user.click(within(pages()).getByRole('button', { name: 'Page 3' }));
    expect(netids()).toEqual(['p21', 'p22', 'p23']);
  });

  it('returns to the first page when the search changes', async () => {
    const user = userEvent.setup();
    open();

    await user.click(within(await screen.findByRole('navigation', { name: 'Professor pages' })).getByRole('button', { name: 'Page 3' }));
    await user.type(screen.getByRole('searchbox'), 'Prof1');

    // Prof10..Prof19 match.
    expect(screen.getByText('1 to 10 of 10')).toBeInTheDocument();
    expect(netids()[0]).toBe('p10');
  });

  it('keeps a selected professor selected while paging', async () => {
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('checkbox', { name: /First02 Prof02/ }));
    expect(screen.getByRole('button', { name: 'Change Rank' })).toBeEnabled();

    await user.click(within(pages()).getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('button', { name: 'Change Rank' })).toBeEnabled();

    await user.click(within(pages()).getByRole('button', { name: 'Previous page' }));
    expect(screen.getByRole('checkbox', { name: /First02 Prof02/ })).toBeChecked();
  });

  it('shows no pager when nothing matches', async () => {
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByRole('searchbox'), 'nobody');
    expect(screen.getByText('No professors found.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Professor pages' })).not.toBeInTheDocument();
  });
});
