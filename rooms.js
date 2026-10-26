/* Salas compatibles con server 7: hello.app=liveset, pset/pstage y blobs PDF. */
(() => {
'use strict';
const el=id=>document.getElementById(id), escape=escapeHtml;
let selectedInstrument=localStorage.getItem('liveSetInstrument')||'General';
let room=null, socket=null, retry=null, stopped=true, backup=null, masterBlobs=new Map(), downloads=new Map(), guestCache=new Map(), desired=null, viewKey='', pdfSeq=0, publishing=Promise.resolve();
const hex=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const parts=s=>[{id:'main',instrument:s.instrument||'General',data:s.data,blobId:s.blobId},...(s.parts||[])];
const status=t=>{el('roomStatus').textContent=t;el('roomBadge').textContent=t;};
function send(m){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(m));}
function endpoint(){const u=new URL(el('roomServer').value.trim()||location.origin);if(!['http:','https:','ws:','wss:'].includes(u.protocol))throw Error('Usa una dirección http, https, ws o wss');if(location.protocol==='https:'&&['http:','ws:'].includes(u.protocol))throw Error('Desde una app HTTPS usa un servidor HTTPS / WSS. Para la red local abre la app desde el servidor local.');u.protocol=['https:','wss:'].includes(u.protocol)?'wss:':'ws:';u.pathname=u.pathname.replace(/\/(?:sync)?$/,'')+'/sync';u.search='';u.hash='';return u.href;}
function httpBase(ws){const u=new URL(ws);u.protocol=u.protocol==='wss:'?'https:':'http:';u.pathname=u.pathname.replace(/\/sync$/,'');return u.href.replace(/\/$/,'');}
function openModal(){el('roomModal').classList.add('open');populateInstruments();updateRole();}
function populateInstruments(){const values=new Set([selectedInstrument]);for(const s of songs)for(const p of (room?.role==='slave'?s.parts:parts(s)))values.add(p.instrument);el('roomInstrument').innerHTML=[...values].sort().map(n=>`<option value="${escape(n)}">${escape(n)}</option>`).join('');el('roomInstrument').value=selectedInstrument;}
function updateRole(){const slave=room?.role==='slave';el('showView').classList.toggle('room-slave',!!slave);el('roomLeave').hidden=!room;el('roomCreate').disabled=!!room;el('roomJoin').disabled=!!room;el('roomServer').disabled=!!room;el('roomCode').disabled=!!room;for(const id of ['btnPrevSong','btnNextSong','dockPrev','dockNext'])if(slave)el(id).disabled=true;}
async function throttleSocket(ws){while(ws===socket && ws.readyState===1 && ws.bufferedAmount>512*1024)await new Promise(r=>setTimeout(r,25));if(ws!==socket||ws.readyState!==1)throw Error('Conexión interrumpida');}
async function uploadBlob(id){const data=masterBlobs.get(id), ws=socket;if(!data||!ws)return;const size=128*1024,n=Math.ceil(data.length/size);for(let i=0;i<n;i++){await throttleSocket(ws);ws.send(JSON.stringify({type:'blob',id,i,n,data:data.slice(i*size,(i+1)*size)}));}}
async function publishSet(){
 if(room?.role!=='master'||!currentSetlist)return;
 const sl=currentSetlist, metadata=[];masterBlobs.clear();
 for(const id of sl.songIds){const s=songs.find(s=>s.id===id);if(!s)continue;s.blobId ||= hex();for(const p of s.parts||[])p.blobId ||= hex();await idbPut('songs',s);const ps=parts(s);for(const p of ps)masterBlobs.set(p.blobId,p.data);metadata.push({id:s.id,name:s.name,duration:s.duration,parts:ps.map(({data,...p})=>p)});}
 const msg={type:'pset',set:{app:'liveset',setlist:{id:sl.id,name:sl.name,songIds:[...sl.songIds]},songs:metadata}};
 if(JSON.stringify(msg).length>450*1024)throw Error('Demasiados temas en la sala');
 send(msg);publishStage();status(`Maestro · sala ${room.code} · compartiendo partituras…`);
 for(const id of masterBlobs.keys())await uploadBlob(id);
 status(`Maestro · sala ${room.code} · listo`);
}
function queuePublish(){publishing=publishing.catch(()=>{}).then(publishSet).catch(e=>status(e.message));return publishing;}
function publishStage(){if(room?.role==='master'&&currentSetlist)send({type:'pstage',stage:{activeSongId:currentSetlist.songIds[currentIndex],songIds:[...currentSetlist.songIds]}});}
function requestBlob(id){if(guestCache.has(id))return Promise.resolve(guestCache.get(id));if(downloads.has(id))return downloads.get(id).promise;let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});const d={promise,resolve,reject,parts:[],n:0};d.timer=setTimeout(()=>{downloads.delete(id);reject(Error('No llegó el PDF. Comprueba la conexión del maestro y vuelve a elegir el instrumento.'));},60000);downloads.set(id,d);send({type:'getblob',id});return promise;}
async function applyGuest(){
 if(room?.role!=='slave'||!desired||!currentSetlist)return;
 const i=currentSetlist.songIds.indexOf(desired);if(i<0)return;
 const s=songs.find(s=>s.id===desired),p=s?.parts?.find(p=>p.instrument===selectedInstrument);
 const key=desired+'|'+selectedInstrument+'|'+(p?.blobId||'missing');if(key===viewKey){currentIndex=i;renderStrip();updateRole();return;}viewKey=key;
 el('showView').classList.add('open');setFocus(true);closeSidebar();
 await loadSong(i);updateRole();
}
function receiveSet(set){
 if(room?.role!=='slave'||set?.app!=='liveset'||!Array.isArray(set.songs)||!Array.isArray(set.setlist?.songIds))return;
 if(!backup)backup={songs,setlists};
 songs=set.songs.map(s=>({...s,parts:s.parts||[]}));currentSetlist={...set.setlist,songIds:[...set.setlist.songIds]};setlists=[currentSetlist];
 const instruments=songs.flatMap(s=>s.parts.map(p=>p.instrument));if(!instruments.includes(selectedInstrument)&&instruments.length)selectedInstrument=instruments[0];populateInstruments();viewKey='';applyGuest().catch(e=>status(e.message));
}
function receiveStage(stage){if(room?.role!=='slave'||!stage?.activeSongId)return;desired=stage.activeSongId;if(currentSetlist&&Array.isArray(stage.songIds)&&stage.songIds.length===currentSetlist.songIds.length&&new Set(stage.songIds).size===stage.songIds.length&&stage.songIds.every(id=>currentSetlist.songIds.includes(id)))currentSetlist.songIds=[...stage.songIds];renderStrip();applyGuest().catch(e=>status(e.message));}
function connect(){
 if(stopped||!room)return;const ws=new WebSocket(room.server);socket=ws;status('Conectando…');
 ws.onopen=()=>ws.send(JSON.stringify({type:'hello',room:room.code,role:room.role,app:'liveset'}));
 ws.onmessage=ev=>{if(ws!==socket)return;let m;try{m=JSON.parse(ev.data);}catch{return;}
 if(m.type==='welcome'){
  status(`${room.role==='master'?'Maestro':'Esclavo'} · sala ${room.code}`);
  if(room.role==='master')queuePublish();else{receiveSet(m.relay?.pset?.set);receiveStage(m.relay?.pstage?.stage);for(const id of downloads.keys())send({type:'getblob',id});if(!m.hasMaster)status('Esperando al maestro…');}
 }else if(m.type==='error'){status(m.msg||'Error de sala');stopped=true;ws.close();room=null;updateRole();}
 else if(m.type==='pset')receiveSet(m.set);
 else if(m.type==='pstage')receiveStage(m.stage);
 else if(m.type==='needblob'&&room?.role==='master')uploadBlob(m.id).catch(e=>status(e.message));
 else if(m.type==='blob'){
  const d=downloads.get(m.id);if(!d||!Number.isInteger(m.n)||m.n<1||m.n>512||!Number.isInteger(m.i)||m.i<0||m.i>=m.n||typeof m.data!=='string'||m.data.length>256*1024)return;
  if(d.n&&d.n!==m.n)return;d.n=m.n;d.parts[m.i]=m.data;
  if(Array.from({length:d.n},(_,i)=>typeof d.parts[i]==='string').every(Boolean)){const data=d.parts.join('');clearTimeout(d.timer);downloads.delete(m.id);guestCache.set(m.id,data);d.resolve(data);}
 }else if(m.type==='masterGone')status('Maestro desconectado · puedes seguir leyendo');
 else if(m.type==='peers')status(`${room?.role==='master'?'Maestro':'Esclavo'} · sala ${room?.code} · ${m.count} participantes${m.hasMaster?'':' · esperando maestro'}`);
 };
 ws.onclose=()=>{if(ws!==socket||stopped)return;status('Sin conexión · reconectando…');retry=setTimeout(connect,2000);};
 ws.onerror=()=>status('No se pudo conectar al servidor');
}
async function shareQR(){
 let base=el('roomAppUrl').value.trim()||location.href.split('#')[0];const u=new URL(base);
 if(['localhost','127.0.0.1'].includes(u.hostname)){
  try{const info=await fetch(httpBase(room.server)+'/info').then(r=>r.json());if(info.ips?.length){u.hostname=info.ips[0];if(u.port)u.port=String(info.port);}}catch{}
 }
 if(!['http:','https:'].includes(u.protocol)||['localhost','127.0.0.1'].includes(u.hostname))throw Error('Indica la dirección de la app accesible desde los otros dispositivos para generar el QR');
 let srv=room.server;const su=new URL(srv);if(['localhost','127.0.0.1'].includes(su.hostname))su.hostname=u.hostname;srv=su.href;
 u.hash=new URLSearchParams({room:room.code,server:srv}).toString();
 const qr=qrcode(0,'M');qr.addData(u.href);qr.make();el('roomQR').innerHTML=qr.createSvgTag({cellSize:4,margin:4,scalable:true});el('roomShareLink').href=u.href;el('roomShareLink').textContent=u.href;el('roomShare').hidden=false;
}
async function start(role){
 try{if(room)return;if(role==='master'&&(!currentSetlist?.songIds.length||!el('showView').classList.contains('open')))throw Error('Abre primero el set list que quieres compartir');
 const code=el('roomCode').value.trim()||(role==='master'?String(1000+crypto.getRandomValues(new Uint16Array(1))[0]%9000):'');if(!/^\d{4}$/.test(code))throw Error('Escribe un código de sala de 4 dígitos');
 const server=endpoint();localStorage.setItem('liveSetServer',el('roomServer').value);room={role,code,server};el('roomCode').value=code;stopped=false;updateRole();connect();if(role==='master'){el('roomShare').hidden=false;await shareQR();}
 }catch(e){status(e.message);}
}
function leave(){stopped=true;clearTimeout(retry);socket?.close();socket=null;room=null;desired=null;viewKey='';pdfSeq++;for(const d of downloads.values()){clearTimeout(d.timer);d.reject(Error('Saliste de la sala'));}downloads.clear();guestCache.clear();masterBlobs.clear();if(backup){songs=backup.songs;setlists=backup.setlists;backup=null;currentSetlist=null;renderLibrary();renderSetlists();}el('roomShare').hidden=true;updateRole();status('Sin sala');}
window.editSongParts=editParts;
let editingSong=null;
function editParts(id){editingSong=songs.find(s=>s.id===id);if(!editingSong)return;el('partsTitle').textContent=editingSong.name;el('partsModal').classList.add('open');drawParts();}
function drawParts(){el('partsList').innerHTML=parts(editingSong).map(p=>`<div class="song-row"><span class="song-name">${escape(p.instrument)}</span><button class="btn small" data-part-name="${escape(p.id)}">Renombrar</button>${p.id!=='main'?`<button class="btn danger small" data-part-delete="${escape(p.id)}">✕</button>`:''}</div>`).join('');el('partsList').querySelectorAll('[data-part-name]').forEach(b=>b.onclick=async()=>{const p=parts(editingSong).find(p=>p.id===b.dataset.partName),name=prompt('Instrumento',p.instrument)?.trim();if(!name)return;if(parts(editingSong).some(x=>x.id!==p.id&&x.instrument.toLowerCase()===name.toLowerCase()))return toast('Ese instrumento ya existe');if(p.id==='main')editingSong.instrument=name;else editingSong.parts.find(x=>x.id===p.id).instrument=name;await saveParts();});el('partsList').querySelectorAll('[data-part-delete]').forEach(b=>b.onclick=async()=>{editingSong.parts=editingSong.parts.filter(p=>p.id!==b.dataset.partDelete);await saveParts();});}
async function saveParts(){await idbPut('songs',editingSong);drawParts();renderLibrary();populateInstruments();if(room?.role==='master')queuePublish();}
el('partsUpload').onchange=async ev=>{const file=ev.target.files[0];ev.target.value='';if(!file||!editingSong)return;const name=el('partsInstrument').value.trim();if(!name)return toast('Escribe el instrumento');if(parts(editingSong).some(p=>p.instrument.toLowerCase()===name.toLowerCase()))return toast('Ese instrumento ya existe; renómbralo o elimina su versión');if(file.size>40*1024*1024)return toast('El PDF supera 40 MB');try{const data=await fileToBase64(file);if(!data.startsWith('JVBER'))throw Error('Selecciona un PDF válido');editingSong.parts ||= [];editingSong.parts.push({id:hex(),instrument:name,data,blobId:hex()});await saveParts();el('partsInstrument').value='';toast('Partitura agregada');}catch(e){toast(e.message);}};
el('partsAdd').onclick=()=>{if(!el('partsInstrument').value.trim())return toast('Escribe primero el instrumento');el('partsUpload').click();};
el('partsClose').onclick=()=>el('partsModal').classList.remove('open');
const originalPdf=renderPdf;
renderPdf=async function(song){const seq=++pdfSeq;renderToken++;releasePdfResources();el('viewerStack').textContent='Cargando partitura…';const available=room?.role==='slave'?song.parts:parts(song);const p=available.find(p=>p.instrument===selectedInstrument);
 if(!p){renderToken++;releasePdfResources();el('viewerStack').textContent=`No hay partitura de ${selectedInstrument} para este tema. Pulsa 🎼 Sala para elegir otro instrumento.`;el('pageThumbs')?.replaceChildren();return;}
 try{const data=p.data||await requestBlob(p.blobId);if(seq!==pdfSeq)return;await originalPdf({...song,id:(room?.role==='slave'?'room-'+room.code+'-':'')+song.id+(p.id==='main'?'':'-'+p.id),data});}catch(e){if(seq===pdfSeq){viewKey='';el('viewerStack').textContent=e.message;status(e.message);}}
};
const originalLoad=loadSong;
loadSong=async function(i){if(room?.role==='slave'&&currentSetlist?.songIds[i]!==desired)return;const result=originalLoad(i);updateRole();publishStage();return result;};
document.addEventListener('setlist-order-changed',publishStage);
const originalOrder=updateShowOrder;
updateShowOrder=async function(order){if(room?.role==='slave'){renderStrip();return;}await originalOrder(order);publishStage();};
el('showStrip').addEventListener('pointerdown',e=>{if(room?.role==='slave'&&e.target.closest('.handle'))e.stopImmediatePropagation();},true);
const originalOpen=openShow;
openShow=function(id){originalOpen(id);if(room?.role==='master')queuePublish();};
const originalClose=el('btnCloseShow').onclick;
el('btnCloseShow').onclick=()=>{leave();originalClose();};
el('roomInstrument').onchange=async()=>{selectedInstrument=el('roomInstrument').value;localStorage.setItem('liveSetInstrument',selectedInstrument);viewKey='';if(room?.role==='slave')await applyGuest();else if(currentSetlist&&el('showView').classList.contains('open'))await loadSong(currentIndex);};
el('roomCreate').onclick=()=>start('master');el('roomJoin').onclick=()=>start('slave');el('roomLeave').onclick=leave;el('roomClose').onclick=()=>el('roomModal').classList.remove('open');el('roomQRRefresh').onclick=()=>shareQR().catch(e=>status(e.message));
for(const id of ['btnRoom','dockRoom','topRoom'])el(id).onclick=openModal;
el('roomServer').value=localStorage.getItem('liveSetServer')||(/^https?:$/.test(location.protocol)?location.origin:'http://192.168.1.10:8080');el('roomAppUrl').value=/^https?:$/.test(location.protocol)?location.href.split('#')[0]:'';
const link=new URLSearchParams(location.hash.slice(1));if(/^\d{4}$/.test(link.get('room')||'')){el('roomCode').value=link.get('room');if(link.get('server'))el('roomServer').value=link.get('server');ready.then(()=>{openModal();status('Elige tu instrumento y pulsa Unirse como esclavo');});}
status('Sin sala');
})();
