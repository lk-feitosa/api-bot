require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const morgan = require('morgan');
const sanitize = require('sanitize-html');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');

const app = express();
const PORT = 4000;
const RESULTS_PER_PAGE = 4;
const upload = multer();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔹 Configuração do Redis
const client = redis.createClient();
client.connect().catch((err) => console.error("❌ [API] Erro ao conectar ao Redis:", err));

// 🔹 Middleware para logs organizados
app.use(morgan('tiny'));

// 🔹 Middleware de segurança para limitar requisições
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: "⚠️ [API] Limite de requisições excedido. Tente novamente mais tarde."
});
app.use(limiter);

// 🔹 Configuração de APIs externas
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

if (!GOOGLE_API_KEY || !GOOGLE_CX || !MISTRAL_API_KEY) {
    console.error("❌ [API] ERRO: Faltando variáveis de ambiente (GOOGLE_API_KEY, GOOGLE_CX ou MISTRAL_API_KEY). ");
    process.exit(1);
}

const CUSTOM_SEARCH_URL = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}`;
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

// 📌 **Função de Log**
function logAction(type, message) {
    console.log(`📌 [${type.toUpperCase()}] ${message}`);
}

// 📌 **Lista de palavras-chave jurídicas**
const legalKeywords = [
    "lei", "código", "regulamento", "norma", "direito", "portaria",
    "decreto", "constituição", "jurídico", "justiça", "processo", "legislação",
    "estatuto", "resolução", "tribunal", "decisão", "juiz", "promulgação", "sancionada"
];

// 📌 **Sanitização e Validação de Input**
function sanitizeQuery(query) {
    return sanitize(query.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').trim());
}

// 📌 **Garante que "Lei" está no início da pesquisa**
function ensureLawPrefix(query) {
    query = sanitizeQuery(query);
    const words = query.toLowerCase().split(" ");
    if (!legalKeywords.includes(words[0])) {
        return `Lei ${query}`;
    }
    return query;
}

// 📌 **Busca no Google Custom Search com priorização para o Brasil**
async function searchGoogle(query) {
    const googleApiUrl = `${CUSTOM_SEARCH_URL}&q=${encodeURIComponent(query)}&num=${RESULTS_PER_PAGE}&gl=br`;

    try {
        logAction("API", `🔍 Buscando no Google: ${query}`);
        const response = await axios.get(googleApiUrl);
        return response.data.items || [];
    } catch (error) {
        logAction("ERRO", "Erro ao buscar no Google: " + error.message);
        return [];
    }
}

// 📜 **Endpoint para buscar leis** (Aceita GET e POST)
app.get(['/search', '/buscar'], async (req, res) => {
    let query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: 'O parâmetro "q" é obrigatório' });
    }
    query = ensureLawPrefix(query);
    logAction("API", `Pesquisa recebida: ${query}`);

    let results = await searchGoogle(query);
    if (!results || results.length === 0) {
        return res.json({
            message: `⚠️ Nenhuma lei encontrada para "${query}".\n\n💡 *Dica:* Tente reformular sua pesquisa começando com "Lei".`
        });
    }

    return res.json({ message: "📜 Leis encontradas:", results: results.slice(0, 5) });
});

app.post('/buscar', async (req, res) => {
    let query = req.body.q;
    if (!query) {
        return res.status(400).json({ error: 'O parâmetro "q" é obrigatório no corpo da requisição' });
    }
    query = ensureLawPrefix(query);
    logAction("API", `Pesquisa recebida via POST: ${query}`);

    let results = await searchGoogle(query);
    if (!results || results.length === 0) {
        return res.json({
            message: `⚠️ Nenhuma lei encontrada para "${query}".\n\n💡 *Dica:* Tente reformular sua pesquisa começando com "Lei".`
        });
    }

    return res.json({ message: "📜 Leis encontradas:", results: results.slice(0, 5) });
});

// 🚀 **Inicia a API**
app.listen(PORT, () => {
    logAction("API", `API de Pesquisa de Leis rodando na porta ${PORT}`);
    logAction("API", `Alias disponíveis: "/search", "/buscar" e "/analisar-pdf"`);
});
