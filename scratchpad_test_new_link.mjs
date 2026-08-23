import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : null; };
const admin = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });

const LLEDENEW_ID = "5ee046b2-0c9e-480a-a4ef-e114269c634d";
const testEmail = `castrocompny+tmpl${Date.now()}@gmail.com`;

const { data, error } = await admin.auth.admin.generateLink({
  type: "invite",
  email: testEmail,
  options: {
    data: { name: "Teste Template", role: "staff", invited_to_company_id: LLEDENEW_ID },
    redirectTo: "https://nauticflow.com.br/auth/callback?next=/redefinir-senha",
  },
});
if (error) { console.error(error); process.exit(1); }

// monta o MESMO link que o {{ .TokenHash }} do template real geraria
const directLink = `https://nauticflow.com.br/auth/callback?token_hash=${data.properties.hashed_token}&type=invite&next=/redefinir-senha`;
console.log("link direto (equivalente ao do template novo):", directLink);

const res = await fetch(directLink, { redirect: "manual" });
console.log("status:", res.status);
console.log("location:", res.headers.get("location"));
console.log("set-cookie presente?", !!res.headers.get("set-cookie"));
console.log("set-cookie (resumo):", (res.headers.get("set-cookie") || "").slice(0, 200));

await admin.auth.admin.deleteUser(data.user.id);
console.log("removido.");
