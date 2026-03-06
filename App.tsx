
import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Users from './pages/Users';
import { useAuth } from './context/AuthContext';
import Photos from './pages/Photos';
import Tags from './pages/Tags';
import PropostaComercial from './src/features/PropostaComercial';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen">Carregando...</div>;
  }

  return user ? <>{children}</> : <Navigate to="/login" />;
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/usuarios" element={<ProtectedRoute><Users /></ProtectedRoute>} />

        <Route path="/fotos" element={<ProtectedRoute><Photos /></ProtectedRoute>} />
        <Route path="/tags" element={<ProtectedRoute><Tags /></ProtectedRoute>} />
        <Route path="/propostas" element={<ProtectedRoute><PropostaComercial /></ProtectedRoute>} />

        <Route path="/" element={<Navigate to="/fotos" />} />
      </Routes>
    </HashRouter>
  );
};

export default App;
