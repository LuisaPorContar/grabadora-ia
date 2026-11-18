// Grabadora: captura micrófono + audio del sistema, transcribe cada tramo al pausar o terminar
// y guarda un .txt en la carpeta del PC que elija la persona.

const $ = (id) => document.getElementById(id);
const pill = $('pill');
const ui = {
  tiempo: $('tiempo'),
  llamada: $('btnLlamada'),
  nota: $('btnNota'),
  grabar: $('btnGrabar'),
  parar: $('btnParar'),
  estado: $('estado'),
  bars: [...pill.querySelectorAll('.bars i')],
  carpetaBtn: $('btnCarpeta'),
  carpetaNombre: $('carpetaNombre'),
};

const TRAMO_MAX_MS = 10 * 60 * 1000; // cada 10 min se transcribe solo, aunque no pauses

let carpeta = null;
let modo = 'idle'; // idle | recording | paused
let sesion = null;

// ---------- Utilidades ----------

const dos = (n) => String(n).padStart(2, '0');

function reloj(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? `${h}:` : '') + `${dos(m)}:${dos(s % 60)}`;
}

function nombreArchivo(fecha, tipo) {
  return `${tipo === 'nota' ? 'nota' : 'llamada'}-${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}_${dos(fecha.getHours())}-${dos(fecha.getMinutes())}.txt`;
}

// tipo: '' (normal), 'ok' (verde, guardado) o 'error' (rojo)
function setEstado(texto, tipo = '') {
  ui.estado.textContent = texto;
  ui.estado.title = texto;
  ui.estado.className = `estado ${tipo}`;
}

function setModo(nuevo) {
  modo = nuevo;
  pill.dataset.modo = nuevo;
  const quieto = nuevo === 'idle';
  ui.llamada.hidden = !quieto;
  ui.nota.hidden = !quieto;
  ui.tiempo.hidden = quieto;
  ui.grabar.hidden = quieto;
  ui.parar.hidden = quieto;
  const titulo = nuevo === 'recording' ? 'Pausar y guardar' : 'Continuar';
  ui.grabar.title = titulo;
  ui.grabar.setAttribute('aria-label', titulo);
}

// ---------- Carpeta (se recuerda entre visitas) ----------

function abrirDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('grabadora', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function guardarKV(k, v) {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function leerKV(k) {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const r = db.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function permisoCarpeta() {
  return carpeta ? carpeta.queryPermission({ mode: 'readwrite' }) : 'none';
}

async function pintarCarpeta() {
  if (!carpeta) {
    ui.carpetaBtn.textContent = 'Elegir carpeta';
    ui.carpetaNombre.textContent = 'Sin carpeta';
    return;
  }
  const ok = (await permisoCarpeta()) === 'granted';
  ui.carpetaBtn.textContent = ok ? 'Cambiar carpeta' : 'Permitir carpeta';
  ui.carpetaNombre.textContent = ok ? `Guardando en: ${carpeta.name}` : `${carpeta.name} (dale permiso de nuevo)`;
}

ui.carpetaBtn.addEventListener('click', async () => {
  if (!('showDirectoryPicker' in window)) {
    ui.carpetaNombre.textContent = 'Este navegador no puede guardar en carpetas. Usa Chrome o Edge.';
    return;
  }
  try {
    if (carpeta && (await permisoCarpeta()) !== 'granted') {
      await carpeta.requestPermission({ mode: 'readwrite' });
    } else {
      carpeta = await window.showDirectoryPicker({ id: 'grabadora', mode: 'readwrite', startIn: 'documents' });
      await guardarKV('carpeta', carpeta);
    }
  } catch {
    /* la persona canceló */
  }
  pintarCarpeta();
});

// ---------- Grabación ----------

// tipo: 'llamada' (micrófono + audio del sistema) o 'nota' (solo micrófono, sin compartir pantalla)
async function iniciar(tipo) {
  if ((await permisoCarpeta()) !== 'granted') {
    setEstado('Primero elige la carpeta donde guardar (en la página).', 'error');
    return;
  }

  let pantalla = null;
  let conAudioSistema = false;
  if (tipo === 'llamada') {
    setEstado('Elige tu pantalla y activa el audio del sistema');
    try {
      pantalla = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' }, // abre directo en "Pantalla completa"
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
        monitorTypeSurfaces: 'include',
      });
    } catch (e) {
      setEstado(e.name === 'InvalidStateError' ? 'Dale al botón desde la página de la grabadora.' : 'Cancelado. Dale de nuevo al botón.');
      return;
    }
    // Sin audio del sistema igual se graba: queda el micrófono (que con parlantes también capta al otro).
    conAudioSistema = pantalla.getAudioTracks().length > 0;
  }

  let mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    pantalla?.getTracks().forEach((t) => t.stop());
    setEstado('Sin acceso al micrófono: permítelo en el candado de la barra de direcciones.', 'error');
    return;
  }

  const ctx = new AudioContext();
  await ctx.resume();
  const dest = ctx.createMediaStreamDestination();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  for (const s of conAudioSistema ? [pantalla, mic] : [mic]) {
    const fuente = ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks()));
    fuente.connect(dest);
    fuente.connect(analyser);
  }

  const ahora = new Date();
  sesion = {
    tipo,
    nombre: nombreArchivo(ahora, tipo),
    inicio: ahora,
    partes: [],
    streams: [pantalla, mic].filter(Boolean),
    ctx,
    dest,
    analyser,
    acumuladoMs: 0,
    cola: Promise.resolve(),
    pendientes: 0,
    grabadora: null,
  };

  // Si la persona pulsa "Dejar de compartir" en Chrome, se termina la grabación.
  const s = sesion;
  pantalla?.getTracks().forEach((t) => t.addEventListener('ended', () => { if (sesion === s) terminar(); }));

  empezarTramo(s);
  setModo('recording');
  if (tipo === 'nota') setEstado('Grabando tu voz…');
  else setEstado(conAudioSistema ? 'Grabando la llamada…' : 'Grabando solo tu micrófono (audio del sistema apagado)');
}

function empezarTramo(s) {
  const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(s.dest.stream, { mimeType: tipo, audioBitsPerSecond: 32000 });
  const trozos = [];
  const offsetMs = s.acumuladoMs;
  let alTerminar;
  const terminado = new Promise((r) => { alTerminar = r; });

  rec.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(trozos, { type: rec.mimeType || 'audio/webm' });
    if (blob.size > 2000) encolar(s, blob, offsetMs);
    alTerminar();
  };
  rec.start(1000);

  s.grabadora = { rec, inicio: performance.now(), terminado };
  s.rotador = setTimeout(() => {
    if (sesion === s && modo === 'recording') {
      cerrarTramo(s);
      empezarTramo(s);
    }
  }, TRAMO_MAX_MS);
}

function cerrarTramo(s) {
  const g = s.grabadora;
  if (!g) return Promise.resolve();
  clearTimeout(s.rotador);
  s.acumuladoMs += performance.now() - g.inicio;
  s.grabadora = null;
  g.rec.stop();
  return g.terminado;
}

function encolar(s, blob, offsetMs) {
  s.pendientes++;
  setEstado('Transcribiendo…');
  s.cola = s.cola.then(async () => {
    try {
      const r = await transcribir(blob);
      s.partes.push(formatear(r, offsetMs));
    } catch (e) {
      s.partes.push(`[${reloj(offsetMs)}] (No se pudo transcribir este tramo: ${e.message})`);
    }
    s.pendientes--;
    try {
      await guardarTxt(s);
      if (!s.pendientes) setEstado(`✓ Guardado en ${carpeta.name}/${s.nombre}`, 'ok');
    } catch (e) {
      setEstado(`✗ No se pudo guardar el .txt: ${e.message}`, 'error');
    }
  });
}

