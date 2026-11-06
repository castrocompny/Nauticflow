// Barreira de rede dos testes: qualquer fetch/socket que um teste não tenha
// mockado explicitamente falha aqui, antes de sair do processo. Testes que
// precisam de fetch o substituem por vi.fn() e restauram esta barreira.
import net from "node:net";
import tls from "node:tls";

const blocked = (what: string) => () => {
  throw new Error(`test-network-blocked:${what}`);
};

globalThis.fetch = blocked("fetch") as unknown as typeof fetch;
net.connect = blocked("net.connect") as unknown as typeof net.connect;
net.createConnection = blocked("net.createConnection") as unknown as typeof net.createConnection;
tls.connect = blocked("tls.connect") as unknown as typeof tls.connect;
