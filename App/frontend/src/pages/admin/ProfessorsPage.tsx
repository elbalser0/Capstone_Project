import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { AdminProfessor } from '../../api/types';
import { Button, inputClass } from '../../components/ui';
import { AddProfessorModal } from './AddProfessorModal';
import { UpdateProfessorModal, type ProfessorAction,} from './UpdateProfessorModal';

const rankLabels = {
  assistant: 'Assistant',
  associate: 'Associate',
  full: 'Full',
};

type SortField = 'firstName' | 'lastName';
type RankFilter = 'all' | AdminProfessor['rank'];
type AcFilter = 'all' | 'yes' | 'no';

const compareText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

export function ProfessorsPage() {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('lastName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedNetid, setSelectedNetid] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<{ professor: AdminProfessor; action: ProfessorAction;} | null>(null);

  const closeEdit = useCallback(() => setEditing(null), []);

  const handleUpdated = useCallback((professor: AdminProfessor) => {
    setEditing(null);
    setSelectedNetid(professor.netid);
    setSuccess(`${professor.firstName} ${professor.lastName} was updated.`);
  }, []);

  const closeAdd = useCallback(() => setShowAdd(false), []);

  const handleCreated = useCallback((professor: AdminProfessor) => {
    setShowAdd(false);
    setSearch('');
    setRankFilter('all');
    setAcFilter('all');
    setDepartmentFilter('all');
    setSelectedNetid(professor.netid);
    setSuccess(`${professor.firstName} ${professor.lastName} was added.`);
  }, []);

  const [showFilters, setShowFilters] = useState(false);
  const [rankFilter, setRankFilter] = useState<RankFilter>('all');
  const [acFilter, setAcFilter] = useState<AcFilter>('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
    const professors = useQuery({
      queryKey: ['admin', 'professors'],
      queryFn: () => api<AdminProfessor[]>('/admin/professors'),
    });

  const query = search.trim().toLowerCase();

  const departments = Array.from(
    new Map(
      (professors.data ?? []).map((professor) => [
        professor.department.deptId,
        professor.department,
      ]),
    ).values(),
  ).sort((a, b) => compareText(a.deptName, b.deptName));

  const filtered = (professors.data ?? []).filter((professor) => {
    const matchesSearch = [
      professor.netid,
      professor.firstName,
      professor.lastName,
      professor.displayName,
    ].some((value) => value.toLowerCase().includes(query));

    const matchesRank =
      rankFilter === 'all' || professor.rank === rankFilter;

    const matchesAc =
      acFilter === 'all' ||
      professor.isAc === (acFilter === 'yes');

    const matchesDepartment =
      departmentFilter === 'all' ||
      professor.department.deptId === departmentFilter;

    return (
      matchesSearch &&
      matchesRank &&
      matchesAc &&
      matchesDepartment
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const comparison = compareText(a[sortField], b[sortField]);

    return (
      (sortDirection === 'asc' ? comparison : -comparison) ||
      compareText(a.lastName, b.lastName) ||
      compareText(a.firstName, b.firstName) ||
      compareText(a.netid, b.netid)
    );
  });

  // Only a professor visible in the table can be managed.
  const selected = filtered.find(
    (professor) => professor.netid === selectedNetid,
  );

  const activeFilterCount =
    Number(rankFilter !== 'all') +
    Number(acFilter !== 'all') +
    Number(departmentFilter !== 'all');

  function resetFiltersAndSort() {
    setRankFilter('all');
    setAcFilter('all');
    setDepartmentFilter('all');
    setSortField('lastName');
    setSortDirection('asc');
    setSelectedNetid(null);
  }

  if (professors.isPending) {
    return (
      <p role="status" className="text-sm text-gray-500">
        Loading professors...
      </p>
    );
  }

  if (professors.isError) {
    return (
      <div>
        <p role="alert" className="text-sm text-red-700">
          Could not load professors.
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => void professors.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <section aria-label="Professor management">
      <div className="max-w-[480px]">
        <label htmlFor="professor-search" className="sr-only">
          Search professors by name or NetID
        </label>
        <input
          id="professor-search"
          type="search"
          className={`${inputClass} w-full`}
          placeholder="Search by name or NetID..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setSelectedNetid(null);
          }}
        />
      </div>

      <div className="mb-3 mt-8 flex flex-wrap gap-3">
        <Button type="button" onClick={() => { setSuccess(''); setShowAdd(true); }} >  + Add Professor </Button>
        <Button type="button" disabled={!selected || !selected.isActive} onClick={() => {
            if (!selected) return;
            setSuccess('');
            setEditing({ professor: selected, action: 'rank' });
          }} > Change Rank
        </Button>

        <Button type="button" disabled={!selected || selected.isAc || !selected.isActive} onClick={() => {
            if (!selected) return;
            setSuccess('');
            setEditing({ professor: selected, action: 'assignAc' });
          }} > Assign AC
        </Button>

        <Button type="button" disabled={!selected || !selected.isAc} onClick={() => {
            if (!selected) return;
            setSuccess('');
            setEditing({ professor: selected, action: 'deactivateAc' });
          }} > Deactivate AC
        </Button>

        <Button
          type="button"  disabled={!selected || !selected.isActive} onClick={() => {
          if (!selected) return;
          setSuccess('');
          setEditing({professor: selected,action: 'deactivateProfessor',});
          }} > Deactivate Professor
          </Button>

      </div>

      {success && (
        <p role="status" className="mb-4 text-sm text-green-700">
          {success}
        </p>
      )}

      <p aria-live="polite" className="mb-3 text-sm text-gray-600">
        {selected
          ? `Selected: ${selected.displayName}. Uncheck this professor to select another.`
          : 'Select one professor to manage their rank, AC membership, or active status.'}
      </p>

      <div className="mb-3 flex justify-end">
        <Button
          type="button"
          variant="secondary"
          aria-expanded={showFilters}
          aria-controls="professor-filter-panel"
          onClick={() => setShowFilters((current) => !current)}
        >
          Filter & Sort
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Button>
      </div>

      {showFilters && (
        <div
          id="professor-filter-panel"
          role="region"
          aria-label="Filter and sort professors"
          className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label
                htmlFor="professor-rank-filter"
                className="mb-1 block text-sm font-semibold"
              >
                Rank
              </label>
              <select
                id="professor-rank-filter"
                className={`${inputClass} w-full`}
                value={rankFilter}
                onChange={(event) => {
                  setRankFilter(event.target.value as RankFilter);
                  setSelectedNetid(null);
                }}
              >
                <option value="all">All ranks</option>
                <option value="assistant">Assistant</option>
                <option value="associate">Associate</option>
                <option value="full">Full</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="professor-ac-filter"
                className="mb-1 block text-sm font-semibold"
              >
                AC membership
              </label>
              <select
                id="professor-ac-filter"
                className={`${inputClass} w-full`}
                value={acFilter}
                onChange={(event) => {
                  setAcFilter(event.target.value as AcFilter);
                  setSelectedNetid(null);
                }}
              >
                <option value="all">All professors</option>
                <option value="yes">AC members</option>
                <option value="no">Not AC members</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="professor-department-filter"
                className="mb-1 block text-sm font-semibold"
              >
                Department
              </label>
              <select
                id="professor-department-filter"
                className={`${inputClass} w-full`}
                value={departmentFilter}
                onChange={(event) => {
                  setDepartmentFilter(event.target.value);
                  setSelectedNetid(null);
                }}
              >
                <option value="all">All departments</option>
                {departments.map((department) => (
                  <option
                    key={department.deptId}
                    value={department.deptId}
                  >
                    {department.deptName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="professor-sort"
                className="mb-1 block text-sm font-semibold"
              >
                Sort by
              </label>
              <select
                id="professor-sort"
                className={`${inputClass} w-full`}
                value={sortField}
                onChange={(event) =>
                  setSortField(event.target.value as SortField)
                }
              >
                <option value="firstName">First name</option>
                <option value="lastName">Last name</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="professor-sort-direction"
                className="mb-1 block text-sm font-semibold"
              >
                Order
              </label>
              <select
                id="professor-sort-direction"
                className={`${inputClass} w-full`}
                value={sortDirection}
                onChange={(event) =>
                  setSortDirection(event.target.value as 'asc' | 'desc')
                }
              >
                <option value="asc">Ascending (A–Z)</option>
                <option value="desc">Descending (Z–A)</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Changes apply immediately.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={resetFiltersAndSort}
            >
              Reset filters & sort
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Professors and their department, rank, AC membership, and status
          </caption>

          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              {[
                'Select',
                'NetID',
                'First Name',
                'Last Name',
                'Email',
                'Department',
                'Rank',
                'AC Member',
                'Status',
              ].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="border-b border-gray-200 px-3 py-3 font-semibold"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sorted.map((professor) => {
              const checked = selectedNetid === professor.netid;
              const blocked = Boolean(selected) && !checked;

              return (
                <tr
                  key={professor.netid}
                  className={`border-b border-gray-200 last:border-b-0 ${
                    checked ? 'bg-orange-50' : 'bg-white'
                  }`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${professor.displayName} (${professor.netid})`}
                      checked={checked}
                      disabled={blocked}
                      onChange={(event) =>
                        setSelectedNetid(
                          event.target.checked ? professor.netid : null,
                        )
                      }
                      className="size-4 accent-orange-700 disabled:cursor-not-allowed"
                    />
                  </td>

                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-3 font-semibold"
                  >
                    {professor.netid}
                  </th>
                  <td className="px-3 py-3">{professor.firstName}</td>
                  <td className="px-3 py-3">{professor.lastName}</td>
                  <td className="whitespace-nowrap px-3 py-3"> {professor.email} </td>
                  <td className="px-3 py-3"> {professor.department.deptName} </td>
                  <td className="px-3 py-3"> {rankLabels[professor.rank]} </td>
                  <td className="px-3 py-3"> {professor.isAc ? 'Yes' : 'No'} </td>
                  <td className="px-3 py-3"> {professor.isActive ? 'Active' : 'Inactive'} </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-gray-500"
                >
                  No professors found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Showing {filtered.length} of {professors.data?.length ?? 0} professors.
      </p>

            {showAdd && (
        <AddProfessorModal
          onClose={closeAdd}
          onCreated={handleCreated}
        />
      )}

            {editing && (
        <UpdateProfessorModal
          professor={editing.professor}
          action={editing.action}
          onClose={closeEdit}
          onUpdated={handleUpdated}
        />
      )}
    </section>
  );
}