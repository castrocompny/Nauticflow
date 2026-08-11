import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Política de Privacidade — NauticFlow" };

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-app py-10">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="rounded-xl bg-navy px-3 py-2">
            <Logo />
          </div>
          <Link href="/login" className="text-sm text-brand">
            Voltar ao login
          </Link>
        </div>

        <div className="rounded-card border border-line bg-surface p-8 text-sm leading-relaxed text-body">
          <h1 className="mb-1 font-display text-2xl font-semibold text-heading">Política de Privacidade</h1>
          <p className="mb-6 text-xs text-muted">Última atualização: 01 de agosto de 2026.</p>

          <Section title="1. Quem trata os seus dados">
            O NauticFlow atua como operador do sistema utilizado pela empresa de turismo náutico
            (&quot;Contratante&quot;) que cadastrou a conta. Cada Contratante é responsável, como controlador,
            pelos dados de seus próprios clientes e passageiros que insere no sistema.
          </Section>

          <Section title="2. Quais dados coletamos">
            <strong>Da empresa Contratante:</strong> nome, CNPJ, cidade, telefone e e-mail comercial.
            <br />
            <strong>Dos usuários que acessam o sistema:</strong> nome, e-mail e senha (a senha é gerenciada
            de forma criptografada pelo provedor de autenticação, nunca em texto simples).
            <br />
            <strong>Dos clientes finais cadastrados pelo Contratante:</strong> nome, CPF, telefone, e-mail e
            cidade — usados apenas para a gestão de reservas e passeios da empresa Contratante.
          </Section>

          <Section title="3. Para que usamos esses dados">
            Os dados são usados para viabilizar o funcionamento do sistema: autenticação, controle de vagas
            e capacidade de embarcações, emissão de vouchers e manifestos, indicadores financeiros e envio
            de comprovantes por e-mail. A base legal é a execução do contrato de uso do sistema e, quando
            aplicável, o legítimo interesse do Contratante em gerenciar seu próprio negócio.
          </Section>

          <Section title="4. Isolamento entre empresas">
            Cada empresa cadastrada no NauticFlow só tem acesso aos seus próprios dados. O sistema aplica
            controle de acesso a nível de linha no banco de dados, de forma que uma empresa não consegue
            visualizar ou alterar dados de outra, mesmo dentro da mesma plataforma.
          </Section>

          <Section title="5. Com quem compartilhamos dados">
            Não vendemos dados a terceiros. Usamos os seguintes prestadores de serviço para operar o
            sistema, que têm acesso aos dados apenas na medida necessária para prestar o serviço contratado:
            <br />
            — <strong>Supabase</strong>: hospedagem do banco de dados e autenticação.
            <br />— <strong>Resend</strong>: envio de e-mails transacionais (confirmação de cadastro e
            vouchers de reserva).
          </Section>

          <Section title="6. Retenção e exclusão">
            Os dados são mantidos enquanto a conta estiver ativa. Após o cancelamento, podem ser retidos por
            um período razoável para fins de segurança jurídica, sendo excluídos ou anonimizados depois
            desse prazo, exceto quando a lei exigir retenção por mais tempo.
          </Section>

          <Section title="7. Seus direitos como titular de dados">
            Conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode solicitar a
            confirmação da existência de tratamento, acesso, correção, exclusão, portabilidade ou informação
            sobre o compartilhamento dos seus dados. Se você é cliente final de uma empresa que usa o
            NauticFlow, esse pedido deve ser direcionado primeiro à própria empresa (ela é a responsável
            pelos dados que cadastrou); se você é uma empresa Contratante, pode nos contatar diretamente.
          </Section>

          <Section title="8. Cookies">
            Usamos apenas cookies estritamente necessários para manter a sessão de login. Não usamos cookies
            de rastreamento ou publicidade.
          </Section>

          <Section title="9. Alterações desta política">
            Esta política pode ser atualizada para refletir mudanças no sistema ou na legislação. Mudanças
            relevantes serão comunicadas por e-mail ou aviso no próprio sistema.
          </Section>

          <Section title="10. Contato">
            Dúvidas sobre esta política ou solicitações relacionadas aos seus dados podem ser enviadas para{" "}
            <a href="mailto:contato@castrocompny.online" className="text-brand">
              contato@castrocompny.online
            </a>
            .
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="mb-1.5 font-display text-sm font-semibold text-heading">{title}</h2>
      <p>{children}</p>
    </div>
  );
}
