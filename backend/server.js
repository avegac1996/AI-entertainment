const express = require('express');
const cors = require('cors');
const path = require('path');
const { getUPSContext, scrapeUPS } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3001;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'llama3.2:1b';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ollamaUrl: OLLAMA_URL });
});

// Listar modelos disponibles en Ollama
app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama respondió con status ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error al obtener modelos:', error.message);
    res.status(502).json({
      error: 'No se pudo conectar con Ollama.',
      details: error.message
    });
  }
});

// Endpoint de chat (streaming SSE)
app.post('/api/chat', async (req, res) => {
  const { message, model = DEFAULT_MODEL } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'El campo "message" es obligatorio y debe ser texto.' });
  }

  const isUPSQuery = /\bups\b|universidad|polit[eé]cnica|salesiana|salesiano|campus|facultad|admisi[oó]n|inscripci[oó]n/i.test(message);

  // Clasificador determinista: rechaza temas claramente fuera de jurisdicción
  const OFF_TOPIC = /f[úu]tbol|deporte|partido|pol[íi]tica|elecci[oó]n|receta|cocina|clima|meteorol|matem[aá]tic|programaci[oó]n|c[oó]digo|finanza|bolsa|inversi[oó]n|salud|medicina|m[úu]sica|canci[oó]n|\bserie|religi[oó]n|cripto|acciones/i;
  const IN_TOPIC = /pel[íi]cula|cine|film|libro|novela|videojuego|juego|gamer|consola|autor|actor|director|entretenimiento|\bups\b|universidad|polit[eé]cnica|salesiana|campus|facultad|carrera/i;

  if (OFF_TOPIC.test(message) && !IN_TOPIC.test(message)) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const rejection = 'Esa consulta está fuera de mi jurisdicción. Mi protocolo cubre películas, libros, videojuegos e información de la Universidad Politécnica Salesiana. ¿Desea consultar sobre alguno de estos temas?';
    res.write(`data: ${JSON.stringify({ content: rejection })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  let upsContext = '';
  if (isUPSQuery) {
    const scraped = await getUPSContext();
    if (scraped) {
      upsContext = `\n\nInformación actualizada extraída del sitio web oficial ups.edu.ec. Úsala como fuente principal para responder sobre la universidad:\n${scraped}`;
    }
  }

  const systemPrompt = `Eres JARVIS, una IA desarrollada en la Universidad Politécnica Salesiana (UPS). Puedes responder preguntas sobre cuatro categorías: PELÍCULAS, LIBROS, VIDEOJUEGOS y la UNIVERSIDAD POLITÉCNICA SALESIANA (sus carreras, campus, noticias, eventos e información institucional).

Si el usuario pregunta sobre cualquier otro tema (música, series, deportes, política, ciencia, matemáticas, programación, finanzas, salud, cocina, etc.), debes rechazarla respondiendo exactamente: "Esa consulta está fuera de mi jurisdicción. Mi protocolo cubre películas, libros, videojuegos e información de la Universidad Politécnica Salesiana. ¿Desea consultar sobre alguno de estos temas?"

Responde siempre de forma concisa y con un tono sofisticado, como un mayordomo digital. Máximo 3 recomendaciones por respuesta. Si la pregunta es sobre la UPS, basa tu respuesta en la información actualizada proporcionada; si el dato no está en esa información, dilo con honestidad.${upsContext}

MUY IMPORTANTE: tus respuestas serán narradas por voz. Responde ÚNICAMENTE en texto plano. NO uses formato markdown: nada de asteriscos, ni negritas, ni comillas, ni guiones bajos, ni numerales, ni símbolos especiales. Escribe como si hablaras en una conversación natural.`;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        stream: true,
        keep_alive: '30m',
        options: {
          num_predict: 512,
          num_ctx: isUPSQuery ? 4096 : 2048
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama status ${response.status}: ${errorText}`);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    req.on('close', () => {
      reader.cancel().catch(() => {});
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          const content = json.message?.content || '';
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
          if (json.done) {
            res.write('data: [DONE]\n\n');
          }
        } catch {
          // línea parcial, ignorar
        }
      }
    }

    res.end();
  } catch (error) {
    console.error('Error en /api/chat:', error.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'No se pudo obtener respuesta de Ollama.',
        details: error.message
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
  console.log(`Frontend disponible en http://localhost:${PORT}`);
  console.log(`Conectado a Ollama en ${OLLAMA_URL}`);
  console.log(`Modelo por defecto: ${DEFAULT_MODEL}`);
  scrapeUPS(); // carga inicial del contexto de la UPS (no bloqueante)
});
