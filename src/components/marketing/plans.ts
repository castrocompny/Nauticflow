// Constantes da landing page institucional. Mantidas aqui pra ficar num lugar só.
// Os CTAs sao links relativos: /login e /login?mode=up ja existem no proprio app.

export const MKT_LINKS = {
  login: "/login",
  signup: "/login?mode=up",
  termos: "/termos",
  privacidade: "/privacidade",
} as const;

export const MKT_CONTACT = {
  // wa.me exige o numero completo com codigo do pais (55) + DDD, sem simbolos.
  whatsapp: "https://wa.me/5565992407699",
  whatsappLabel: "(65) 99240-7699",
  email: "castrocompny@gmail.com",
} as const;

export const MKT_NAV = [
  { href: "#funcionalidades", label: "Funcionalidades" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#planos", label: "Planos" },
  { href: "#faq", label: "Perguntas" },
  { href: "#contato", label: "Contato" },
] as const;

export type MktPlan = {
  id: string;
  name: string;
  price: string;
  period: string;
  boats: string;
  users: string;
  highlight?: string;
  featured?: boolean;
  features: string[];
};

// Valores literais conforme a tabela oficial — nao estimar nem arredondar.
export const MKT_PLANS: MktPlan[] = [
  {
    id: "start",
    name: "Start",
    price: "R$147",
    period: "/mês",
    boats: "até 2 embarcações",
    users: "1 usuário",
    features: [
      "Agenda e controle de saídas",
      "Reservas com voucher automático",
      "Manifesto de embarque",
      "Cadastro de clientes e parceiros",
      "Dashboard de receita e ocupação",
    ],
  },
  {
    id: "profissional",
    name: "Profissional",
    price: "R$297",
    period: "/mês",
    boats: "até 10 embarcações",
    users: "5 usuários",
    highlight: "Mais popular",
    featured: true,
    features: [
      "Tudo do plano Start",
      "Até 10 embarcações cadastradas",
      "5 usuários com controle de acesso",
      "Ranking de desempenho e parceiros",
      "Suporte prioritário",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    price: "R$597",
    period: "/mês",
    boats: "embarcações ilimitadas",
    users: "usuários ilimitados",
    features: [
      "Tudo do plano Profissional",
      "Embarcações ilimitadas",
      "Usuários ilimitados",
      "Controle de acesso avançado",
      "Suporte prioritário",
    ],
  },
];
