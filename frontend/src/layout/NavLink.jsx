import { cx } from '../utils.js';

export default function NavLink({ active, children, onClick, className }) {
  return (
    <button
      type="button"
      className={cx('topnav-link', active && 'active', className)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
