import { useParams } from 'react-router';
import { useObservation } from '../../api/hooks/faculty';
import { useMe } from '../../api/hooks/shared';

export function useObservationRecord() {
  const { observationId } = useParams();
  const profile = useMe();
  const record = useObservation(observationId);
  return { profile, record, observationId };
}
