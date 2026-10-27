import { useParams } from 'react-router';
import { useObservation } from '../../api/hooks/faculty';
import { useMe } from '../../api/hooks/shared';

/** The observation in the URL and the signed-in professor, shared by the form, signature and record pages. */
export function useObservationRecord() {
  const { observationId } = useParams();
  const me = useMe();
  const observation = useObservation(observationId);
  const record = observation.data;
  const isObserver = Boolean(record && me.data && record.observer.netid === me.data.netid);
  return { observation, record, isObserver, me };
}
