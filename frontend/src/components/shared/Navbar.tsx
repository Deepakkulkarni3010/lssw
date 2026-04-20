import { Link, useLocation } from 'react-router-dom';
import { Search, Bookmark, Clock, Settings, LogOut, Linkedin } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../api/client';

const navItems = [
  { to: '/search',  label: 'Search',   icon: Search },
  { to: '/saved',   label: 'Saved',    icon: Bookmark },
  { to: '/history', label: 'History',  icon: Clock },
  { to: '/settings',label: 'Settings', icon: Settings },
];

export default function Navbar() {
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    await authApi.logout().catch(() => {});
    logout();
    window.location.href = '/';
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link to="/search" className="flex items-center gap-2 text-linkedin-500 font-bold text-lg">
            <Linkedin className="w-6 h-6" />
            <span className="hidden sm:block">Smart Search</span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === to
                    ? 'bg-linkedin-50 text-linkedin-500'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:block">{label}</span>
              </Link>
            ))}
          </div>

          {/* User menu */}
          <div className="flex items-center gap-3">
            {user?.profilePic && (
              <img
                src={user.profilePic}
                alt={user.fullName}
                className="w-8 h-8 rounded-full border border-gray-200"
              />
            )}
            <span className="hidden md:block text-sm text-gray-700 font-medium">
              {user?.fullName?.split(' ')[0]}
            </span>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
