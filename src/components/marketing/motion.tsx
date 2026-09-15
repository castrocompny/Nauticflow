// Motion da landing -- um unico bloco de CSS, montado uma vez em page.tsx.
//
// Por que CSS e nao so JS: `prefers-reduced-motion` e requisito obrigatorio
// aqui, e uma checagem JS unica no mount nao responde se a pessoa mudar a
// preferencia do sistema com a pagina aberta. A media query abaixo responde
// ao vivo e, mais importante, e a ULTIMA palavra: mesmo que o JS de reveal
// rode, `.nf-reveal` fica visivel e sem transicao nenhuma sob reduced-motion.
//
// O reveal comeca invisivel (opacity 0) e so aparece quando o IntersectionObserver
// marca `data-revealed="true"`. Isso tem um risco real -- se o JS nao rodar, o
// conteudo nunca apareceria -- entao existem DOIS escapes independentes:
//   1. o <noscript> abaixo, que forca visibilidade sem JS nenhum;
//   2. o proprio Reveal, que se marca visivel na hora quando nao ha
//      IntersectionObserver (ver reveal.tsx).
// Conteudo sumido e pior que animacao perdida -- os dois caminhos falham para
// "visivel", nunca para "escondido".
const CSS = `
.nf-reveal{opacity:0;transform:translateY(14px);transition:opacity .55s cubic-bezier(.22,.61,.36,1),transform .55s cubic-bezier(.22,.61,.36,1)}
.nf-reveal[data-revealed="true"]{opacity:1;transform:none}
.nf-press{transition:transform .12s ease,box-shadow .2s ease,background-color .2s ease,border-color .2s ease,color .2s ease}
.nf-press:active{transform:scale(.975)}
.nf-card-hover{transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.nf-card-hover:hover{transform:translateY(-2px)}
.nf-swap{animation:nf-swap-in .32s cubic-bezier(.22,.61,.36,1) both}
@keyframes nf-swap-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.nf-toast-in{animation:nf-toast-pop .42s cubic-bezier(.22,.61,.36,1) both}
@keyframes nf-toast-pop{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
.nf-num{transition:color .3s ease}
.nf-bar{transition:width .5s cubic-bezier(.22,.61,.36,1)}
.nf-flow-line{transition:background-size .45s ease}

@media (prefers-reduced-motion: reduce){
  .nf-reveal,.nf-reveal[data-revealed="true"]{opacity:1!important;transform:none!important;transition:none!important}
  .nf-press:active{transform:none}
  .nf-card-hover:hover{transform:none}
  .nf-swap,.nf-toast-in{animation:none!important}
  .nf-num,.nf-bar,.nf-flow-line,.nf-press,.nf-card-hover{transition:none!important}
  .animate-pulse{animation:none!important}
}
`;

const NOSCRIPT_CSS = `.nf-reveal{opacity:1!important;transform:none!important}`;

export function MarketingMotionStyles() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <noscript>
        <style dangerouslySetInnerHTML={{ __html: NOSCRIPT_CSS }} />
      </noscript>
    </>
  );
}
