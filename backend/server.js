const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'deepseek-r1:1.5b';

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

// Endpoint de chat
app.post('/api/chat', async (req, res) => {
  const { message, model = DEFAULT_MODEL } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'El campo "message" es obligatorio y debe ser texto.' });
  }

  const systemPrompt = `Eres un asistente de entretenimiento. SOLO puedes responder preguntas relacionadas con entretenimiento: cine, televisión, series, música, videojuegos, libros, deportes, celebridades, cultura pop, anime, manga, teatro, conciertos, streaming, etc.

Si el usuario hace una pregunta que NO está relacionada con el entretenimiento, debes rechazarla amablemente diciendo: "Lo siento, solo puedo responder preguntas sobre entretenimiento. ¿Te gustaría saber algo sobre cine, música, series, videojuegos u otro tema de entretenimiento?"

No respondas preguntas sobre política, ciencia, matemáticas, programación, finanzas, salud, cocina, historia (a menos que sea historia del entretenimiento), ni ningún otro tema que no sea entretenimiento.`;

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
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const reply = data.message?.content || 'Sin respuesta del modelo.';
    res.json({ reply, model });
  } catch (error) {
    console.error('Error en /api/chat:', error.message);
    res.status(502).json({
      error: 'No se pudo obtener respuesta de Ollama.',
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
  console.log(`Frontend disponible en http://localhost:${PORT}`);
  console.log(`Conectado a Ollama en ${OLLAMA_URL}`);
  console.log(`Modelo por defecto: ${DEFAULT_MODEL}`);
});
