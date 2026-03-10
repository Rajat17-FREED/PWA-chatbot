import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ChatWidget from './components/chat/ChatWidget';
import HomePage from './pages/HomePage';
import Dashboard from './pages/Dashboard';

function AppContent() {
  const { isLoggedIn } = useAuth();

  return (
    <>
      {isLoggedIn ? <Dashboard /> : <HomePage />}
      <ChatWidget />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}
