"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateSettings } from "./actions";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Salvando..." : "Salvar alterações"}
    </button>
  );
}

export function SettingsForm({
  companyName,
  cnpj,
  city,
  phone,
  adminName,
  adminEmail,
  weatherLocationName,
  weatherLatitude,
  weatherLongitude,
}: {
  companyName: string;
  cnpj: string;
  city: string;
  phone: string;
  adminName: string;
  adminEmail: string;
  weatherLocationName: string;
  weatherLatitude: number | null;
  weatherLongitude: number | null;
}) {
  const [state, action] = useActionState(updateSettings, { error: "", ok: false });

  return (
    <form action={action} className="space-y-6">
      {state.ok && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Alterações salvas com sucesso.</p>
      )}
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="mb-4 font-display font-semibold text-heading">Dados da empresa</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Nome da empresa</label>
            <input name="company_name" required defaultValue={companyName} className="mt-1" />
          </div>
          <div>
            <label>CNPJ ou CPF</label>
            <input name="cnpj" defaultValue={cnpj} className="mt-1" placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <label>Cidade</label>
            <input name="city" defaultValue={city} className="mt-1" />
          </div>
          <div>
            <label>Telefone</label>
            <input name="phone" defaultValue={phone} className="mt-1" />
          </div>
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="mb-1 font-display font-semibold text-heading">Localização de operação</h2>
        <p className="mb-4 text-xs text-muted">
          Usada para mostrar as condições do vento no Dashboard -- é onde as embarcações operam, não onde você está
          acessando o sistema agora.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label>Nome do local</label>
            <input name="weather_location_name" defaultValue={weatherLocationName} className="mt-1" placeholder="Ex.: Búzios" />
          </div>
          <div>
            <label>Latitude</label>
            <input
              name="weather_latitude"
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              defaultValue={weatherLatitude ?? ""}
              className="mt-1"
              placeholder="-22.756479"
            />
          </div>
          <div>
            <label>Longitude</label>
            <input
              name="weather_longitude"
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              defaultValue={weatherLongitude ?? ""}
              className="mt-1"
              placeholder="-41.881767"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">
          Deixe em branco para não mostrar as condições do vento no Dashboard.
        </p>
      </div>

      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="mb-4 font-display font-semibold text-heading">Administrador</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Nome do administrador</label>
            <input name="admin_name" required defaultValue={adminName} className="mt-1" />
          </div>
          <div>
            <label>E-mail (login)</label>
            <input defaultValue={adminEmail} disabled className="mt-1 bg-surfaceHover text-muted" />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">O e-mail de login não é alterado aqui para não afetar o acesso.</p>
      </div>

      <Save />
    </form>
  );
}
