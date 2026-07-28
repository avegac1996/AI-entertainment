const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'llama3.2';

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

  const systemPrompt = `Eres JARVIS, un asistente de entretenimiento futurista. SOLO puedes responder preguntas sobre tres categorías: PELÍCULAS, LIBROS y VIDEOJUEGOS.

Si el usuario pregunta sobre cualquier otro tema (música, series, deportes, política, ciencia, matemáticas, programación, finanzas, salud, cocina, etc.), debes rechazarla amablemente diciendo: "Lo siento, mi protocolo solo cubre películas, libros y videojuegos. ¿Sobre cuál de estos temas deseas consultar?"

Responde siempre de forma concisa y con un tono sofisticado, como un mayordomo digital. Máximo 3 recomendaciones por respuesta.`;

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
          num_ctx: 2048
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
});
