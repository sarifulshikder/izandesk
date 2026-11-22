'use client';

import { useRef } from 'react';
import { useServerInsertedHTML } from 'next/navigation';

// Mirrors the saved theme from localStorage onto <html> while the initial HTML
// is parsed, before the browser paints (no light/dark flash). Using
// useServerInsertedHTML here rather than a literal <script> in the layout avoids
// React's development warning that client-rendered script tags never execute.
// The guard is required because the callback runs on every HTML flush.
//
// This is a one-time, initial-document concern: the class persists across
// client navigations, so not re-running the script there is intentional.
const THEME_SCRIPT = `try{var t=localStorage.getItem('izandesk_theme');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.classList.remove('light')}else{document.documentElement.classList.add('light');document.documentElement.classList.remove('dark')}}catch(e){}`;

export function ThemeScript() {
  const inserted = useRef(false);

  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
  });

  return null;
}
