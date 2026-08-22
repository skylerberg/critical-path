// Dev-only (NOT shipped). The props scripts/task-detail-probe.ts mounts the
// overlay with, reactive so that moving `taskId` is a prop change on the mounted
// component rather than a remount — which is the whole gesture under test, and
// the one a remount would erase. Runes only compile in a .svelte.ts module, so
// this cannot live in the probe entry.
export interface ProbeProps {
  taskId: string;
  closePath: string;
  taskPath: (id: string) => string;
}

export function switchableProps(taskId: string): ProbeProps {
  // Returned off the declaration, never the object handed to $state: the proxy is
  // what a later write goes through, and the raw object keeps what it was built
  // with.
  const props: ProbeProps = $state({
    taskId,
    closePath: '/p/probe',
    taskPath: (id: string) => `/t/${id}`,
  });
  return props;
}
