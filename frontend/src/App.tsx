import { Navigate, Route, Routes } from "react-router-dom";
import { Show } from "@clerk/react";
import ClerkAuthProvider from "@/components/auth/ClerkAuthProvider";
import AppLayout, { ADMIN_ROLES, FEED_ROLES, RoleGate, VIEW_ROLES } from "@/components/AppLayout";
import { Toaster } from "@/components/ui/sonner";
import { SignInPage, SignUpPage } from "@/pages/Auth";
import Painel from "@/pages/Painel";
import CmvEstoque from "@/pages/CmvEstoque";
import Fornecedores from "@/pages/Fornecedores";
import SugestaoPedidos from "@/pages/SugestaoPedidos";
import Economia from "@/pages/Economia";
import InsightsIA from "@/pages/InsightsIA";
import CarregarDados from "@/pages/CarregarDados";
import Administracao from "@/pages/Administracao";

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
          <Route path="/cmv-estoque" element={<RoleGate roles={VIEW_ROLES}><CmvEstoque /></RoleGate>} />
          <Route path="/fornecedores-abc" element={<RoleGate roles={VIEW_ROLES}><Fornecedores /></RoleGate>} />
          <Route path="/sugestao-pedidos" element={<RoleGate roles={VIEW_ROLES}><SugestaoPedidos /></RoleGate>} />
          <Route path="/economia" element={<RoleGate roles={VIEW_ROLES}><Economia /></RoleGate>} />
          <Route path="/insights-ia" element={<RoleGate roles={VIEW_ROLES}><InsightsIA /></RoleGate>} />
          <Route path="/carregar-dados" element={<RoleGate roles={FEED_ROLES}><CarregarDados /></RoleGate>} />
          <Route path="/administracao" element={<RoleGate roles={ADMIN_ROLES}><Administracao /></RoleGate>} />
          <Route path="*" element={<Navigate to="/painel" replace />} />
        </Route>
      </Routes>
      <Toaster richColors />
    </ClerkAuthProvider>
  );
}
