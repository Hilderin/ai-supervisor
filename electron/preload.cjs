/**
 * Pont du panneau navigateur.
 *
 * Le navigateur est une vue native (WebContentsView) possédée par le main
 * process : la page affichée n'est donc pas du DOM du renderer. L'UI ne fournit
 * que le rectangle où la vue doit se poser, et reçoit son état (URL, titre,
 * historique). Aucun accès Node n'est exposé : uniquement ces quelques gestes.
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('superviseurBrowser', {
  available: true,
  state: () => invoke('superviseur:browser:state'),
  layout: (bounds) => invoke('superviseur:browser:layout', bounds),
  navigate: (url) => invoke('superviseur:browser:navigate', url),
  action: (name) => invoke('superviseur:browser:action', name),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('superviseur:browser:state', listener);
    return () => ipcRenderer.removeListener('superviseur:browser:state', listener);
  },
  // Le composant signale une navigation de la page du panneau : c'est elle, et
  // elle seule, qui fait ouvrir le panneau sans clic du propriétaire.
  onReveal: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('superviseur:browser:reveal', listener);
    return () => ipcRenderer.removeListener('superviseur:browser:reveal', listener);
  },
});
