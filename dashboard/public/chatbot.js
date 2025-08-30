const API_KEY_STORAGE = 'openai_api_key';
const SYSTEM_PROMPT = 'Du bist ein Werteexperte. Verwende die Funktion get_sensor_data, um aktuelle Messwerte zu holen, oder web_search, um im Internet zu recherchieren.';

const apiKeyInput = document.getElementById('api-key');
const saveKeyBtn = document.getElementById('save-key');
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatMic = document.getElementById('chat-mic');

// load stored API key
apiKeyInput.value = localStorage.getItem(API_KEY_STORAGE) || '';

saveKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  localStorage.setItem(API_KEY_STORAGE, key);
});

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function getDisplayedSensorData() {
  const parse = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const val = el.textContent.trim();
    const num = Number(val);
    return Number.isNaN(num) ? null : num;
  };
  return {
    iaq: parse('iaq'),
    co2: parse('co2'),
    temperature: parse('temp'),
    humidity: parse('hum'),
    dew_point: parse('dew')
  };
}

const messages = [
  { role: 'system', content: SYSTEM_PROMPT }
];

async function callOpenAI() {
  const key = localStorage.getItem(API_KEY_STORAGE);
  if (!key) {
    appendMessage('assistant', 'Bitte zuerst einen OpenAI API-Key speichern.');
    return;
  }
  const sensorData = getDisplayedSensorData();
  const msgs = [...messages, { role: 'system', content: 'Aktuelle Sensordaten: ' + JSON.stringify(sensorData) }];
  const body = {
    model: 'gpt-4o-mini',
    messages: msgs,
    functions: [
      {
        name: 'get_sensor_data',
        description: 'Aktuelle Sensordaten abrufen',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'web_search',
        description: 'Im Internet nach Informationen suchen',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Suchanfrage' } },
          required: ['query']
        }
      }
    ],
    function_call: 'auto'
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) {
    appendMessage('assistant', 'Keine Antwort erhalten.');
    return;
  }
  if (msg.function_call) {
    const fn = msg.function_call;
    let result = '';
    try {
      if (fn.name === 'get_sensor_data') {
        result = await fetch('/api/current').then(r => r.json());
      } else if (fn.name === 'web_search') {
        const args = JSON.parse(fn.arguments || '{}');
        const q = encodeURIComponent(args.query || '');
        const url = `https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1&no_html=1`;
        result = await fetch(url).then(r => r.json());
      }
    } catch (e) {
      result = { error: String(e) };
    }
    messages.push({ role: 'assistant', content: null, function_call: fn });
    messages.push({ role: 'function', name: fn.name, content: JSON.stringify(result) });
    return await callOpenAI();
  } else {
    appendMessage('assistant', msg.content);
    messages.push({ role: 'assistant', content: msg.content });
  }
}

chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  appendMessage('user', text);
  messages.push({ role: 'user', content: text });
  chatInput.value = '';
  await callOpenAI();
}

// speech recognition
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Recognition();
  rec.lang = 'de-DE';
  chatMic.addEventListener('click', () => rec.start());
  rec.onresult = e => {
    const t = e.results[0][0].transcript;
    chatInput.value = t;
  };
} else {
  chatMic.disabled = true;
}
