require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const morgan = require('morgan');

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
    console.error("❌ ERRO: Faltando variáveis de ambiente (GOOGLE_API_KEY, GOOGLE_CX ou MISTRAL_API_KEY). ");
    process.exit(1);
}

const CUSTOM_SEARCH_URL = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=`;
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

// 📌 **Validação e reformulação da pesquisa**
async function validateAndReformulateQuery(query) {
    try {
        console.log(`🤖 Verificando se a pesquisa faz sentido jurídico: "${query}"`);
        
        const response = await axios.post(MISTRAL_API_URL, {
            model: "mistral-small", // 🔄 Corrigido para um modelo válido
            messages: [{
                role: "user",
                content: `A seguinte pesquisa de lei faz sentido jurídico? "${query}". Se não fizer, reformule para algo juridicamente correto e relevante. Responda apenas com a reformulação ou escreva 'INVÁLIDO' se a pesquisa não puder ser reformulada.`
            }]
        }, {
            headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` }
        });

        const reformulatedQuery = response.data.choices?.[0]?.message?.content?.trim();

        console.log(`🔍 Resposta do Mistral: "${reformulatedQuery}"`);

        if (!reformulatedQuery || reformulatedQuery.toUpperCase() === "INVÁLIDO") {
            console.log(`🚫 Pesquisa inválida detectada: "${query}"`);
            return null; // Indica que a pesquisa não faz sentido jurídico
        }

        console.log(`✅ Pesquisa reformulada para: "${reformulatedQuery}"`);
        return reformulatedQuery;
    } catch (error) {
        console.error("❌ Erro ao validar/reformular a pesquisa com Mistral AI:", error.response?.data || error.message);
        return null;  // Retorna null para impedir a busca no Google
    }
}

// 🔍 **Busca no Google Custom Search**
async function searchGoogle(query, start = 1) {
    const googleApiUrl = `${CUSTOM_SEARCH_URL}${encodeURIComponent(query)}&num=${RESULTS_PER_PAGE}&start=${start}`;

    try {
        console.log(`🔍 Buscando no Google: "${query}" (Início: ${start})`);
        const response = await axios.get(googleApiUrl);

        if (!response.data.items || response.data.items.length === 0) {
            console.log("⚠️ Nenhum resultado encontrado.");
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

// 📜 **Endpoint principal para pesquisa de leis**
app.get(['/search', '/buscar'], async (req, res) => {
    try {
        const query = req.query.q;
        const page = parseInt(req.query.page) || 1;
        const startIndex = (page - 1) * RESULTS_PER_PAGE + 1;

        if (!query) {
            return res.status(400).json({ error: 'O parâmetro "q" é obrigatório' });
        }

        console.log(`🚀 🔹 [${new Date().toLocaleString()}] Nova pesquisa recebida: "${query}" (Página ${page})`);

        // 🔹 1. Validar a pesquisa **antes** de pesquisar no Google
        const validatedQuery = await validateAndReformulateQuery(query);
        
        if (!validatedQuery) {
            return res.json({
                message: "❌ Sua pesquisa não faz sentido jurídico.",
                suggestion: "Tente reformular sua pergunta para algo relacionado a leis."
            });
        }

        if (validatedQuery !== query) {
            console.log(`🔄 Pesquisa reformulada para: "${validatedQuery}"`);
            return res.json({
                message: "⚠️ Sua pesquisa foi reformulada para algo mais adequado:",
                suggestion: validatedQuery
            });
        }

        // 🔹 2. Busca no Google com paginação
        let results = await searchGoogle(validatedQuery, startIndex);

        if (results === null) {
            console.log("❌ Erro ao buscar no Google, retornando erro.");
            return res.status(500).json({ error: "Erro ao conectar com o Google. Tente novamente mais tarde." });
        }

        if (results.length > 0) {
            console.log(`✅ ${results.length} resultados encontrados para "${validatedQuery}" (Página ${page})`);
            return res.json({
                message: `📜 Encontramos ${results.length} leis relacionadas.`,
                results,
                nextPage: results.length === RESULTS_PER_PAGE ? `/buscar?q=${encodeURIComponent(validatedQuery)}&page=${page + 1}` : null
            });
        }

        console.log("⚠️ Nenhuma legislação encontrada, tentando reformular...");
        return res.json({
            message: `⚠️ Nenhum resultado encontrado para "${query}". Tente reformular sua pesquisa.`,
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
