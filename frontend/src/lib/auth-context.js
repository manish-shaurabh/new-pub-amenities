import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const login = async (employeeId, password) => {
    const response = await authAPI.login({ employee_id: employeeId, password });
    const { token, user: userData } = response.data;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    return userData;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const isAdmin = () => {
    return user?.role === 'superadmin' || user?.role === 'admin';
  };

  const isSuperadmin = () => {
    return user?.role === 'superadmin';
  };

  const canApprove = () => {
    return ['superadmin', 'admin', 'approving_supervisor'].includes(user?.role);
  };

  const canInspect = () => {
    return ['superadmin', 'admin', 'reporting_officer', 'approving_supervisor', 'supervisor'].includes(user?.role);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isSuperadmin, canApprove, canInspect }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
