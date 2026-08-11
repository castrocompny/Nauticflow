import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Termos de Uso — NauticFlow" };

export default function TermosPage() {
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
          <h1 className="mb-1 font-display text-2xl font-semibold text-heading">Termos de Uso</h1>
          <p className="mb-6 text-xs text-muted">Última atualização: 01 de agosto de 2026.</p>

          <Section title="1. Aceitação dos termos">
            Ao criar uma conta ou usar o NauticFlow, você (pessoa física ou empresa que contrata o serviço,
            chamada aqui de &quot;Contratante&quot;) concorda com estes Termos de Uso e com a{" "}
            <Link href="/privacidade" className="text-brand">
              Política de Privacidade
            </Link>
            . Se não concordar, não utilize o sistema.
          </Section>

          <Section title="2. O que é o NauticFlow">
            O NauticFlow é um sistema de gestão para empresas de turismo náutico: cadastro de embarcações,
            passeios, saídas programadas, clientes, reservas, passageiros, controle financeiro e emissão de
            manifesto e voucher. O serviço é fornecido por assinatura mensal, em planos com limites de uso
            (quantidade de embarcações e usuários).
          </Section>

          <Section title="3. Cadastro e responsabilidade pela conta">
            O Contratante é responsável por manter a confidencialidade da senha de acesso e por todas as
            atividades realizadas na conta. Os dados inseridos no sistema (embarcações, passeios, clientes,
            reservas) são de responsabilidade do Contratante quanto à veracidade e à legalidade de sua
            coleta e uso.
          </Section>

          <Section title="4. Planos e cobrança">
            O acesso a funcionalidades e limites de uso (por exemplo, número de embarcações) varia conforme
            o plano contratado. O não pagamento nas condições combinadas pode resultar em suspensão ou
            cancelamento do acesso, mediante aviso prévio quando aplicável.
          </Section>

          <Section title="5. Uso permitido">
            O Contratante não pode usar o sistema para armazenar ou processar dados obtidos de forma
            ilícita, nem tentar acessar dados de outras empresas cadastradas na plataforma, contornar
            mecanismos de segurança ou sobrecarregar o serviço intencionalmente.
          </Section>

          <Section title="6. Disponibilidade do serviço">
            O NauticFlow é fornecido &quot;como está&quot;. Fazemos esforços razoáveis para manter o serviço
            disponível, mas não garantimos operação ininterrupta ou livre de erros. Manutenções programadas
            ou emergenciais podem causar indisponibilidade temporária.
          </Section>

          <Section title="7. Limitação de responsabilidade">
            Na extensão permitida pela lei, o NauticFlow não se responsabiliza por danos indiretos,
            perda de receita ou de dados decorrentes do uso ou da impossibilidade de uso do sistema,
            incluindo decisões operacionais tomadas com base nas informações do sistema (por exemplo,
            controle de vagas e ocupação).
          </Section>

          <Section title="8. Cancelamento">
            O Contratante pode solicitar o cancelamento da assinatura a qualquer momento. Dados podem ser
            retidos por um período razoável após o cancelamento, conforme descrito na Política de
            Privacidade, antes da exclusão definitiva.
          </Section>

          <Section title="9. Alterações destes termos">
            Estes termos podem ser atualizados. Mudanças relevantes serão comunicadas por e-mail ou aviso no
            próprio sistema. O uso continuado após a atualização representa concordância com os novos termos.
          </Section>

          <Section title="10. Lei aplicável">
            Estes termos são regidos pela legislação brasileira, incluindo a Lei Geral de Proteção de Dados
            (Lei nº 13.709/2018).
          </Section>

          <Section title="11. Contato">
            Dúvidas sobre estes termos podem ser enviadas para{" "}
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
