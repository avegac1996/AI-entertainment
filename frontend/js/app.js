/* ============================================================
   J.A.R.V.I.S. — Entertainment Protocol
   Lógica del cliente: chat SSE, voz (TTS/STT), modos de vista
   ============================================================ */

const API_URL = '/api/chat';
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const voiceBtn = document.getElementById('voiceBtn');
const reactor = document.getElementById('reactor');
const statusEl = document.getElementById('status');
const voiceBars = document.getElementById('voiceBars');
const vmStatus = document.getElementById('vmStatus');
const micLedText = document.querySelector('.mic-led .led-text');

const REJECTION_PATTERN = /fuera de mi jurisdicci[oó]n/i;

let voiceEnabled = true;
let listening = false;

inputEl.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

function setStatus(text) {
  statusEl.textContent = text;
}

// Elimina caracteres de formato markdown para que la narración suene natural
function cleanText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[-•]\s*/gm, '')
    .replace(/^\d+\.\s*/gm, '')
    .replace(/["«»“”‘’]/g, '')
    .replace(/\*/g, '')
    .replace(/#/g, '');
}

function setReactorState(state) {
  reactor.classList.remove('thinking', 'listening');
  if (state) reactor.classList.add(state);
}

function addMessage(text, isUser, isError = false) {
  const div = document.createElement('div');
  div.className = `message ${isUser ? 'user' : 'bot'}`;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = isUser ? 'USUARIO' : 'JARVIS';
  const bubble = document.createElement('div');
  bubble.className = `bubble${isError ? ' error' : ''}`;
  bubble.textContent = text;
  div.appendChild(label);
  div.appendChild(bubble);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function addTyping() {
  const div = document.createElement('div');
  div.className = 'message bot';
  div.id = 'typing-indicator';
  div.innerHTML = '<span class="label">JARVIS // PROCESANDO</span><div class="typing"><span></span><span></span><span></span><span></span><span></span></div>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function sendTopic(text) {
  inputEl.value = text;
  sendMessage();
}

/* ===== Síntesis de voz (TTS) ===== */
let spanishVoice = null;

function loadVoices() {
  const voices = speechSynthesis.getVoices();
  spanishVoice = voices.find(v => v.lang.startsWith('es') && v.name.includes('Google'))
    || voices.find(v => v.lang.startsWith('es'))
    || null;
}

if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
} else {
  voiceEnabled = false;
  voiceBtn.style.display = 'none';
}

// Estado inicial del modo según disponibilidad de voz
document.body.classList.toggle('voice-mode', voiceEnabled);

function speak(text) {
  if (!voiceEnabled || !text.trim()) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  if (spanishVoice) utterance.voice = spanishVoice;
  utterance.rate = 1.05;
  utterance.pitch = 0.9;
  utterance.onstart = () => voiceBars.classList.add('active');
  utterance.onend = () => voiceBars.classList.remove('active');
  speechSynthesis.speak(utterance);
}

/* ===== Saludo de inicio por voz ===== */
const GREETING = 'Buenas. Soy JARVIS, una IA desarrollada en la Gloriosísima Universidad Politécnica Salesiana, su asistente de entretenimiento. Mi protocolo cubre películas, libros y videojuegos. Puede escribir su consulta o usar el micrófono para hablar. ¿En qué puedo asistirle?';
let greetingDone = false;

function playGreeting() {
  if (greetingDone || !voiceEnabled) return;
  greetingDone = true;
  speak(GREETING);
}

// Intentar al cargar; si el navegador bloquea el autoplay,
// se reproduce en la primera interacción del usuario
window.addEventListener('load', () => setTimeout(playGreeting, 800));
document.addEventListener('click', playGreeting, { once: true });
document.addEventListener('keydown', playGreeting, { once: true });

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  voiceBtn.classList.toggle('voice-off', !voiceEnabled);
  document.body.classList.toggle('voice-mode', voiceEnabled);
  if (!voiceEnabled) {
    speechSynthesis.cancel();
    voiceBars.classList.remove('active');
    document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
    vmStatus.classList.remove('rejected');
    vmStatus.textContent = 'Modo voz activo — La respuesta será narrada, el texto está oculto';
  }
  setStatus(voiceEnabled ? 'Modo narrativo activo — texto oculto' : 'Modo textual activo — voz desactivada');
}

// Resalta las tarjetas SVG según el tema detectado en la respuesta
// y abre el carrusel del tema en modo narrativo
function highlightThemes(text) {
  const lower = text.toLowerCase();
  let detected = null;
  if (/pel[ií]cula|cine|film|actor|director|taquilla/.test(lower)) {
    document.getElementById('card-movies').classList.add('active');
    detected = 'movies';
  } else if (/libro|novela|autor|literatura|saga|cap[ií]tulo/.test(lower)) {
    document.getElementById('card-books').classList.add('active');
    detected = 'books';
  } else if (/videojuego|juego|gamer|consola|jugabilidad|nivel/.test(lower)) {
    document.getElementById('card-games').classList.add('active');
    detected = 'games';
  }
  if (detected && voiceEnabled && currentTheme === null) {
    openTheme(detected, false);
  }
}

/* ===== Carrusel por tema ===== */
const THEMES = {
  movies: { title: 'Módulo: Películas', query: 'Recomiéndame 3 películas de ciencia ficción' },
  books: { title: 'Módulo: Libros', query: 'Recomiéndame 3 libros de fantasía' },
  games: { title: 'Módulo: Videojuegos', query: 'Recomiéndame 3 videojuegos de mundo abierto' }
};

const DEFAULT_VM_TITLE = 'Módulos de entretenimiento — Seleccione o hable su consulta';

let currentTheme = null;
let slideIndex = 0;
let slideCount = 0;
let carouselTimer = null;

function openTheme(theme, withQuery = true) {
  const store = document.getElementById('slides-' + theme);
  if (!store) return;

  currentTheme = theme;
  slideIndex = 0;

  const stage = document.getElementById('carouselSlide');
  stage.innerHTML = '';

  const svgs = store.querySelectorAll('svg');
  slideCount = svgs.length;

  svgs.forEach((svg, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'slide-item' + (i === 0 ? ' current' : '');
    wrap.appendChild(svg.cloneNode(true));
    const lbl = document.createElement('span');
    lbl.textContent = svg.dataset.label || '';
    wrap.appendChild(lbl);
    stage.appendChild(wrap);
  });

  buildDots();

  const visual = document.getElementById('visualMode');
  visual.classList.remove('theme-open');
  void visual.offsetWidth; // reinicia la animación de zoom
  visual.classList.add('theme-open');
  document.getElementById('vmTitle').textContent = THEMES[theme].title;

  document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
  document.getElementById('card-' + theme).classList.add('active');

  startAutoRotate();

  if (withQuery) sendTopic(THEMES[theme].query);
}

function closeTheme() {
  currentTheme = null;
  stopAutoRotate();
  document.getElementById('visualMode').classList.remove('theme-open');
  document.getElementById('vmTitle').textContent = DEFAULT_VM_TITLE;
  document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
}

function buildDots() {
  const dotsEl = document.getElementById('carouselDots');
  dotsEl.innerHTML = '';
  for (let i = 0; i < slideCount; i++) {
    const dot = document.createElement('button');
    if (i === 0) dot.classList.add('on');
    dot.addEventListener('click', () => goToSlide(i));
    dotsEl.appendChild(dot);
  }
}

function goToSlide(index) {
  const items = document.querySelectorAll('#carouselSlide .slide-item');
  const dots = document.querySelectorAll('#carouselDots button');
  if (!items.length) return;
  slideIndex = (index + slideCount) % slideCount;
  items.forEach((el, i) => el.classList.toggle('current', i === slideIndex));
  dots.forEach((el, i) => el.classList.toggle('on', i === slideIndex));
  restartAutoRotate();
}

function nextSlide() { goToSlide(slideIndex + 1); }
function prevSlide() { goToSlide(slideIndex - 1); }

function startAutoRotate() {
  stopAutoRotate();
  carouselTimer = setInterval(nextSlide, 3500);
}

function stopAutoRotate() {
  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }
}

