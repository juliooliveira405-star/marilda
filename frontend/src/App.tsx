import { Navigate, Route, Routes } from "react-router-dom";
import { Show } from "@clerk/react";
import ClerkAuthProvider from "@/components/auth/ClerkAuthProvider";
import AppLayout, { RoleGate } from "@/components/AppLayout";
import { ADMIN_ROLES, FEED_ROLES, VIEW_ROLES } from "@/lib/roles";
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
          <Route path="/painel" element={<RoleGate roles={VIEW_ROLES}><Painel /></RoleGate>} />
          <Route path="/cmv-estoque" element={<RoleGate roles={["gerente", "chefe"]}><CmvEstoque /></RoleGate>} />
          <Route path="/ifood" element={<RoleGate roles={ADMIN_ROLES}><Ifood /></RoleGate>} />
          <Route path="/fornecedores-abc" element={<RoleGate roles={ADMIN_ROLES}><Fornecedores /></RoleGate>} />
          <Route path="/sugestao-pedidos" element={<RoleGate roles={VIEW_ROLES}><SugestaoPedidos /></RoleGate>} />
          <Route path="/contagem-qr" element={<RoleGate roles={VIEW_ROLES}><ContagemQR /></RoleGate>} />
          <Route path="/requisicoes" element={<RoleGate roles={VIEW_ROLES}><Requisicoes /></RoleGate>} />
          <Route path="/economia" element={<RoleGate roles={ADMIN_ROLES}><Economia /></RoleGate>} />
          <Route path="/insights-ia" element={<RoleGate roles={ADMIN_ROLES}><InsightsIA /></RoleGate>} />
          <Route path="/carregar-dados" element={<RoleGate roles={FEED_ROLES}><CarregarDados /></RoleGate>} />
          <Route path="/administracao" element={<RoleGate roles={ADMIN_ROLES}><Administracao /></RoleGate>} />
          <Route path="*" element={<Navigate to="/painel" replace />} />
        </Route>
      </Routes>
      <Toaster richColors />
    </ClerkAuthProvider>
  );
}
