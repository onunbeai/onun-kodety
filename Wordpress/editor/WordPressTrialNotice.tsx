import { useEffect, useState } from 'react';
import { WORDPRESS_LICENSE_CHANGED } from './wordpress-trial-runtime';

export function useWordPressLicenseRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision(value => value + 1);
    window.addEventListener(WORDPRESS_LICENSE_CHANGED, changed);
    return () => window.removeEventListener(WORDPRESS_LICENSE_CHANGED, changed);
  }, []);
  return revision;
}

/** Retained export for existing workspace shells; there are no paid trials. */
export function WordPressTrialNotice() { return null; }
