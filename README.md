# Grabadora Biz

Widget flotante para grabar llamadas y videollamadas desde el navegador (Chrome o Edge). Graba el micrófono y el audio del sistema. Cada vez que pausas o terminas, transcribe ese tramo con Whisper (vía Groq) y guarda un `.txt` en una carpeta del PC.

## Probar en local

1. Copia `.env.example` como `.env` y pega tu clave de Groq (https://console.groq.com/keys).
2. `npm run dev`
3. Abre http://localhost:8888 en Chrome o Edge.
4. Elige la carpeta donde guardar, abre el widget flotante y graba. En el diálogo del navegador elige **Pantalla completa** y activa **Compartir audio del sistema**.

## Subir a Netlify

- Conecta este repositorio en Netlify. `netlify.toml` ya define la carpeta `public` y las funciones.
- En *Site configuration → Environment variables* agrega `GROQ_API_KEY`.

## Estructura

- `public/`: la página y el widget (HTML, CSS, JS).
- `netlify/functions/transcribe.mjs`: recibe el audio y lo envía a Groq.
- `dev-server.mjs`: servidor local para probar sin instalar nada.
