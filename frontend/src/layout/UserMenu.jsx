import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { initials } from '../utils.js';

export default function UserMenu() {
  const { session, setPage, logout } = useWorkspace();
  const { themePreference, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-menu-trigger" onClick={() => setOpen((current) => !current)}>
        <span className="avatar">{initials(session.user?.name)}</span>
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <button type="button" onClick={() => { setPage('settings'); setOpen(false); }}>Profile</button>
          <button type="button" onClick={() => { setPage('settings'); setOpen(false); }}>Settings</button>
          <button type="button" onClick={() => { toggleTheme(); setOpen(false); }}>Theme: {themePreference === 'system' ? 'System' : themePreference === 'dark' ? 'Dark' : 'Light'}</button>
          <button type="button" onClick={() => { setOpen(false); logout(); }}>Logout</button>
        </div>
      )}
    </div>
  );
}
