require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const morgan = require('morgan');
const stopwords = require('stopword');
const natural = require('natural');

const app = express();
const PORT = 4000;
const RESULTS_PER_PAGE = 4;

// 🔹 Configuração do Redis
const client = redis.createClient();
client.connect().catch((err) => console.error("❌ Erro ao conectar ao Redis:", err));

// 🔹 Middleware para logs organizados
app.use(morgan('tiny'));

// 🔹 Configuração de APIs externas
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

if (!GOOGLE_API_KEY || !GOOGLE_CX || !MISTRAL_API_KEY) {
    console.error("❌ ERRO: Faltando variáveis de ambiente (GOOGLE_API_KEY, GOOGLE_CX ou MISTRAL_API_KEY).");
    process.exit(1);
}

const CUSTOM_SEARCH_URL = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=`;
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

// 📌 Dicionário de palavras-chave jurídicas
const keywords = [
    "lei", "código", "regulamento", "norma", "direito", "portaria",
    "decreto", "constituição", "jurídico", "justiça", "processo", "legislação"
];

// 📌 Importando corretamente as stopwords em português
const stopwordsPt = stopwords.pt || stopwords["pt"] || [];

// 📌 Classificação semântica da consulta
function isValidLegalQuery(query) {
    if (!query || typeof query !== "string") {
        return false;
    }

    const words = query.toLowerCase().split(" ");

    // Verifica se `words` é um array antes de remover stopwords
    let filteredWords;
    try {
        filteredWords = stopwords.removeStopwords(words, stopwordsPt);
    } catch (error) {
        console.error("Erro ao remover stopwords:", error);
        filteredWords = words; // Se der erro, mantém as palavras originais
    }

    // Se a frase tiver menos de 2 palavras após remover stopwords, ela pode ser muito vaga
    if (filteredWords.length < 2) {
        return false;
    }

    // Usa NLP para verificar o contexto jurídico
    const stemmer = natural.PorterStemmerPt;
    const stemmedWords = filteredWords.map(word => stemmer.stem(word));

    // Se houver ao menos uma palavra jurídica, a consulta é válida
    return stemmedWords.some(word => keywords.includes(word));
}

// 🔍 **Busca no Google Custom Search com suporte a paginação**
async function searchGoogle(query, start = 1) {
    const googleApiUrl = `${CUSTOM_SEARCH_URL}${encodeURIComponent(query)}&num=${RESULTS_PER_PAGE}&start=${start}`;

    try {
        console.log(`🔍 Buscando no Google: ${query} (Início: ${start})`);
        const response = await axios.get(googleApiUrl);

        if (!response.data.items || response.data.items.length === 0) {
            console.log("⚠️ Nenhum resultado encontrado para essa busca.");
            return [];
        }

        return response.data.items.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            source: new URL(item.link).hostname
        }));
    } catch (error) {
        console.error("❌ Erro na busca do Google:", error.message);
        return null;
    }
}

// 🔍 **Reformulação da pesquisa usando Mistral AI**
async function reformulateQuery(originalQuery) {
    try {
        const response = await axios.post(MISTRAL_API_URL, {
            model: "mistral-7b-instruct",
            messages: [{ role: "user", content: `Essa pesquisa "${originalQuery}" não retornou nada. Reformule para que faça sentido em um contexto jurídico.` }]
        }, {
            headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` }
        });

        return response.data.choices?.[0]?.message?.content || originalQuery;
    } catch (error) {
        console.error("❌ Erro ao reformular a pesquisa com Mistral AI:", error.message);
        return originalQuery;
    }
}

// 📜 **Endpoint principal para pesquisa de leis com sugestões inteligentes**
app.get(['/search', '/buscar'], async (req, res) => {
    try {
        const query = req.query.q;
        const page = parseInt(req.query.page) || 1;
        const startIndex = (page - 1) * RESULTS_PER_PAGE + 1;

        if (!query) {
            return res.status(400).json({ error: 'O parâmetro "q" é obrigatório' });
        }

        console.log(`🚀 🔹 [${new Date().toLocaleString()}] Nova pesquisa recebida: "${query}" (Página ${page})`);

        // 🔹 1. Validação semântica da pesquisa
        if (!isValidLegalQuery(query)) {
            console.log("⚠️ Pesquisa sem contexto jurídico. Reformulando...");
            const reformulatedQuery = await reformulateQuery(query);

            return res.json({
                message: `❌ Sua pesquisa original não parece estar relacionada à legislação. Mas encontramos uma possível alternativa:`,
                suggestion: reformulatedQuery
            });
        }

        const cacheKey = `search-law:${query}:page:${page}`;
        const cachedData = await client.get(cacheKey);

        if (cachedData) {
            console.log(`♻️ Resultado recuperado do cache para "${query}" (Página ${page})`);
            return res.json(JSON.parse(cachedData));
        }

        // 🔹 2. Busca no Google com paginação
        let results = await searchGoogle(query, startIndex);

        if (results === null) {
            console.log("❌ Erro ao buscar no Google, retornando erro para o bot.");
            return res.status(500).json({ error: "Erro ao conectar com o Google. Tente novamente mais tarde." });
        }

        if (results.length > 0) {
            console.log(`✅ ${results.length} resultados encontrados para "${query}" (Página ${page})`);
            const responsePayload = {
                message: `📜 Encontramos ${results.length} leis relacionadas.`,
                results,
                nextPage: results.length === RESULTS_PER_PAGE ? `/buscar?q=${encodeURIComponent(query)}&page=${page + 1}` : null
            };

            await client.setEx(cacheKey, 3600, JSON.stringify(responsePayload)); // Cache por 1 hora
            return res.json(responsePayload);
        }

        // 🔥 3. Nenhum resultado encontrado? Reformular com Mistral AI
        console.log("⚠️ Nenhuma legislação encontrada, tentando reformular...");
        const reformulatedQuery = await reformulateQuery(query);

        return res.json({
            message: `⚠️ Nenhum resultado encontrado para "${query}". Você pode tentar reformular para:`,
            suggestion: reformulatedQuery
        });

    } catch (error) {
        console.error('❌ Erro ao buscar lei:', error);
        res.status(500).json({ error: 'Erro ao processar a solicitação' });
    }
});

// 🚀 **Inicia a API**
app.listen(PORT, () => {
    console.log(`\n🚀 =========================================`);
    console.log(`🚀 API de Pesquisa de Leis rodando na porta ${PORT}`);
    console.log(`🚀 Alias disponíveis: "/search" e "/buscar"`);
    console.log(`🚀 =========================================`);
});

