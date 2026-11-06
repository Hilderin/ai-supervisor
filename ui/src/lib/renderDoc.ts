/**
 * Document injecté dans l'iframe de rendu `openchamber_render`.
 *
 * Défense en profondeur : l'iframe est déjà `sandbox` sans `allow-same-origin`
 * (origine opaque, pas d'accès au DOM ni au stockage du Superviseur), et la
 * page reçoit en plus une CSP qui coupe les requêtes réseau (`connect-src
 * 'none'`), les formulaires et les cadres. On garde les scripts inline : les
 * pages de graphiques en ont besoin ; ils restent confinés à l'origine opaque.
 */

export const RENDER_MIN_HEIGHT = 48;
export const RENDER_MAX_HEIGHT = 420;

const CSP = [
  "default-src 'none'",
  "img-src data: blob: https:",
  "media-src data: blob: https:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "font-src data: https:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join('; ');

const STYLE = `<style>
html{color-scheme:light}
body{margin:0;background:transparent;color:#1d211e;font-family:-apple-system,"Segoe UI",sans-serif;font-size:12px;line-height:1.5}
img,svg,video,canvas{max-width:100%}
a{color:#2b9f6a}
</style>`;

// La page rapporte sa hauteur : la carte grandit (jusqu'à RENDER_MAX_HEIGHT)
// au lieu de laisser un cadre fixe couper un graphique.
const SCRIPT = `<script>(function(){
function send(){try{
  var d=document.documentElement,b=document.body;
  var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);
  parent.postMessage({type:'superviseur:render-height',height:h},'*');
}catch(e){}}
window.addEventListener('load',send);
if(window.ResizeObserver&&document.documentElement){new ResizeObserver(send).observe(document.documentElement);}
setTimeout(send,50);setTimeout(send,300);
})();</script>`;

export function buildRenderDocument(html: string): string {
  const inject = `<meta http-equiv="Content-Security-Policy" content="${CSP}">${STYLE}${SCRIPT}`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${inject}</head>`);
  return `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`;
}
