require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const morgan = require('morgan');
const stopwords = require('stopword');

const app = express();
const PORT = 4000;

// 🔹 Configuração do Redis
const client = redis.createClient();
client.connect().catch((err) => console.error("❌ Erro ao conectar ao Redis:", err));

// 🔹 Middleware para logs organizados
app.use(morgan('tiny'));

// 🔹 Configuração de APIs externas
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.error("❌ ERRO: Faltando variáveis de ambiente (GOOGLE_API_KEY ou GOOGLE_CX).");
    process.exit(1);
}

const CUSTOM_SEARCH_URL = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=`;

// 📌 Palavras-chave jurídicas
const keywords = [
    "lei", "código", "regulamento", "norma", "direito", "portaria",
    "decreto", "constituição", "jurídico", "justiça", "processo", "legislação"
];

// 📌 Dicionário de sinônimos para sugestões
const synonyms = {
    "trabalho": ["emprego", "CLT", "direitos trabalhistas"],
    "internet": ["wifi", "rede pública", "banda larga"],
    "trânsito": ["carro", "moto", "transporte"],
    "ambiental": ["meio ambiente", "ecologia", "sustentabilidade"]
};

// 🔎 **1. Pré-processador da Consulta**
function preprocessQuery(query) {
    let words = query.toLowerCase().split(" ");
    words = stopwords.removeStopwords(words, stopwords.pt);
    const containsLegalTerms = words.some(word => keywords.includes(word));
    return { query: words.join(" "), isLegal: containsLegalTerms };
}

// 🔍 **2. Busca no Google Custom Search com suporte a paginação**
async function searchGoogle(query, start = 1) {
    const googleApiUrl = `${CUSTOM_SEARCH_URL}${encodeURIComponent(query)}&num=5&start=${start}`;

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

// 🔄 **3. Sugestão de Termos Alternativos**
function suggestAlternative(query) {
    let words = query.toLowerCase().split(" ");
    for (let word of words) {
        if (synonyms[word]) {
            return `❓ Nenhuma legislação encontrada para "${query}". Você pode tentar pesquisar por: "${synonyms[word].join(', ')}"`;
        }
    }
    return "⚠️ Não encontramos leis relacionadas. Tente reformular sua pesquisa.";
}

// 📜 **Endpoint principal para pesquisa de leis com paginação**
app.get(['/search', '/buscar'], async (req, res) => {
    try {
        const query = req.query.q;
        const page = parseInt(req.query.page) || 1;
        const startIndex = (page - 1) * 5 + 1; // Busca de 5 em 5 resultados

        if (!query) {
            return res.status(400).json({ error: 'O parâmetro "q" é obrigatório' });
        }

        console.log(`🚀 🔹 [${new Date().toLocaleString()}] Nova pesquisa recebida: "${query}" (Página ${page})`);

        // 🔹 1. Pré-processa a pesquisa
        const processedQuery = preprocessQuery(query);
        if (!processedQuery.isLegal) {
            return res.json({ message: "❌ A pesquisa parece não estar relacionada a leis. Tente algo como 'Lei de trânsito no Brasil'." });
        }

        const cacheKey = `search-law:${query}:page:${page}`;
        const cachedData = await client.get(cacheKey);
        if (cachedData) {
            console.log(`♻️ Resultado recuperado do cache para "${query}" (Página ${page})`);
            return res.json(JSON.parse(cachedData));
        }

        // 🔹 2. Busca no Google com paginação
        let results = await searchGoogle(processedQuery.query, startIndex);

        if (results === null) {
            console.log("❌ Erro ao buscar no Google, retornando erro para o bot.");
            return res.status(500).json({ error: "Erro ao conectar com o Google. Tente novamente mais tarde." });
        }

        if (results.length > 0) {
            console.log(`✅ ${results.length} resultados encontrados para "${query}" (Página ${page})`);
            const responsePayload = {
                message: `📜 Encontramos ${results.length} leis relacionadas.`,
                results,
                nextPage: results.length === 5 ? `/buscar?q=${encodeURIComponent(query)}&page=${page + 1}` : null
            };

            await client.setEx(cacheKey, 3600, JSON.stringify(responsePayload)); // Cache por 1 hora
            return res.json(responsePayload);
        }

        return res.json({ message: "⚠️ Não encontramos mais leis relacionadas. Tente reformular sua pesquisa." });

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