async function transcribir(blob) {
  const r = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

function formatear(r, offsetMs) {
  if (r.segmentos?.length) {
    return r.segmentos.map((s) => `[${reloj(offsetMs + s.start * 1000)}] ${s.text}`).join('\n');
  }
  return r.text ? `[${reloj(offsetMs)}] ${r.text}` : '';
}

async function guardarTxt(s) {
  const cuerpo = s.partes.filter(Boolean).join('\n\n') || '(No se detectó voz)';
  const titulo = s.tipo === 'nota' ? 'Nota de voz' : 'Llamada';
  const contenido = `${titulo} del ${s.inicio.toLocaleString('es-CO')}\n\n${cuerpo}\n`;
  const archivo = await carpeta.getFileHandle(s.nombre, { create: true });
  const w = await archivo.createWritable();
  await w.write(contenido);
  await w.close();
}

function pausar() {
  cerrarTramo(sesion);
  setModo('paused');
  setEstado('Pausado · transcribiendo y guardando…');
}

function reanudar() {
  empezarTramo(sesion);
  setModo('recording');
  setEstado('Grabando…');
}

async function terminar() {
  const s = sesion;
  if (!s) return;
  sesion = null;
  setModo('idle');
  await cerrarTramo(s);
  s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
  s.ctx.close();
  if (s.pendientes) setEstado('Terminado · transcribiendo y guardando…');
  else if (!s.partes.length) setEstado('Terminado · no se grabó audio');
  ui.tiempo.textContent = reloj(s.acumuladoMs);
}

async function empezar(tipo) {
  if (modo !== 'idle') return;
  // Si se empieza desde la página, el widget pasa a flotar solo.
  if (!flotanteAbierto()) await abrirFlotante().catch(() => {});
  iniciar(tipo);
}

ui.llamada.addEventListener('click', () => empezar('llamada'));
ui.nota.addEventListener('click', () => empezar('nota'));
ui.grabar.addEventListener('click', () => {
  if (modo === 'recording') pausar();
  else if (modo === 'paused') reanudar();
});
ui.parar.addEventListener('click', terminar);

// ---------- Reloj y barras ----------

const niveles = new Uint8Array(32);
setInterval(() => {
  if (!sesion) {
    ui.bars.forEach((b) => { b.style.height = '4px'; });
    return;
  }
  const g = sesion.grabadora;
  ui.tiempo.textContent = reloj(sesion.acumuladoMs + (g ? performance.now() - g.inicio : 0));
  sesion.analyser.getByteFrequencyData(niveles);
  ui.bars.forEach((b, i) => {
    const v = modo === 'recording' ? niveles[i * 2 + 1] / 255 : 0;
    b.style.height = `${4 + Math.round(v * 22)}px`;
  });
}, 120);

// ---------- Widget flotante ----------

function flotanteAbierto() {
  return 'documentPictureInPicture' in window && !!documentPictureInPicture.window;
}

async function abrirFlotante() {
  if (!('documentPictureInPicture' in window)) {
    setEstado('Tu navegador no tiene widget flotante. Usa Chrome o Edge.');
    return;
  }
  if (documentPictureInPicture.window) return;
  const pip = await documentPictureInPicture.requestWindow({ width: 300, height: 100 });
  const link = pip.document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('styles.css', location.href).href;
  pip.document.head.append(link);
  pip.document.title = 'Grabadora Biz';
  pip.document.body.className = 'pip';
  pip.document.body.append(pill);
  pip.addEventListener('pagehide', () => $('pillHome').append(pill));
}

$('btnFlotante').addEventListener('click', () => abrirFlotante().catch(() => {}));

// Aviso si se cierra la pestaña con una grabación en curso.
window.addEventListener('beforeunload', (e) => {
  if (sesion) e.preventDefault();
});

// ---------- Arranque ----------

leerKV('carpeta')
  .then((h) => { carpeta = h || null; })
  .catch(() => {})
  .finally(pintarCarpeta);
