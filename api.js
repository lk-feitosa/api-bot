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
    console.error("❌ [API] ERRO: Faltando variáveis de ambiente (GOOGLE_API_KEY, GOOGLE_CX ou MISTRAL_API_KEY).");
    process.exit(1);
}

const CUSTOM_SEARCH_URL = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=`;
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

// 📌 **Validação e reformulação da pesquisa**
async function validateAndReformulateQuery(query) {
    query = ensureLawPrefix(query);

    if (legalKeywords.some(word => query.toLowerCase().includes(word))) {
        return { query, suggestion: null };
    }

    try {
        logAction("MISTRAL", `Validando pesquisa: ${query}`);
        const response = await axios.post(MISTRAL_API_URL, {
            model: "mistral-small",
            messages: [{
                role: "user",
                content: `A seguinte pesquisa de lei faz sentido jurídico? "${query}". Se fizer sentido, responda apenas com "VÁLIDO". Se não fizer, reformule para algo juridicamente correto.`
            }]
        }, {
            headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` },
            timeout: 5000  // ⏳ Adicionando timeout para evitar travamentos
        });

        const reformulatedQuery = response.data.choices?.[0]?.message?.content?.trim();
        logAction("MISTRAL", `Resposta do Mistral: ${reformulatedQuery}`);

        if (!reformulatedQuery || reformulatedQuery.toUpperCase() === "VÁLIDO") {
            return { query, suggestion: null };
        }

        return { query: null, suggestion: reformulatedQuery };
    } catch (error) {
        logAction("ERRO", "Mistral AI indisponível. Continuando sem validação...");
        return { query, suggestion: null };
    }
}

// 🔍 **Função para buscar no Google Custom Search**
async function searchGoogle(query) {
    try {
        const googleApiUrl = `${CUSTOM_SEARCH_URL}${encodeURIComponent(query)}&num=${RESULTS_PER_PAGE}`;
        logAction("GOOGLE", `Buscando no Google: ${query}`);
        
        const response = await axios.get(googleApiUrl);
        return response.data.items || [];
    } catch (error) {
        logAction("ERRO", `Erro ao buscar no Google: ${error.message}`);
        return [];
    }
}

// 📜 **Endpoint para analisar PDF e buscar leis similares**
app.post('/analisar-pdf', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Nenhum arquivo enviado." });
        }

        logAction("PDF", `Recebido arquivo: ${req.file.originalname}`);
        const buffer = req.file.buffer;
        let extractedText = "";

        try {
            const pdfData = await pdfParse(buffer);
            extractedText = pdfData.text.trim();
        } catch (err) {
            logAction("OCR", "PDF não pode ser lido diretamente, tentando OCR...");
            const ocrResult = await Tesseract.recognize(buffer, 'por');
            extractedText = ocrResult.data.text.trim();
        }

        if (!extractedText || extractedText.length < 50 || !legalKeywords.some(word => extractedText.toLowerCase().includes(word))) {
            return res.json({ message: "⚠️ O documento enviado não parece ser um projeto de lei válido." });
        }

        logAction("PDF", `Texto extraído: ${extractedText.substring(0, 200)}`);
        let results = await searchGoogle(extractedText);
        if (!results || results.length === 0) {
            return res.json({
                message: `⚠️ Nenhuma lei similar encontrada.\n\n💡 *Dica:* Tente reformular sua pesquisa começando com "Lei".`
            });
        }

        return res.json({
            message: "📜 Encontramos leis similares!",
            results: results.slice(0, 5)
        });
    } catch (error) {
        logAction("ERRO", "Erro ao processar o PDF: " + error.message);
        res.status(500).json({
            error: "Erro ao analisar o documento.",
            details: error.message
        });
    }
});

// 🚀 **Inicia a API**
app.listen(PORT, () => {
    logAction("API", `API de Pesquisa de Leis rodando na porta ${PORT}`);
    logAction("API", `Alias disponíveis: "/search", "/buscar" e "/analisar-pdf"`);
});
