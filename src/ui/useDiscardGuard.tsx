import { useEffect, useState, type ReactNode } from 'react';
import { setLeaveGuard } from '../hooks';
import { Dialog } from './components';

/**
 * For a form: while `dirty`, leaving it by any route (Cancel, the Back arrow, the phone's back gesture,
 * reloading) asks first. Render the returned element inside the form. A navigation that must not ask, after
 * saving or deleting, passes `force` to `go`.
 */
export function useDiscardGuard(dirty: boolean, message: string): ReactNode {
  const [leave, setLeave] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (!dirty) return;
    // closing or reloading the page: only the browser's own question is possible
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    const release = setLeaveGuard((proceed) => setLeave(() => proceed));
    return () => { window.removeEventListener('beforeunload', onUnload); release(); };
  }, [dirty]);
  return (
    <Dialog open={leave !== null} title="Discard changes?" onClose={() => setLeave(null)}
      actions={<>
        <button type="button" className="btn text" onClick={() => setLeave(null)}>Keep editing</button>
        <button type="button" className="btn tonal" onClick={() => { setLeave(null); leave?.(); }}>Discard</button>
      </>}>
      {message}
    </Dialog>
  );
}
