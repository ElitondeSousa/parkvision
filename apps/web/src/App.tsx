/**
 * As três interfaces do MVP (docs/mvp/02-contratos.md §7):
 *   /totem?acesso=A_NE  totem de entrada (o acesso fica fixo por totem)
 *   /painel             dashboard administrativo
 *   /t/:token           localizador de veículo (aberto pelo QR Code do ticket)
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Localizador } from './paginas/localizador/Localizador.tsx';
import { Painel } from './paginas/painel/Painel.tsx';
import { Totem } from './paginas/totem/Totem.tsx';
import { ProvedorTema } from './tema/tema.tsx';

export function Rotas() {
  return (
    <Routes>
      <Route path="/totem" element={<Totem />} />
      <Route path="/painel" element={<Painel />} />
      <Route path="/t/:token" element={<Localizador />} />
      <Route path="*" element={<Navigate to="/painel" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <ProvedorTema>
      <BrowserRouter>
        <Rotas />
      </BrowserRouter>
    </ProvedorTema>
  );
}
