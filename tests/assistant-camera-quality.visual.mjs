// Local, synthetic-only smoke of the real React camera. No camera permission,
// authentication, provider call, upload or business-data access is involved.
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const css = readdirSync(".next/static", { recursive: true }).filter(name => name.endsWith(".css"))
  .map(name => readFileSync(join(".next/static", name), "utf8")).join("\n");
const browser = await build({ bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import {Activity,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {AssistantCameraCapture} from './components/assistant-camera-capture';
    import {prepareSupplierOrderPhoto} from './lib/assistant-photo-upload';
    const metrics={acquisitions:0,stopped:0,photos:0,created:0,revoked:0,used:0,unchanged:false};
    const originalCreate=URL.createObjectURL.bind(URL),originalRevoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{metrics.created++;return originalCreate(blob)};
    URL.revokeObjectURL=url=>{metrics.revoked++;originalRevoke(url)};
    const photo=document.createElement('canvas');photo.width=4032;photo.height=3024;
    const ctx=photo.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,4032,3024);
    ctx.fillStyle='black';ctx.font='70px monospace';ctx.fillText('SYNTHETIC NK CAMERA TEST 10RB 10',200,300);
    const blob=await new Promise(resolve=>photo.toBlob(resolve,'image/png'));
    let mode='native';
    function configure(value){mode=value;window.ImageCapture=value==='canvas'?undefined:class {
      async takePhoto(){metrics.photos++;if(mode==='reject')throw Error('Synthetic rejection');
        if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,6500));return blob;}
    }}configure('native');
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async constraints=>{
      if(constraints.video.width?.ideal!==3840||constraints.video.facingMode?.ideal!=='environment')throw Error('Wrong constraints');
      metrics.acquisitions++;const video=document.createElement('canvas');video.width=1920;video.height=1080;
      const c=video.getContext('2d');c.fillStyle='white';c.fillRect(0,0,1920,1080);c.fillStyle='black';c.font='32px monospace';c.fillText('SYNTHETIC VIDEO 10RB',100,100);
      const stream=video.captureStream(2);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{metrics.stopped++;stop()}}return stream;
    }});
    function Fixture(){const [open,setOpen]=useState(false),[mounted,setMounted]=useState(true),[visible,setVisible]=useState(true),[report,setReport]=useState('');
      return <><h1>NK88 synthetic camera fixture</h1>
        <button onClick={()=>{setMounted(true);setVisible(true);setOpen(true)}}>Open camera</button>
        {['native','canvas','reject','slow'].map(value=><button key={value} onClick={()=>configure(value)}>Mode {value}</button>)}
        <button onClick={()=>{setMounted(false);setOpen(false)}}>Unmount camera</button>
        <button onClick={()=>setVisible(!visible)}>Toggle Activity</button>
        <button onClick={()=>window.dispatchEvent(new Event('pagehide'))}>Simulate pagehide</button>
        <button onClick={()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))}}>Simulate background</button>
        <button onClick={()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))}}>Resume visibility</button>
        <button onClick={()=>setReport(JSON.stringify(metrics))}>Read metrics</button><output>{report}</output>
        {mounted?<Activity mode={visible?'visible':'hidden'}><AssistantCameraCapture isOpen={open} onClose={()=>setOpen(false)}
          onUsePhoto={async file=>{const prepared=await prepareSupplierOrderPhoto(file);metrics.used++;metrics.unchanged=prepared===file;setOpen(false);setReport(JSON.stringify(metrics))}}
          onNativeCameraFallback={()=>{throw Error('Unexpected native app fallback')}} onGalleryFallback={()=>setOpen(false)}/></Activity>:null}
      </>}
    createRoot(document.getElementById('fixture')).render(<Fixture/>);
  ` },
  plugins: [{ name: "local-alias", setup(builder) {
    builder.onResolve({ filter: /^@\// }, args => {
      const base = resolve(args.path.slice(2));
      return { path: [base, base + ".ts", base + ".tsx"].find(existsSync) };
    });
  } }],
});
createServer((req, res) => {
  if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  if (req.url === "/fixture.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(browser.outputFiles[0].text); return; }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>NK88 synthetic camera</title><style>${css}</style></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>`);
}).listen(3088, "127.0.0.1", () => console.log("Synthetic local camera fixture: http://127.0.0.1:3088"));
