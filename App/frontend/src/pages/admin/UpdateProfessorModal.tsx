import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { AdminProfessor } from '../../api/types';
import { Button, Modal, inputClass, labelClass } from '../../components/ui';

export type ProfessorAction = 'rank' | 'assignAc' | 'deactivateAc'| 'deactivateProfessor';

interface Props {
  professor: AdminProfessor;
  action: ProfessorAction;
  onClose: () => void;
  onUpdated: (professor: AdminProfessor) => void;
}

const rankLabels = {
  assistant: 'Assistant',
  associate: 'Associate',
  full: 'Full',
};

export function UpdateProfessorModal({
  professor,
  action,
  onClose,
  onUpdated,
}: Props) {
  const queryClient = useQueryClient();
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newRank, setNewRank] =
    useState<AdminProfessor['rank']>(professor.rank);

  const close = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);

  const title = {
    rank: 'Change Rank',
    assignAc: 'Assign AC Membership',
    deactivateAc: 'Deactivate AC Membership',
    deactivateProfessor: 'Deactivate Professor',
  }[action];

  const buttonLabel = {
    rank: 'Save',
    assignAc: 'Assign AC',
    deactivateAc: 'Deactivate AC',
    deactivateProfessor: 'Deactivate Professor',
  }[action];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setError('');

    const body =
      action === 'rank'
        ? { rank: newRank }
        : action === 'deactivateProfessor'
          ? { isActive: false }
          : { isAc: action === 'assignAc' };

    let updated: AdminProfessor;

    try {
      updated = await api<AdminProfessor>(
        `/admin/professors/${encodeURIComponent(professor.netid)}`,
        {
          method: 'PATCH',
          body,
        },
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not update the professor. Please try again.',
      );
      savingRef.current = false;
      setSaving(false);
      return;
    }

    queryClient.setQueryData<AdminProfessor[]>(
      ['admin', 'professors'],
      (previous) =>
        previous?.map((row) =>
          row.netid === updated.netid ? updated : row,
        ),
    );

    // Rank and membership can affect other views, including account details.
    void queryClient.invalidateQueries();

    savingRef.current = false;
    setSaving(false);
    onUpdated(updated);
  }

  return (
    <Modal
      title={title}
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
            form="update-professor-form"
            disabled={
              saving || (action === 'rank' && newRank === professor.rank)
            }
          >
            {saving ? 'Saving...' : buttonLabel}
          </Button>
        </>
      }
    >
      <form id="update-professor-form" onSubmit={handleSubmit}>
        <dl className="space-y-4">
          <div>
            <dt className={labelClass}>Selected Professor</dt>
            <dd className="rounded-md bg-gray-100 px-3 py-2 text-sm">
              {professor.firstName} {professor.lastName}
            </dd>
          </div>

          <div>
            <dt className={labelClass}>NetID</dt>
            <dd className="rounded-md bg-gray-100 px-3 py-2 text-sm">
              {professor.netid}
            </dd>
          </div>
        </dl>

        {action === 'rank' ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className={labelClass}>Current Rank</p>
              <p className="rounded-md bg-gray-100 px-3 py-2 text-sm">
                {rankLabels[professor.rank]}
              </p>
            </div>

            <div>
              <label htmlFor="professor-new-rank" className={labelClass}>
                New Rank
              </label>
              <select
                id="professor-new-rank"
                value={newRank}
                disabled={saving}
                onChange={(event) =>
                  setNewRank(event.target.value as AdminProfessor['rank'])
                }
                className={`${inputClass} w-full`}
              >
                <option value="assistant">Assistant</option>
                <option value="associate">Associate</option>
                <option value="full">Full</option>
              </select>
            </div>
          </div>
        ) : (
          <p className="mt-6 text-sm text-gray-700">
            {action === 'assignAc'
              ? 'Give this professor Assessment Committee access?'
              : action === 'deactivateProfessor'
                ? 'Deactivate this professor? Their status will become Inactive and any active AC membership will be deactivated. Their professor record and existing evaluation records will be retained.'
                : 'Remove this professor’s Assessment Committee access? Their professor account and existing records will remain active and unchanged.'}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}