function restartAutoRotate() {
  if (currentTheme !== null) startAutoRotate();
}

// Marca visualmente una respuesta fuera de jurisdicción
function markAsRejected(label, bubble) {
  bubble.classList.add('rejected');
  label.classList.add('rejected');
  label.textContent = 'JARVIS // FUERA DE JURISDICCIÓN';
  vmStatus.classList.add('rejected');
  vmStatus.textContent = 'Consulta fuera de jurisdicción — Temas permitidos: películas, libros, videojuegos';
}

/* ===== Reconocimiento de voz (STT) ===== */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    inputEl.value = transcript;
    sendMessage();
  };

  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove('mic-active');
    micBtn.textContent = '🎤';
    document.body.classList.remove('mic-on');
    micLedText.textContent = 'MIC: APAGADO';
    setReactorState(null);
    setStatus('Sistema en línea — Todos los módulos operativos');
  };

  recognition.onerror = (e) => {
    listening = false;
    micBtn.classList.remove('mic-active');
    micBtn.textContent = '🎤';
    document.body.classList.remove('mic-on');
    micLedText.textContent = 'MIC: APAGADO';
    setReactorState(null);
    if (e.error === 'not-allowed') {
      addMessage('Acceso al micrófono denegado. Habilítelo en los permisos del navegador.', false, true);
      setStatus('Micrófono denegado — revise los permisos del navegador');
    } else if (e.error !== 'aborted') {
      setStatus('Error de reconocimiento de voz: ' + e.error);
    }
  };
} else {
  micBtn.style.display = 'none';
}

function toggleMic() {
  if (!recognition) return;
  if (listening) {
    recognition.stop();
    return;
  }
  try {
    speechSynthesis.cancel();
    recognition.start();
    listening = true;
    micBtn.classList.add('mic-active');
    micBtn.textContent = '⏺ ESCUCHANDO';
    document.body.classList.add('mic-on');
    micLedText.textContent = 'MIC: ACTIVO';
    setReactorState('listening');
    setStatus('⏺ MICRÓFONO ACTIVO — Hable ahora');
  } catch {
    // ya estaba iniciado
  }
}

