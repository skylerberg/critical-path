import { subscribeBus } from '../../src/services/realtime/bus';
import type { BusEntry } from '../../src/services/realtime/bus';

// Every entry published while `run` is in flight, in publish order. Subscribing
// is what makes an assertion about *not* publishing possible: the delivery layer
// drops an entry nobody may receive, so an over-broad publish and a correct one
// both look like silence from a socket.
export async function collectBusEntries(run: () => Promise<void>): Promise<BusEntry[]> {
  const seen: BusEntry[] = [];
  const unsubscribe = subscribeBus((entry) => seen.push(entry));
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return seen;
}
