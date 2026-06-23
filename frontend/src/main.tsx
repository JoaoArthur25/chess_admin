import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import App from './App';
import TournamentList from './pages/TournamentList';
import TournamentDetail from './pages/TournamentDetail';
import PublicStandings from './pages/PublicStandings';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <TournamentList /> },
      { path: 't/:id', element: <TournamentDetail /> },
      { path: 'public/:id', element: <PublicStandings /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
