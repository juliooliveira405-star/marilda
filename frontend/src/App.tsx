import { Navigate, Route, Routes } from "react-router-dom";
import { Show } from "@clerk/react";
import ClerkAuthProvider from "@/components/auth/ClerkAuthProvider";
import AppLayout, { RoleGate } from "@/components/AppLayout";
import { Toaster } from "@/components/ui/sonner";
import { SignInPage, SignUpPage } from "@/pages/Auth";
import Painel from "@/pages/Painel";
import CmvEstoque from "@/pages/CmvEstoque";
import Fornecedores from "@/pages/Fornecedores";
import SugestaoPedidos from "@/pages/SugestaoPedidos";
import Economia from "@/pages/Economia";
import InsightsIA from "@/pages/InsightsIA";
import Ifood from "@/pages/Ifood";
import CarregarDados from "@/pages/CarregarDados";
import Administracao from "@/pages/Administracao";
import ContagemQR from "@/pages/ContagemQR";
import Requisicoes from "@/pages/Requisicoes";

function Protected() {
  return (
    <>
      <Show when="signed-in"><AppLayout /></Show>
      <Show when="signed-out"><Navigate to="/sign-in" replace /></Show>
    </>
  );
}

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <ClerkAuthProvider>
      <Routes>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route element={<Protected />}>
          <Route path="/" element={<Navigate to="/painel" replace />} />
          <Route path="/painel" element={<RoleGate gate="view"><Painel /></RoleGate>} />
          <Route path="/cmv-estoque" element={<RoleGate gate="costs"><CmvEstoque /></RoleGate>} />
          <Route path="/ifood" element={<RoleGate gate="ifood"><Ifood /></RoleGate>} />
          <Route path="/fornecedores-abc" element={<RoleGate gate="full"><Fornecedores /></RoleGate>} />
          <Route path="/sugestao-pedidos" element={<RoleGate gate="view"><SugestaoPedidos /></RoleGate>} />
          <Route path="/contagem-qr" element={<RoleGate gate="view"><ContagemQR /></RoleGate>} />
          <Route path="/requisicoes" element={<RoleGate gate="view"><Requisicoes /></RoleGate>} />
          <Route path="/economia" element={<RoleGate gate="full"><Economia /></RoleGate>} />
          <Route path="/insights-ia" element={<RoleGate gate="full"><InsightsIA /></RoleGate>} />
          <Route path="/carregar-dados" element={<RoleGate gate="upload"><CarregarDados /></RoleGate>} />
          <Route path="/administracao" element={<RoleGate gate="manage"><Administracao /></RoleGate>} />
          <Route path="*" element={<Navigate to="/painel" replace />} />
        </Route>
      </Routes>
      <Toaster richColors />
    </ClerkAuthProvider>
  );
}
