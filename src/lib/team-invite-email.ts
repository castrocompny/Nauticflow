function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// mesmo estilo visual do voucher de reserva (send-reservation-voucher) -- cabecalho
// navy com logo, corpo claro. meta tags de color-scheme evitam que Gmail/Outlook/Apple
// Mail apliquem modo escuro automatico (lavaria o cabecalho navy).
export function buildInviteEmailHtml(params: { inviteeName: string; companyName: string; link: string }): string {
  const { inviteeName, companyName, link } = params;
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
    <style>:root { color-scheme: light only; supported-color-schemes: light only; }</style>
  </head>
  <body style="margin:0;padding:24px 12px;background:#f4f6fa">
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;background:#ffffff">
    <div style="background:#0d1b3e;padding:20px 24px;color:#fff">
      <span style="font-size:18px;font-weight:700;vertical-align:middle">Nautic<span style="color:#2d9cff">Flow</span></span>
    </div>
    <div style="padding:24px">
      <p style="font-size:15px;color:#0d1b3e">Olá, ${escapeHtml(inviteeName)}!</p>
      <p style="font-size:13px;color:#475569">Você foi convidado a fazer parte da equipe de <strong>${escapeHtml(companyName)}</strong> no NauticFlow. Clique no botão abaixo para criar sua senha e acessar o sistema.</p>
      <div style="text-align:center;margin:24px 0">
        <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px">Aceitar convite e criar senha</a>
      </div>
      <p style="font-size:11px;color:#94a3b8">Se você não esperava este convite, pode ignorar este e-mail.</p>
    </div>
    <div style="border-top:1px solid #e2e8f0;padding:14px;text-align:center;color:#94a3b8;font-size:11px">
      Enviado automaticamente pelo NauticFlow.
    </div>
  </div>
  </body>
  </html>`;
}
