import { AccessRole } from '../batches/batch-models';

export function reportNavigation(role: AccessRole) {
  const base = ['/', role];
  return {
    batches: [...base, 'batches'],
    comparison: [...base, 'comparison'],
    customers: [...base, 'customers'],
    streams: [...base, 'streams'],
    newStream: [...base, 'streams', 'new'],
    streamDetails: (streamId: string) => [...base, 'streams', streamId],
    batchReport: (batchId: string) => [...base, 'batches', batchId, 'report'],
    callReport: (batchId: string, callId: string) => [...base, 'batches', batchId, 'calls', callId],
  };
}
