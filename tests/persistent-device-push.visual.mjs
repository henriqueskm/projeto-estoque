// Dedicated local fixture: real React UI, storage and History API; simulated
// auth/Firebase/API boundaries. Never connects to Supabase or sends real push.
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const css = readdirSync(".next/static", { recursive: true }).filter(name => name.endsWith(".css"))
  .map(name => readFileSync(join(".next/static", name), "utf8")).join("\n");
const mocks = {
  "next/navigation": `import {useSyncExternalStore} from 'react';const listeners=new Set();
    window.__navigate=(href,replace=false)=>{history[replace?'replaceState':'pushState']({...history.state},'',href);window.__navs++;listeners.forEach(f=>f())};
    const subscribe=f=>{listeners.add(f);return()=>listeners.delete(f)};
    export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)}
    export function useSearchParams(){return new URLSearchParams(location.search)}
    export function useRouter(){return {push:window.__navigate,prefetch(){},refresh(){window.__refreshes++}}}`,
  "next/link": `import {createElement as h} from 'react';export default function Link({href,children,onClick,prefetch,...props}){
    return h('a',{...props,href,onClick:e=>{onClick?.(e);if(!e.defaultPrevented&&!e.metaKey&&!e.ctrlKey){e.preventDefault();window.__navigate(href)}}},children)}`,
  "@/app/auth/actions": `export async function logout(){window.__logouts++;if(window.__standaloneFixture)window.__navigate('/login',true);window.__setUser(null)}`,
  "@/lib/firebase-push-client": `export function isFirebasePushConfigured(){return true}
    export async function browserSupportsFirebasePush(){return true}
    export async function requestFirebasePushPermission(){window.__permissionRequests++;window.Notification.permission='granted';return true}
    export async function waitForFirebasePushInstallation(){return window.__fid}
    export async function subscribeToFirebasePushRegistration(listener){await listener.registered(window.__fid);return()=>{window.__unsubscribes++}}
    export async function subscribeToForegroundPush(){return()=>{}}
    export async function unregisterFirebasePushInstallation(){window.__unregisters++;return true}`,
  "@/lib/safisa-bulk-pickup-actions": `export async function previewSafisaBulkPickup(){window.__previewReads++;return {ok:true,preview:window.__preview}}
    export async function confirmSafisaBulkPickup(){throw Error('Remote mutations forbidden in this fixture')}`,
};
const bundle = await build({ bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import {useState} from 'react';import {createRoot} from 'react-dom/client';
    import {PushNotificationProvider} from './components/push-notification-provider';
    import {PushNotificationControl} from './components/push-notification-control';
    import {PushAwareLogoutForm} from './components/push-aware-logout-form';
    import {AppSidebar} from './components/app-sidebar';
    import {WorkspaceStateProvider} from './components/workspace-state-provider';
    import {SemanticBackProvider,useSemanticWorkspaceState} from './components/semantic-back-provider';
    import {SafisaPickupAlertProvider,useSafisaPickupAlerts} from './components/safisa-pickup-alert-provider';
    import {AssistantStructuredBlockView} from './components/assistant-structured-block';
    import {AssistantAttentionSummaryView} from './components/assistant-attention-summary';
    import {buildAssistantAttentionSummary} from './lib/assistant-attention';
    import {createAssistantAttentionMessage} from './lib/assistant-attention-chat';
    import {inventoryWorkspaceDefaults} from './lib/workspace-state';
    window.__standaloneFixture=new URLSearchParams(location.search).get('standalone')==='1';
    if(window.__standaloneFixture){const match=window.matchMedia.bind(window);window.matchMedia=query=>query==='(display-mode: standalone)'?{...match(query),matches:true}:match(query)}
    window.__closeAttempts=0;window.close=()=>{window.__closeAttempts++}; // Simulate a refusing runtime; never close the audit tab.
    window.__permissionRequests=0;window.__unregisters=0;window.__unsubscribes=0;window.__logouts=0;
    window.__posts=0;window.__deletes=0;window.__navs=0;window.__refreshes=0;window.__previewReads=0;window.__beforeNavigation=0;
    window.addEventListener('nk:workspace:before-navigation',()=>window.__beforeNavigation++);
    window.__fid='sanitized-fixture-fid';window.__subscription=null;window.Notification={permission:'default'};
    const livePickup={alerts:[{supplierOrderId:'85000000-0000-4000-8000-000000000020',negotiationNumber:'40959',readyWaitingPickupQuantity:3}],alertCount:1,isComplete:true};
    window.__liveAlerts=livePickup;
    window.fetch=async(path,options)=>{if(path==='/api/safisa-pickup-alerts')return new Response(JSON.stringify(window.__liveAlerts));
      if(path!='/api/push-subscriptions')throw Error('Unexpected network boundary');
      const input=JSON.parse(options.body);
      if(options.method==='POST'){window.__posts++;window.__subscription={...input,userId:window.__userId,enabled:true};return new Response(JSON.stringify({enabled:true}))}
      window.__deletes++;if(window.__subscription?.userId===window.__userId)window.__subscription.enabled=false;
      return new Response(JSON.stringify({disabled:true}));};
    const userA='85000000-0000-4000-8000-000000000001',userB='85000000-0000-4000-8000-000000000002';
    window.__preview={orderCount:1,lineCount:1,totalQuantity:3,orders:[{supplierOrderId:'85000000-0000-4000-8000-000000000020',negotiationNumber:'40959',orderDate:'2026-10-06',expectedUpdatedAt:'2026-10-06T12:00:00Z',expectedLineFingerprint:'fixture',lines:[{supplierOrderItemId:'85000000-0000-4000-8000-000000000021',code:'1H',descriptionSnapshot:'SERVO MODELO SANITIZADO',readyQuantity:3,pickedQuantity:0,quantityToPickup:3}]}]};
    const attention=buildAssistantAttentionSummary({purchaseRecommendations:[],pendingStockOrders:[],readyPickupOrders:[{supplierOrderId:window.__preview.orders[0].supplierOrderId,negotiationNumber:'40959',readyWaitingPickupQuantity:3,isActiveOrder:true,isInHistory:false}]});
    function Content(){const [message,setMessage]=useState(null);
      const workspace=useSemanticWorkspaceState('estoque',inventoryWorkspaceDefaults);
      const alerts=useSafisaPickupAlerts();
      return <>
      <AppSidebar userName="Nome sanitizado" hasRegisteredName/>
      <main className="min-w-0 pt-20 px-3 lg:ml-64">
        <button onClick={()=>workspace.setState(s=>({...s,statusFilter:'low'}))}>Aplicar filtro (fixture)</button>
        <button onClick={()=>workspace.setState(s=>({...s,statusFilter:'all'}))}>Limpar filtro (fixture)</button>
        <p>Filtro atual: {workspace.state.statusFilter}</p>
        <button onClick={()=>{window.__liveAlerts={alerts:[],alertCount:0,isComplete:true};void alerts.refreshAlerts()}}>Zerar alertas (fixture)</button>
        <button onClick={()=>{window.__liveAlerts=livePickup;void alerts.refreshAlerts()}}>Restaurar alertas (fixture)</button>
        <section aria-label="Minha Conta (fixture)"><PushNotificationControl/></section>
        <section aria-label="Sino (fixture)"><PushNotificationControl mode="activate-only"/></section>
        <PushAwareLogoutForm buttonClassName="min-h-11 px-3">Logout (fixture)</PushAwareLogoutForm>
        <AssistantAttentionSummaryView attention={attention} attentionError={null} firstName={null}
          onAttentionSelect={item=>setMessage(createAssistantAttentionMessage(item,crypto.randomUUID()))}/>
        {message?.structuredBlock ? <AssistantStructuredBlockView block={message.structuredBlock}/> : null}
      </main></>}
    function Fixture(){const [user,setUser]=useState(window.__standaloneFixture&&location.pathname==='/login'?null:userA);window.__setUser=setUser;window.__userId=user;
      const login=user=>{if(window.__standaloneFixture)window.__navigate('/',true);setUser(user)};
      return user ? <SafisaPickupAlertProvider initialResult={{data:livePickup,error:null}}><PushNotificationProvider key={user} userId={user}><WorkspaceStateProvider userId={user}>
        <SemanticBackProvider><Content/></SemanticBackProvider></WorkspaceStateProvider></PushNotificationProvider></SafisaPickupAlertProvider>
      : <><button onClick={()=>login(userA)}>Login A (fixture)</button><button onClick={()=>login(userB)}>Login B (fixture)</button></>}
    createRoot(document.getElementById('fixture')).render(<Fixture/>);` },
  plugins: [{ name: "local-only-network-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(next\/(link|navigation)|@\/)/ }, args => {
      if (args.path in mocks) return { path: args.path, namespace: "fixture" };
      const base = resolve(args.path.slice(2));
      return { path: [base, `${base}.ts`, `${base}.tsx`].find(existsSync) };
    });
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js", resolveDir: process.cwd() }));
  } }],
});
createServer((req, res) => {
  if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  if (req.url === "/fixture.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(bundle.outputFiles[0].text); return; }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>NK85 — local sanitized fixture</title><style>${css}</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`);
}).listen(3085, "127.0.0.1", () => console.log("Local-only fixture: http://127.0.0.1:3085/estoque"));
