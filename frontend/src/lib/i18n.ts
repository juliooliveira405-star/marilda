export type AppLanguage = "pt" | "es";

export const LANGUAGE_OPTIONS: AppLanguage[] = ["pt", "es"];

export const appText = {
  pt: {
    brandSub: "CMV · Estoque · Compras",
    userRole: "Perfil",
    notifications: "Notificações",
    markAllRead: "Marcar todas como vistas",
    noNotifications: "Nenhuma notificação nova.",
    signOut: "Sair",
    waitingTitle: "Aguardando aprovação",
    waitingBody: "Sua conta foi criada. Um Gerente precisa definir seu perfil (Alimentador ou Chefe de Departamento) em Administração para liberar o acesso.",
    waitingButton: "Já fui aprovado — atualizar",
    noAccess: "Seu perfil ({role}) não tem acesso a esta área.",
    sessionExpired: "Sessão encerrada por inatividade (30 min). Entre novamente.",
    nav: {
      "/painel": "Painel Executivo",
      "/cmv-estoque": "CMV & Estoque",
      "/fornecedores-abc": "Curva ABC Fornecedores",
      "/sugestao-pedidos": "Sugestão de Pedidos",
      "/contagem-qr": "Contagem por QR Code",
      "/requisicoes": "Requisições",
      "/economia": "Simulador de Economia",
      "/insights-ia": "Insights & Diagnóstico IA",
      "/ifood": "iFood",
      "/carregar-dados": "Carregar Dados & PDFs",
      "/administracao": "Administração & Metas",
    },
    locale: "Locale POA",
    languageLabel: "Idioma",
    languagePt: "Português",
    languageEs: "Español",
    reloadProfile: "Não foi possível carregar seu perfil agora. Verifique a conexão e atualize a página.",
  },
  es: {
    brandSub: "CMV · Inventario · Compras",
    userRole: "Perfil",
    notifications: "Notificaciones",
    markAllRead: "Marcar todas como vistas",
    noNotifications: "No hay notificaciones nuevas.",
    signOut: "Salir",
    waitingTitle: "Esperando aprobación",
    waitingBody: "Tu cuenta fue creada. Un Gerente debe definir tu perfil (Alimentador o Jefe de Departamento) en Administración para liberar el acceso.",
    waitingButton: "Ya fui aprobado — actualizar",
    noAccess: "Tu perfil ({role}) no tiene acceso a esta área.",
    sessionExpired: "Sesión cerrada por inactividad (30 min). Vuelve a ingresar.",
    nav: {
      "/painel": "Panel Ejecutivo",
      "/cmv-estoque": "CMV & Inventario",
      "/fornecedores-abc": "Curva ABC Proveedores",
      "/sugestao-pedidos": "Sugerencia de Pedidos",
      "/contagem-qr": "Conteo por QR Code",
      "/requisicoes": "Requisiciones",
      "/economia": "Simulador de Ahorro",
      "/insights-ia": "Insights & Diagnóstico IA",
      "/ifood": "iFood",
      "/carregar-dados": "Cargar Datos y PDFs",
      "/administracao": "Administración & Metas",
    },
    locale: "Locale POA",
    languageLabel: "Idioma",
    languagePt: "Portugués",
    languageEs: "Español",
    reloadProfile: "No se pudo cargar tu perfil ahora. Verifica la conexión y actualiza la página.",
  },
} as const;

export function getAppText(language: AppLanguage | undefined | null) {
  return appText[language === "es" ? "es" : "pt"];
}
