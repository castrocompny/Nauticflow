"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Play } from "lucide-react";
import { SectionHeading, WindowChrome } from "./section";
import { Reveal } from "./reveal";

// Video do produto: uma reserva de verdade saindo do ToursFlow e chegando na
// operacao dentro do NauticFlow.
//
// CARREGAMENTO PREGUICOSO, de proposito: o elemento <video> (e portanto o MP4)
// NAO existe no HTML inicial nem no primeiro render -- so e montado depois do
// clique explicito em "Assistir". Ate la a pagina carrega apenas a imagem de
// poster, que e leve. Isso mantem o peso inicial da landing praticamente
// inalterado: o MP4 nunca entra no bundle de JS nem concorre com o LCP.
//
// O poster fica dentro de um container com proporcao fixa (aspect-video), entao
// a troca poster -> video nao mexe no layout (CLS zero nesta secao).
//
// O video nao tem faixa de audio nenhuma -- as legendas estao gravadas nos
// proprios quadros, ou seja, ele e inteiramente compreensivel no mudo. Por isso
// `autoPlay` depois do clique nunca reproduz som: nao ha som para reproduzir.

const VIDEO_SRC = "/videos/nauticflow-reserva-demo.mp4";
const POSTER_SRC = "/images/nauticflow-reserva-demo-poster.webp";

export function DemoVideo() {
  const [ativo, setAtivo] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  return (
    <section id="video" className="scroll-mt-20 bg-surface py-20 sm:py-24">
      <div className="mx-auto w-full max-w-5xl px-5 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="Veja funcionando"
            title="Veja uma reserva acontecendo na prática."
            subtitle="Do cliente escolhendo o passeio até a reserva aparecer na operação — tudo conectado."
          />
        </Reveal>

        <Reveal className="mt-12">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a1020] shadow-2xl ring-1 ring-black/20">
            <WindowChrome label="nauticflow.com.br · demonstração" />

            <div className="relative aspect-video w-full bg-[#0a1020]">
              {ativo ? (
                <video
                  ref={videoRef}
                  className="absolute inset-0 h-full w-full"
                  src={VIDEO_SRC}
                  poster={POSTER_SRC}
                  controls
                  autoPlay
                  playsInline
                  preload="auto"
                  // sem trilha de audio: o video e feito para ser entendido no mudo
                  aria-label="Demonstração: uma reserva feita no ToursFlow chegando na operação do NauticFlow"
                >
                  Seu navegador não reproduz vídeo.{" "}
                  <a href={VIDEO_SRC} className="underline">
                    Baixar o vídeo
                  </a>
                  .
                </video>
              ) : (
                <button
                  type="button"
                  onClick={() => setAtivo(true)}
                  aria-label="Assistir à demonstração de uma reserva, 35 segundos, sem áudio"
                  className="group absolute inset-0 h-full w-full cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand"
                >
                  <Image
                    src={POSTER_SRC}
                    alt="ToursFlow de um lado, NauticFlow do outro, conectados por uma reserva"
                    fill
                    sizes="(max-width: 1024px) 100vw, 960px"
                    className="object-cover"
                  />
                  <span className="absolute inset-0 bg-navy-900/25 transition-colors duration-300 group-hover:bg-navy-900/10" />
                  <span className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-2xl transition-transform duration-300 group-hover:scale-105 group-active:scale-95">
                    <Play size={30} className="ml-1 fill-navy text-navy" aria-hidden="true" />
                  </span>
                  <span className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-navy-900/80 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                    Assistir · 35s · sem áudio
                  </span>
                </button>
              )}
            </div>
          </div>
        </Reveal>

        {/* resumo em texto: acessivel a quem nao pode/nao quer ver o video, e
            deixa explicito que nao existe pagamento online no fluxo mostrado. */}
        <Reveal className="mt-6">
          <p className="mx-auto max-w-2xl text-center text-sm leading-relaxed text-muted">
            No vídeo: o cliente escolhe o passeio, a data (10:00) e 2 passageiros no ToursFlow e
            envia a reserva. Ela chega na operação do NauticFlow com alerta na tela, a
            disponibilidade cai de 8 para 6 vagas e a reserva aparece na agenda da saída. Gravado em
            ambiente de teste, com dados fictícios. O vídeo não tem áudio.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