/* ===== Chat con streaming SSE ===== */
async function sendMessage() {
  const message = inputEl.value.trim();
  if (!message) return;

  addMessage(message, true);
  inputEl.value = '';
  sendBtn.disabled = true;
  addTyping();
  setReactorState('thinking');
  setStatus('Procesando consulta...');
  document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
  vmStatus.classList.remove('rejected');
  vmStatus.textContent = 'Modo voz activo — La respuesta será narrada, el texto está oculto';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    removeTyping();

    if (!res.ok) {
      const data = await res.json();
      addMessage(data.error || 'Error al conectar con el servidor', false, true);
    } else {
      const div = document.createElement('div');
      div.className = 'message bot';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = 'JARVIS';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      div.appendChild(label);
      div.appendChild(bubble);
      messagesEl.appendChild(div);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let rawText = '';
      let spokenUpTo = 0;
      let rejected = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') break;
          try {
            const json = JSON.parse(payload);
            if (json.content) {
              rawText += json.content;
              const cleaned = cleanText(rawText);
              bubble.textContent = cleaned;
              messagesEl.scrollTop = messagesEl.scrollHeight;
              highlightThemes(cleaned);

              if (!rejected && REJECTION_PATTERN.test(cleaned)) {
                rejected = true;
                markAsRejected(label, bubble);
              }

              // Hablar oraciones completas que aún no se narraron
              const pending = cleaned.slice(spokenUpTo);
              const sentenceMatch = pending.match(/^([\s\S]*?[.!?])\s+/);
              if (sentenceMatch) {
                speak(sentenceMatch[1]);
                spokenUpTo += sentenceMatch[0].length;
              }
            }
            if (json.error) {
              bubble.classList.add('error');
              bubble.textContent = json.error;
            }
          } catch {
            // fragmento parcial, ignorar
          }
        }
      }

      const remaining = cleanText(rawText).slice(spokenUpTo);
      if (remaining.trim()) speak(remaining);
    }
  } catch (err) {
    removeTyping();
    addMessage('No se pudo conectar con el backend. ¿Está corriendo en localhost:3001?', false, true);
  }

  sendBtn.disabled = false;
  setReactorState(null);
  setStatus('Sistema en línea — Todos los módulos operativos');
  inputEl.focus();
}

/* ===== Red neuronal animada de fondo ===== */
(function neuralNetwork() {
  const canvas = document.getElementById('neuralCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, nodes = [], pulses = [];
  const NODE_COUNT = 55;
  const MAX_DIST = 160;
  const PULSE_SPEED = 2.2;
  let thinking = false;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function initNodes() {
    nodes = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.8 + 0.8,
        pulse: Math.random() * Math.PI * 2
      });
    }
  }

  function spawnPulse(from, to) {
    pulses.push({ from, to, t: 0, speed: PULSE_SPEED / Math.hypot(to.x - from.x, to.y - from.y) });
  }

  function update() {
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      n.pulse += 0.03;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
    }

    // Pulses
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].t += pulses[i].speed * (thinking ? 2.5 : 1);
      if (pulses[i].t >= 1) pulses.splice(i, 1);
    }

    // Spawn pulses aleatorios
    if (Math.random() < (thinking ? 0.25 : 0.06) && nodes.length > 2) {
      const a = nodes[Math.floor(Math.random() * nodes.length)];
      for (const b of nodes) {
        if (a === b) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < MAX_DIST) {
          spawnPulse(a, b);
          break;
        }
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Conexiones
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < MAX_DIST) {
          const alpha = (1 - dist / MAX_DIST) * (thinking ? 0.28 : 0.14);
          ctx.strokeStyle = `rgba(0, 212, 255, ${alpha})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }

    // Pulses (paquetes de datos viajando por las conexiones)
    for (const p of pulses) {
      const x = p.from.x + (p.to.x - p.from.x) * p.t;
      const y = p.from.y + (p.to.y - p.from.y) * p.t;
      const glow = thinking ? 6 : 4;
      ctx.fillStyle = thinking ? 'rgba(120, 230, 255, 0.9)' : 'rgba(0, 212, 255, 0.7)';
      ctx.shadowBlur = glow;
      ctx.shadowColor = 'rgba(0, 212, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(x, y, thinking ? 2.2 : 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Nodos
    for (const n of nodes) {
      const breath = Math.sin(n.pulse) * 0.4 + 0.6;
      const radius = n.r * (thinking ? 1.4 : 1) * breath;
      ctx.fillStyle = thinking ? 'rgba(100, 220, 255, 0.85)' : 'rgba(0, 212, 255, 0.55)';
      ctx.shadowBlur = thinking ? 8 : 5;
      ctx.shadowColor = 'rgba(0, 212, 255, 0.6)';
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  // Observar el estado del reactor para reaccionar
  const observer = new MutationObserver(() => {
    thinking = reactor.classList.contains('thinking');
  });
  observer.observe(reactor, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('resize', () => { resize(); initNodes(); });
  resize();
  initNodes();
  loop();
})();
