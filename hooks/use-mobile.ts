import { useSyncExternalStore } from 'react';
const query = '(max-width: 767px)';
function subscribe(callback: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
const getSnapshot = () => window.matchMedia(query).matches;
const getServerSnapshot = () => false;
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
