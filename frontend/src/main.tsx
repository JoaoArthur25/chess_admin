import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import App from './App';
import TournamentList from './pages/TournamentList';
import TournamentDetail from './pages/TournamentDetail';
import PublicStandings from './pages/PublicStandings';
import PrintView from './pages/PrintView';
import ResetPassword from './pages/ResetPassword';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <TournamentList /> },
      { path: 't/:id', element: <TournamentDetail /> },
      { path: 'public/:id', element: <PublicStandings /> },
      { path: 'print/:id', element: <PrintView /> },
      { path: 'reset-password', element: <ResetPassword /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
