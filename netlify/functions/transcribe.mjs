// Recibe un tramo de audio del navegador y lo transcribe con Groq (Whisper large v3 turbo).
// Variables de entorno: GROQ_API_KEY (obligatoria), GROQ_MODEL (opcional).

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const EXTENSIONES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const clave = process.env.GROQ_API_KEY;
  if (!clave) return json({ error: 'Falta configurar GROQ_API_KEY' }, 500);

  const audio = await req.arrayBuffer();
  if (!audio.byteLength) return json({ error: 'No llegó audio' }, 400);

  const tipo = (req.headers.get('content-type') || 'audio/webm').split(';')[0].trim();
  const form = new FormData();
  form.append('file', new Blob([audio], { type: tipo }), `tramo.${EXTENSIONES[tipo] || 'webm'}`);
  form.append('model', process.env.GROQ_MODEL || 'whisper-large-v3-turbo');
  form.append('language', 'es');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');

  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clave}` },
    body: form,
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return json({ error: data.error?.message || `Groq respondió ${r.status}` }, 502);
  }

  const segmentos = (data.segments || [])
    .map((s) => ({ start: s.start, end: s.end, text: (s.text || '').trim() }))
    .filter((s) => s.text);

  return json({ text: (data.text || '').trim(), segmentos });
};

export const config = { path: '/api/transcribe' };
