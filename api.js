require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const morgan = require('morgan');
const natural = require('natural'); // NLP para entender consultas
const stopwords = require('stopword'); // Remoção de palavras irrelevantes

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

// 📌 Dicionário de palavras-chave jurídicas
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
    // Remove palavras irrelevantes (stopwords)
    let words = query.toLowerCase().split(" ");
    words = stopwords.removeStopwords(words, stopwords.pt);
    
    // Verifica se há termos jurídicos
    const containsLegalTerms = words.some(word => keywords.includes(word));
    
    return { query: words.join(" "), isLegal: containsLegalTerms };
}

// 🔍 **2. Busca no Google Custom Search**
async function searchGoogle(query) {
    const googleApiUrl = `${CUSTOM_SEARCH_URL}${encodeURIComponent(query)}&num=10`;

    try {
        console.log(`🔍 Buscando no Google: ${query}`);
        const response = await axios.get(googleApiUrl);
        return response.data.items?.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            source: new URL(item.link).hostname
        })) || [];
    } catch (error) {
        console.error("❌ Erro na busca do Google:", error.message);
        return [];
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

// 📜 **Endpoint principal para pesquisa de leis**
app.get(['/search', '/buscar'], async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: 'O parâmetro "q" é obrigatório' });
        }

        console.log(`🚀 🔹 [${new Date().toLocaleString()}] Nova pesquisa recebida: "${query}"`);

        // 🔹 1. Pré-processa a pesquisa
        const processedQuery = preprocessQuery(query);
        if (!processedQuery.isLegal) {
            return res.json({ message: "❌ A pesquisa parece não estar relacionada a leis. Tente algo como 'Lei de trânsito no Brasil'." });
        }

        const cacheKey = `search-law:${query}`;
        const cachedData = await client.get(cacheKey);
        if (cachedData) {
            console.log(`♻️ Resultado recuperado do cache para "${query}"`);
            return res.json(JSON.parse(cachedData));
        }

        // 🔹 2. Busca no Google
        let results = await searchGoogle(processedQuery.query);

        if (results.length > 0) {
            console.log(`✅ ${results.length} resultados encontrados para "${query}"`);
            const responsePayload = {
                message: `📜 Encontramos ${results.length} leis relacionadas.`,
                results
            };

            await client.setEx(cacheKey, 3600, JSON.stringify(responsePayload)); // Cache por 1 hora
            return res.json(responsePayload);
        }

        // 🔥 3. Sugere termos alternativos
        console.log("⚠️ Nenhuma legislação encontrada, sugerindo termos alternativos...");
        const suggestion = suggestAlternative(query);
        return res.json({ message: suggestion });

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
