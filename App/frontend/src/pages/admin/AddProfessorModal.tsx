import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { AdminProfessor, Department } from '../../api/types';
import { Button, Modal, inputClass, labelClass } from '../../components/ui';

interface Props {
  onClose: () => void;
  onCreated: (professor: AdminProfessor) => void;
}

export function AddProfessorModal({ onClose, onCreated }: Props) {
  const queryClient = useQueryClient();
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const departments = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => api<Department[]>('/admin/departments'),
  });

  const close = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;

    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();

    const body = {
      firstName: text('firstName'),
      lastName: text('lastName'),
      netid: text('netid').toLowerCase(),
      email: text('email'),
      deptId: text('deptId'),
      rank: text('rank'),
    };

    if (!body.firstName || !body.lastName) {
      setError('First name and last name are required.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError('');

    let created: AdminProfessor;

    try {
      created = await api<AdminProfessor>('/admin/professors', {
        method: 'POST',
        body,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not add the professor. Please try again.',
      );
      savingRef.current = false;
      setSaving(false);
      return;
    }

    queryClient.setQueryData<AdminProfessor[]>(
      ['admin', 'professors'],
      (previous) =>
        [...(previous ?? []).filter((p) => p.netid !== created.netid), created]
          .sort(
            (a, b) =>
              a.lastName.localeCompare(b.lastName) ||
              a.firstName.localeCompare(b.firstName) ||
              a.netid.localeCompare(b.netid),
          ),
    );

    void queryClient.invalidateQueries({
      queryKey: ['admin', 'professors'],
    });

    savingRef.current = false;
    setSaving(false);
    onCreated(created);
  }

  const canSave =
    departments.isSuccess && departments.data.length > 0 && !saving;

  return (
    <Modal
      title="Add Professor"
      subtitle="New professors start in the next term."
      onClose={close}
      width={480}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-professor-form"
            disabled={!canSave}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      {departments.isPending && (
        <p role="status" className="mb-4 text-sm text-gray-500">
          Loading departments...
        </p>
      )}

      {departments.isError && (
        <div className="mb-4">
          <p role="alert" className="text-sm text-red-700">
            Could not load departments.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            onClick={() => void departments.refetch()}
          >
            Try again
          </Button>
        </div>
      )}

      {departments.isSuccess && departments.data.length === 0 && (
        <p role="alert" className="mb-4 text-sm text-red-700">
          No departments are available. Add a department before adding professors.
        </p>
      )}

      <form id="add-professor-form" onSubmit={handleSubmit}>
        <fieldset disabled={saving} className="space-y-4">
          <div>
            <label htmlFor="professor-first-name" className={labelClass}>
              First Name
            </label>
            <input
              id="professor-first-name"
              name="firstName"
              required
              autoComplete="given-name"
              className={`${inputClass} w-full`}
            />
          </div>

          <div>
            <label htmlFor="professor-last-name" className={labelClass}>
              Last Name
            </label>
            <input
              id="professor-last-name"
              name="lastName"
              required
              autoComplete="family-name"
              className={`${inputClass} w-full`}
            />
          </div>

          <div>
            <label htmlFor="professor-netid" className={labelClass}>
              NetID
            </label>
            <input
              id="professor-netid"
              name="netid"
              required
              pattern="[A-Za-z]{3}[0-9]{6}"
              title="Three letters followed by six digits, like abc123456."
              placeholder="abc123456"
              className={`${inputClass} w-full`}
            />
          </div>

          <div>
            <label htmlFor="professor-email" className={labelClass}>
              Email
            </label>
            <input
              id="professor-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className={`${inputClass} w-full`}
            />
          </div>

          <div>
            <label htmlFor="professor-department" className={labelClass}>
              Department
            </label>
            <select
              id="professor-department"
              name="deptId"
              required
              defaultValue=""
              disabled={!departments.isSuccess}
              className={`${inputClass} w-full`}
            >
              <option value="" disabled>Select a department</option>
              {departments.data?.map((department) => (
                <option key={department.deptId} value={department.deptId}>
                  {department.deptName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="professor-rank" className={labelClass}>
              Rank
            </label>
            <select
              id="professor-rank"
              name="rank"
              required
              defaultValue="assistant"
              className={`${inputClass} w-full`}
            >
              <option value="assistant">Assistant</option>
              <option value="associate">Associate</option>
              <option value="full">Full</option>
            </select>
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}