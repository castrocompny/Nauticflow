"use client";

import { Suspense, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { signIn, signUp, forgotPassword } from "./actions";
import { Logo } from "@/components/logo";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Aguarde..." : label}
    </button>
  );
}

const titles: Record<string, string> = {
  in: "Acesse sua conta",
  up: "Crie sua empresa",
  forgot: "Recupere sua senha",
};

// isolado num componente proprio, montado com `key={mode}` no pai -- assim o
// React descarta a instancia (e o estado do useActionState, com o erro/aviso da
// tentativa anterior) toda vez que o usuario troca de aba (login/criar/esqueci),
// em vez de deixar a mensagem antiga "grudada" na tela errada
function AuthForm({
  mode,
  onForgot,
  plan,
}: {
  mode: "in" | "up" | "forgot";
  onForgot: () => void;
  plan?: string;
}) {
  const action = (mode === "in" ? signIn : mode === "up" ? signUp : forgotPassword) as (
    prevState: { error: string; info?: string },
    formData: FormData
  ) => Promise<{ error: string; info?: string }>;
  const [state, formAction] = useActionState(action, { error: "" });

  return (
    <>
      {state?.error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={14} /> {state.error}
        </div>
      )}
      {state?.info && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <AlertCircle size={14} /> {state.info}
        </div>
      )}

      <form action={formAction} className="space-y-3">
        {mode === "up" && (
          <>
            {/* plano escolhido na landing (?plan=...) -- vai junto pro cadastro pra
                mandar o usuario direto pro checkout do plano certo depois de criar a conta */}
            {plan && <input type="hidden" name="plan" value={plan} />}
            <div>
              <label>Seu nome</label>
              <input name="name" required className="mt-1" />
            </div>
            <div>
              <label>Nome da empresa</label>
              <input name="company" required className="mt-1" />
            </div>
            <div>
              <label>Cidade</label>
              <input name="city" required className="mt-1" placeholder="Arraial do Cabo" />
            </div>
            <div>
              <label>CNPJ ou CPF (opcional)</label>
              <input name="cnpj" className="mt-1" placeholder="00.000.000/0000-00" />
            </div>
          </>
        )}
        <div>
          <label>Email</label>
          <input name="email" type="email" required className="mt-1" placeholder="voce@empresa.com" />
        </div>
        {mode !== "forgot" && (
          <div>
            <label>Senha</label>
            <input
              name="password"
              type="password"
              required
              minLength={mode === "up" ? 8 : undefined}
              className="mt-1"
              placeholder="••••••••"
            />
            {mode === "up" && (
              <p className="mt-1 text-[11px] text-muted">
                Mínimo 8 caracteres, com letras e números — nada de sequência (123456) ou só números (data de
                nascimento).
              </p>
            )}
          </div>
        )}
        {mode === "in" && (
          <button type="button" onClick={onForgot} className="block text-xs text-brand">
            Esqueci minha senha
          </button>
        )}
        {mode === "up" && (
          <label className="flex items-start gap-2 text-xs text-muted">
            <input type="checkbox" name="terms_accepted" required className="mt-0.5" />
            <span>
              Li e aceito os{" "}
              <a href="/termos" target="_blank" rel="noreferrer" className="text-brand">
                Termos de Uso
              </a>{" "}
              e a{" "}
              <a href="/privacidade" target="_blank" rel="noreferrer" className="text-brand">
                Política de Privacidade
              </a>
              .
            </span>
          </label>
        )}
        <Submit label={mode === "in" ? "Entrar" : mode === "up" ? "Criar conta" : "Enviar link de redefinição"} />
      </form>
    </>
  );
}

function LoginPage() {
  // ?mode=up abre direto na aba de cadastro (usado pelo CTA "Começar grátis" da
  // landing); ?mode=in ou ausente abre em "Entrar".
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "up" ? "up" : "in";
  const [mode, setMode] = useState<"in" | "up" | "forgot">(initialMode);
  // plano escolhido na landing (?plan=start|profissional|premium) -- so aceita os
  // codigos validos, pra nao propagar lixo da URL adiante
  const planParam = searchParams.get("plan");
  const plan = ["start", "profissional", "premium"].includes(planParam ?? "")
    ? (planParam as string)
    : undefined;

  return (
    <div className="grid min-h-screen place-items-center bg-app p-6">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6">
        <div className="mb-5 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-navy px-3 py-2">
            <Logo />
          </div>
          <p className="text-sm text-muted">{titles[mode]}</p>
        </div>

        <AuthForm key={mode} mode={mode} onForgot={() => setMode("forgot")} plan={plan} />

        {mode === "forgot" ? (
          <button onClick={() => setMode("in")} className="mt-4 w-full text-center text-sm text-brand">
            Voltar ao login
          </button>
        ) : (
          <button
            onClick={() => setMode(mode === "in" ? "up" : "in")}
            className="mt-4 w-full text-center text-sm text-brand"
          >
            {mode === "in" ? "Criar conta" : "Já tenho conta, entrar"}
          </button>
        )}
      </div>
    </div>
  );
}

// useSearchParams exige um limite de Suspense em volta (App Router, Next 16) --
// senao a rota inteira "cai" pra renderizacao client-side no build.
export default function LoginPageWrapper() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
